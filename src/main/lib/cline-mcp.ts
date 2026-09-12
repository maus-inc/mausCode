/**
 * mausCode Cline MCP reader + tool fetch for settings (ours, NOT verbatim).
 *
 * Sources (file-only, no CLI spawn):
 *   1. The `mcpServers` map in
 *      `~/.cline/data/settings/cline_mcp_settings.json` (global — the
 *      path `cline config mcp` reads, verified live) and
 *      `<project>/.cline/mcp.json` (project, documented path).
 *
 * `cline config mcp --json` adds nothing machine-useful (name /
 * transportType / disabled / path only, no status or tools — verified
 * live), so no scrape layer exists (unlike the qwen backend). Server
 * liveness comes from the shared tool fetchers: a successful fetch
 * marks the server connected.
 *
 * Tool enumeration reuses the shared stdio/HTTP fetchers from mcp-auth.
 * env/header values are read (spawning needs them) but never logged;
 * the settings UI renders keys only.
 */

import { homedir } from "node:os"
import { basename } from "node:path"
import type { McpServerConfig } from "./claude-config"
import { type ClineMcpServerConfig, readClineMcpConfig } from "./cline-print/mcp-config"
import { getDatabase, projects as projectsTable } from "./db"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "./mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "./oauth"

const MCP_FETCH_TIMEOUT_MS = 40_000

export type ClineMcpServerForSettings = {
  name: string
  status: string
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

export type ClineMcpConfigGroup = {
  groupName: string
  projectPath: string | null
  mcpServers: ClineMcpServerForSettings[]
}

function toMcpServerConfig(server: ClineMcpServerConfig): McpServerConfig {
  return {
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
    disabled: server.disabled,
    ...(server.autoApprove ? { autoApprove: server.autoApprove } : {}),
    transport: server.transport,
    scope: server.scope,
    source: server.source,
  }
}

function getServerStatusFromConfig(serverConfig: McpServerConfig): string {
  const headers = serverConfig.headers as Record<string, string> | undefined
  const { authType } = serverConfig

  if (authType === "none") {
    return "connected"
  }

  if (headers?.Authorization) {
    return "connected"
  }

  if (serverConfig.url) {
    if (authType === "oauth" || authType === "bearer") {
      return "needs-auth"
    }
    return "connected"
  }

  if (serverConfig.command) {
    return "connected"
  }

  return "failed"
}

async function fetchToolsForServer(serverConfig: McpServerConfig): Promise<McpToolInfo[]> {
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), MCP_FETCH_TIMEOUT_MS),
  )

  const fetchPromise = (async () => {
    if (serverConfig.url) {
      const headers = serverConfig.headers as Record<string, string> | undefined
      try {
        return await fetchMcpTools(serverConfig.url, headers)
      } catch {
        return []
      }
    }

    const command = serverConfig.command
    if (command) {
      try {
        return await fetchMcpToolsStdio({
          command,
          args: serverConfig.args,
          env: serverConfig.env as Record<string, string> | undefined,
        })
      } catch {
        return []
      }
    }

    return []
  })()

  try {
    return await Promise.race([fetchPromise, timeoutPromise])
  } catch {
    return []
  }
}

async function convertServers(
  servers: ClineMcpServerConfig[] | undefined,
): Promise<ClineMcpServerForSettings[]> {
  if (!servers) return []

  return Promise.all(
    servers.map(async (parsed) => {
      const serverConfig = toMcpServerConfig(parsed)
      const configObj = serverConfig as Record<string, unknown>
      let status = getServerStatusFromConfig(serverConfig)
      const headers = serverConfig.headers as Record<string, string> | undefined
      let tools: McpToolInfo[] = []
      let needsAuth = false

      if (!parsed.disabled) {
        try {
          tools = await fetchToolsForServer(serverConfig)
        } catch (error) {
          console.error(`[cline-mcp] Failed to fetch tools for ${parsed.name}:`, error)
        }
      }

      if (tools.length > 0) {
        status = "connected"
      } else if (serverConfig.url) {
        try {
          const baseUrl = getMcpBaseUrl(serverConfig.url)
          const metadata = await fetchOAuthMetadata(baseUrl)
          needsAuth = !!metadata && !!metadata.authorization_endpoint
        } catch {
          // If probe fails, assume no auth needed
        }

        if (
          !needsAuth &&
          (serverConfig.authType === "oauth" || serverConfig.authType === "bearer")
        ) {
          needsAuth = true
        }

        if (needsAuth && !headers?.Authorization) {
          status = "needs-auth"
        } else {
          status = "failed"
        }
      } else {
        status = "failed"
      }

      return { name: parsed.name, status, tools, needsAuth, config: configObj }
    }),
  )
}

async function getKnownProjectPaths(): Promise<string[]> {
  const projectPathSet = new Set<string>()

  try {
    const db = getDatabase()
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all()
    for (const project of dbProjects) {
      if (typeof project.path === "string" && project.path.trim().length > 0) {
        projectPathSet.add(project.path)
      }
    }
  } catch (error) {
    console.error("[cline-mcp] Failed to read projects from DB:", error)
  }

  return [...projectPathSet].sort((a, b) => a.localeCompare(b))
}

export async function getClineMcpConfigForProject(
  projectPath: string,
  options?: { includeTools?: boolean },
): Promise<ClineMcpConfigGroup | null> {
  const { servers } = readClineMcpConfig({ projectDir: projectPath })
  const scoped = servers.filter((s) => s.scope === "project")
  if (scoped.length === 0) {
    return null
  }

  const mcpServers =
    options?.includeTools === false
      ? scoped.map((config) => {
          const serverConfig = toMcpServerConfig(config)
          return {
            name: config.name,
            status: getServerStatusFromConfig(serverConfig),
            tools: [] as McpToolInfo[],
            needsAuth: false,
            config: serverConfig as Record<string, unknown>,
          }
        })
      : await convertServers(scoped)

  return {
    groupName: basename(projectPath) || projectPath,
    projectPath,
    mcpServers,
  }
}

export async function getAllClineMcpConfigHandler(): Promise<{
  groups: ClineMcpConfigGroup[]
  error?: string
}> {
  try {
    const projectPaths = await getKnownProjectPaths()
    const groups: ClineMcpConfigGroup[] = []

    const { servers } = readClineMcpConfig({ homeDir: homedir() })
    const globalServers = servers.filter((s) => s.scope === "global")
    if (globalServers.length > 0) {
      groups.push({
        groupName: "Global",
        projectPath: null,
        mcpServers: await convertServers(globalServers),
      })
    }

    const results = await Promise.allSettled(
      projectPaths.map(async (projectPath) =>
        getClineMcpConfigForProject(projectPath, { includeTools: true }),
      ),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        groups.push(result.value)
        continue
      }
      if (result.status === "rejected") {
        console.error(
          "[cline.getAllMcpConfig] Failed to resolve project MCP snapshot:",
          result.reason,
        )
      }
    }

    return { groups }
  } catch (error) {
    console.error("[cline.getAllMcpConfig] Error:", error)
    return {
      groups: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
