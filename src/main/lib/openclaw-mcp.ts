/**
 * mausCode OpenClaw MCP reader + tool fetch for settings (ours, NOT
 * verbatim). Mirrors cline-mcp (ours, NOT verbatim).
 *
 * Source (one CLI call, no file parse): `openclaw mcp list --json`
 * (live shape: `{name: definition}`), which resolves JSON5,
 * `$include`, and config migrations a raw read of
 * `~/.openclaw/openclaw.json` would miss. OpenClaw has no
 * project-scoped MCP surface: everything lands in one Global group.
 * mcporter servers (`config/mcporter.json`) are NOT covered (the
 * list command excludes them — see the decision brief).
 *
 * Tool enumeration reuses the shared stdio/HTTP fetchers from
 * mcp-auth. env/header values are read (spawning needs them) but
 * never logged; the settings UI renders keys only.
 */

import type { McpServerConfig } from "./claude-config"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "./mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "./oauth"
import { resolveOpenclawCliLaunch } from "./openclaw-binary"
import { type OpenclawMcpServerConfig, readOpenclawMcpList } from "./openclaw-print/mcp-config"

const MCP_FETCH_TIMEOUT_MS = 40_000

export type OpenclawMcpServerForSettings = {
  name: string
  status: string
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

export type OpenclawMcpConfigGroup = {
  groupName: string
  projectPath: string | null
  mcpServers: OpenclawMcpServerForSettings[]
}

function toMcpServerConfig(server: OpenclawMcpServerConfig): McpServerConfig {
  return {
    ...(server.command ? { command: server.command } : {}),
    ...(server.args ? { args: server.args } : {}),
    ...(server.url ? { url: server.url } : {}),
    ...(server.env ? { env: server.env } : {}),
    ...(server.headers ? { headers: server.headers } : {}),
    ...(server.timeoutMs !== undefined ? { timeout: server.timeoutMs } : {}),
    disabled: server.disabled,
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
  servers: OpenclawMcpServerConfig[] | undefined,
): Promise<OpenclawMcpServerForSettings[]> {
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
          console.error(`[openclaw-mcp] Failed to fetch tools for ${parsed.name}:`, error)
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

async function readServers(): Promise<OpenclawMcpServerConfig[]> {
  const launch = resolveOpenclawCliLaunch()
  return readOpenclawMcpList({ command: launch.command, args: launch.args })
}

export async function getOpenclawMcpConfigForProject(
  projectPath: string,
  options?: { includeTools?: boolean },
): Promise<OpenclawMcpConfigGroup | null> {
  // Global-only surface: turns in every project use these servers.
  const servers = await readServers()
  if (servers.length === 0) {
    return null
  }

  const mcpServers =
    options?.includeTools === false
      ? servers.map((config) => {
          const serverConfig = toMcpServerConfig(config)
          return {
            name: config.name,
            status: getServerStatusFromConfig(serverConfig),
            tools: [] as McpToolInfo[],
            needsAuth: false,
            config: serverConfig as Record<string, unknown>,
          }
        })
      : await convertServers(servers)

  return {
    groupName: "Global",
    projectPath,
    mcpServers,
  }
}

export async function getAllOpenclawMcpConfigHandler(): Promise<{
  groups: OpenclawMcpConfigGroup[]
  error?: string
}> {
  try {
    const servers = await readServers()
    if (servers.length === 0) {
      return { groups: [] }
    }
    return {
      groups: [
        {
          groupName: "Global",
          projectPath: null,
          mcpServers: await convertServers(servers),
        },
      ],
    }
  } catch (error) {
    console.error("[openclaw.getAllMcpConfig] Error:", error)
    return {
      groups: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
