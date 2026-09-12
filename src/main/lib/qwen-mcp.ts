/**
 * mausCode Qwen Code MCP reader + tool fetch for settings (ours, NOT verbatim).
 *
 * Sources:
 *   1. The `mcpServers` map in `~/.qwen/settings.json` (global),
 *      `<project>/.qwen/settings.json`, and `<project>/.mcp.json`
 *      (project) — the machine-readable source of truth, since
 *      `qwen mcp list` is human-only output (no --json flag).
 *   2. `qwen mcp list` scraped for LIVE status (Connected /
 *      Disconnected); ANSI-stripped, keyed by server name. When the
 *      scrape fails, status falls back to config-shape heuristics.
 *
 * Tool enumeration reuses the shared stdio/HTTP fetchers from mcp-auth.
 * env/header values are read (spawning needs them) but never logged;
 * the settings UI renders keys only.
 */

import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { basename } from "node:path"
import type { McpServerConfig } from "./claude-config"
import { getDatabase, projects as projectsTable } from "./db"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "./mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "./oauth"
import { resolveQwenCliLaunch } from "./qwen-binary"
import { type QwenMcpServerConfig, readQwenMcpConfig } from "./qwen-print/mcp-config"

const MCP_FETCH_TIMEOUT_MS = 40_000
const MCP_LIST_TIMEOUT_MS = 15_000

export type QwenMcpServerForSettings = {
  name: string
  status: string
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

export type QwenMcpConfigGroup = {
  groupName: string
  projectPath: string | null
  mcpServers: QwenMcpServerForSettings[]
}

/** Strip ANSI color codes from `qwen mcp list` output. */
export function stripQwenMcpAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI code stripping.
  return text.replace(/\x1b\[[0-9;]*m/g, "")
}

/**
 * Scrape live status from `qwen mcp list` human output:
 * `✓ name: <detail> (<transport>) - Connected` /
 * `✗ name: <detail> (<transport>) - Disconnected[ (reason)]`.
 */
export function parseQwenMcpListStatus(
  output: string,
): Record<string, { status: string; detail?: string }> {
  const out: Record<string, { status: string; detail?: string }> = {}
  for (const rawLine of stripQwenMcpAnsi(output).split("\n")) {
    const line = rawLine.trim()
    const match = /^[✓✗✔✘x-]\s*(\S+?):\s+.*?\((\w+)\)\s+-\s+(\w+)(?:\s+\((.*)\))?$/.exec(line)
    if (!match) continue
    const [, name, , statusWord, detail] = match
    const status = statusWord.toLowerCase() === "connected" ? "connected" : "failed"
    out[name] = detail ? { status, detail } : { status }
  }
  return out
}

function runQwenMcpList(cwd: string): Promise<Record<string, { status: string; detail?: string }>> {
  return new Promise((resolvePromise) => {
    let launch: { command: string; args: string[] }
    try {
      launch = resolveQwenCliLaunch(["mcp", "list"])
    } catch {
      resolvePromise({})
      return
    }
    execFile(
      launch.command,
      launch.args,
      { cwd, timeout: MCP_LIST_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolvePromise({})
          return
        }
        try {
          resolvePromise(parseQwenMcpListStatus(String(stdout ?? "")))
        } catch {
          resolvePromise({})
        }
      },
    )
  })
}

function toMcpServerConfig(server: QwenMcpServerConfig): McpServerConfig {
  return {
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
    trust: server.trust,
    ...(server.includeTools ? { includeTools: server.includeTools } : {}),
    ...(server.excludeTools ? { excludeTools: server.excludeTools } : {}),
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
  servers: { config: QwenMcpServerConfig; liveStatus?: string }[] | undefined,
): Promise<QwenMcpServerForSettings[]> {
  if (!servers) return []

  return Promise.all(
    servers.map(async ({ config: parsed, liveStatus }) => {
      const serverConfig = toMcpServerConfig(parsed)
      const configObj = serverConfig as Record<string, unknown>
      let status = liveStatus ?? getServerStatusFromConfig(serverConfig)
      const headers = serverConfig.headers as Record<string, string> | undefined
      let tools: McpToolInfo[] = []
      let needsAuth = false

      try {
        tools = await fetchToolsForServer(serverConfig)
      } catch (error) {
        console.error(`[qwen-mcp] Failed to fetch tools for ${parsed.name}:`, error)
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
        } else if (!liveStatus) {
          status = "failed"
        }
      } else if (!liveStatus) {
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
    console.error("[qwen-mcp] Failed to read projects from DB:", error)
  }

  return [...projectPathSet].sort((a, b) => a.localeCompare(b))
}

export async function getQwenMcpConfigForProject(
  projectPath: string,
  options?: { includeTools?: boolean },
): Promise<QwenMcpConfigGroup | null> {
  const { servers } = readQwenMcpConfig({ projectDir: projectPath })
  const scoped = servers.filter((s) => s.scope === "project")
  if (scoped.length === 0) {
    return null
  }

  const live = await runQwenMcpList(projectPath)
  const withLive = scoped.map((config) => ({
    config,
    liveStatus: live[config.name]?.status,
  }))

  const mcpServers =
    options?.includeTools === false
      ? withLive.map(({ config, liveStatus }) => {
          const serverConfig = toMcpServerConfig(config)
          return {
            name: config.name,
            status: liveStatus ?? getServerStatusFromConfig(serverConfig),
            tools: [] as McpToolInfo[],
            needsAuth: false,
            config: serverConfig as Record<string, unknown>,
          }
        })
      : await convertServers(withLive)

  return {
    groupName: basename(projectPath) || projectPath,
    projectPath,
    mcpServers,
  }
}

export async function getAllQwenMcpConfigHandler(): Promise<{
  groups: QwenMcpConfigGroup[]
  error?: string
}> {
  try {
    const projectPaths = await getKnownProjectPaths()
    const groups: QwenMcpConfigGroup[] = []

    const { servers } = readQwenMcpConfig({ homeDir: homedir() })
    const globalServers = servers.filter((s) => s.scope === "user")
    if (globalServers.length > 0) {
      const live = await runQwenMcpList(homedir())
      groups.push({
        groupName: "Global",
        projectPath: null,
        mcpServers: await convertServers(
          globalServers.map((config) => ({
            config,
            liveStatus: live[config.name]?.status,
          })),
        ),
      })
    }

    const results = await Promise.allSettled(
      projectPaths.map(async (projectPath) =>
        getQwenMcpConfigForProject(projectPath, { includeTools: true }),
      ),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        groups.push(result.value)
        continue
      }
      if (result.status === "rejected") {
        console.error(
          "[qwen.getAllMcpConfig] Failed to resolve project MCP snapshot:",
          result.reason,
        )
      }
    }

    return { groups }
  } catch (error) {
    console.error("[qwen.getAllMcpConfig] Error:", error)
    return { groups: [], error: String(error) }
  }
}
