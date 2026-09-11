/**
 * mausCode Grok Build MCP reader + tool fetch for settings (ours, NOT verbatim).
 *
 * Sources, per the official MCP doc:
 *   1. `grok mcp list --json` (primary; run with cwd = scope root).
 *   2. `[mcp_servers.<name>]` tables in `~/.grok/config.toml` (global) and
 *      `<project>/.grok/config.toml` (project) as the fallback when the CLI
 *      listing fails. Parsed with a dependency-free TOML subset reader
 *      (tables + one sub-table level, strings, string arrays with
 *      continuation lines, flat inline tables) — no TOML dependency is
 *      introduced for one config file.
 *
 * Tool enumeration reuses the shared stdio/HTTP fetchers from mcp-auth.
 */

import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { basename } from "node:path"
import * as fs from "fs/promises"
import * as path from "path"
import type { McpServerConfig } from "./claude-config"
import { getDatabase, projects as projectsTable } from "./db"
import { resolveGrokCliLaunch, resolveGrokHome } from "./grok-binary"
import { parseGrokMcpListJson, parseGrokMcpToml } from "./grok-print/mcp-config"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "./mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "./oauth"

const MCP_FETCH_TIMEOUT_MS = 40_000
const MCP_LIST_TIMEOUT_MS = 15_000

export type GrokMcpServerForSettings = {
  name: string
  status: string
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

export type GrokMcpConfigGroup = {
  groupName: string
  projectPath: string | null
  mcpServers: GrokMcpServerForSettings[]
}

const grokTomlCache = new Map<
  string,
  {
    servers: Record<string, McpServerConfig>
    mtime: number
  }
>()

function runGrokMcpList(cwd: string): Promise<Record<string, McpServerConfig>> {
  return new Promise((resolvePromise) => {
    let launch: { command: string; args: string[] }
    try {
      launch = resolveGrokCliLaunch(["mcp", "list", "--json"])
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
          resolvePromise(parseGrokMcpListJson(JSON.parse(String(stdout ?? ""))))
        } catch {
          resolvePromise({})
        }
      },
    )
  })
}

async function readGrokConfigToml(configPath: string): Promise<Record<string, McpServerConfig>> {
  try {
    const stats = await fs.stat(configPath).catch(() => null)
    if (!stats) return {}

    const cached = grokTomlCache.get(configPath)
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.servers
    }

    const content = await fs.readFile(configPath, "utf-8")
    const servers = parseGrokMcpToml(content)
    grokTomlCache.set(configPath, { servers, mtime: stats.mtimeMs })
    return servers
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[grok-mcp] Failed to read ${configPath}:`, error)
    }
    return {}
  }
}

async function readScopeServers(
  tomlPath: string,
  listCwd: string,
): Promise<Record<string, McpServerConfig>> {
  // CLI listing is authoritative when it works (it reflects the merged,
  // validated config); the TOML file is the offline fallback.
  const listed = await runGrokMcpList(listCwd)
  if (Object.keys(listed).length > 0) return listed
  return readGrokConfigToml(tomlPath)
}

export function clearGrokMcpCache(): void {
  grokTomlCache.clear()
}

// ---------------------------------------------------------------------------
// Status + tool enumeration (same posture as the sibling MCP modules)
// ---------------------------------------------------------------------------

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
  servers: Record<string, McpServerConfig> | undefined,
): Promise<GrokMcpServerForSettings[]> {
  if (!servers) return []

  return Promise.all(
    Object.entries(servers).map(async ([name, serverConfig]) => {
      const configObj = serverConfig as Record<string, unknown>
      let status = getServerStatusFromConfig(serverConfig)
      const headers = serverConfig.headers as Record<string, string> | undefined
      let tools: McpToolInfo[] = []
      let needsAuth = false

      try {
        tools = await fetchToolsForServer(serverConfig)
      } catch (error) {
        console.error(`[grok-mcp] Failed to fetch tools for ${name}:`, error)
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
      } else if (!serverConfig.command) {
        status = "failed"
      } else {
        status = "failed"
      }

      return { name, status, tools, needsAuth, config: configObj }
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
    console.error("[grok-mcp] Failed to read projects from DB:", error)
  }

  return [...projectPathSet].sort((a, b) => a.localeCompare(b))
}

export async function getGrokMcpConfigForProject(
  projectPath: string,
  options?: { includeTools?: boolean },
): Promise<GrokMcpConfigGroup | null> {
  const servers = await readScopeServers(
    path.join(projectPath, ".grok", "config.toml"),
    projectPath,
  )
  if (Object.keys(servers).length === 0) {
    return null
  }

  const mcpServers =
    options?.includeTools === false
      ? Object.entries(servers).map(([name, serverConfig]) => ({
          name,
          status: getServerStatusFromConfig(serverConfig),
          tools: [] as McpToolInfo[],
          needsAuth: false,
          config: serverConfig as Record<string, unknown>,
        }))
      : await convertServers(servers)

  return {
    groupName: basename(projectPath) || projectPath,
    projectPath,
    mcpServers,
  }
}

export async function getAllGrokMcpConfigHandler(): Promise<{
  groups: GrokMcpConfigGroup[]
  error?: string
}> {
  try {
    const projectPaths = await getKnownProjectPaths()
    const groups: GrokMcpConfigGroup[] = []

    const globalServers = await readScopeServers(
      path.join(resolveGrokHome(), "config.toml"),
      homedir(),
    )
    if (Object.keys(globalServers).length > 0) {
      groups.push({
        groupName: "Global",
        projectPath: null,
        mcpServers: await convertServers(globalServers),
      })
    }

    const results = await Promise.allSettled(
      projectPaths.map(async (projectPath) =>
        getGrokMcpConfigForProject(projectPath, { includeTools: true }),
      ),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        groups.push(result.value)
        continue
      }
      if (result.status === "rejected") {
        console.error(
          "[grok.getAllMcpConfig] Failed to resolve project MCP snapshot:",
          result.reason,
        )
      }
    }

    return { groups }
  } catch (error) {
    console.error("[grok.getAllMcpConfig] Error:", error)
    return { groups: [], error: String(error) }
  }
}
