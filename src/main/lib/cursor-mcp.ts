/**
 * NOTE (transplant): Cursor project + global mcp.json reader + tool fetch for settings.
 * Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
 */
import { homedir } from "node:os"
import { basename } from "node:path"
import * as fs from "fs/promises"
import * as path from "path"
import type { McpServerConfig } from "./claude-config"
import { getDatabase, projects as projectsTable } from "./db"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "./mcp-auth"
import { fetchOAuthMetadata, getMcpBaseUrl } from "./oauth"

const MCP_FETCH_TIMEOUT_MS = 40_000

export type CursorMcpServerForSettings = {
  name: string
  status: string
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
}

export type CursorMcpConfigGroup = {
  groupName: string
  projectPath: string | null
  mcpServers: CursorMcpServerForSettings[]
}

const cursorMcpJsonCache = new Map<
  string,
  {
    servers: Record<string, McpServerConfig>
    mtime: number
  }
>()

function expandEnvVars(value: string, projectPath?: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    if (expr === "/" || expr === "pathSeparator") return path.sep
    if (expr === "userHome") return homedir()
    if (expr === "workspaceFolder") return projectPath ?? ""
    if (expr === "workspaceFolderBasename") {
      return projectPath ? basename(projectPath) : ""
    }
    if (expr.startsWith("env:")) {
      const rest = expr.slice("env:".length)
      const defaultSep = rest.indexOf(":-")
      if (defaultSep !== -1) {
        const varName = rest.slice(0, defaultSep)
        return process.env[varName] || rest.slice(defaultSep + 2)
      }
      return process.env[rest] || ""
    }
    const defaultSep = expr.indexOf(":-")
    if (defaultSep !== -1) {
      const varName = expr.slice(0, defaultSep)
      const defaultVal = expr.slice(defaultSep + 2)
      return process.env[varName] || defaultVal
    }
    return process.env[expr] || ""
  })
}

function expandMcpServerEnvVars(
  servers: Record<string, McpServerConfig>,
  projectPath?: string,
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {}
  for (const [name, config] of Object.entries(servers)) {
    const expanded: McpServerConfig = { ...config }
    if (typeof expanded.command === "string") {
      expanded.command = expandEnvVars(expanded.command, projectPath)
    }
    if (Array.isArray(expanded.args)) {
      expanded.args = expanded.args.map((arg) =>
        typeof arg === "string" ? expandEnvVars(arg, projectPath) : arg,
      )
    }
    if (typeof expanded.url === "string") {
      expanded.url = expandEnvVars(expanded.url, projectPath)
    }
    if (expanded.env && typeof expanded.env === "object") {
      const envObj = expanded.env as Record<string, string>
      const expandedEnv: Record<string, string> = {}
      for (const [key, value] of Object.entries(envObj)) {
        expandedEnv[key] = typeof value === "string" ? expandEnvVars(value, projectPath) : value
      }
      expanded.env = expandedEnv
    }
    if (expanded.headers && typeof expanded.headers === "object") {
      const headersObj = expanded.headers as Record<string, string>
      const expandedHeaders: Record<string, string> = {}
      for (const [key, value] of Object.entries(headersObj)) {
        expandedHeaders[key] = typeof value === "string" ? expandEnvVars(value, projectPath) : value
      }
      expanded.headers = expandedHeaders
    }
    result[name] = expanded
  }
  return result
}

function parseMcpJsonContent(
  parsed: unknown,
  projectPath?: string,
): Record<string, McpServerConfig> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {}
  }

  const record = parsed as Record<string, unknown>
  let servers: Record<string, McpServerConfig>

  if (record.mcpServers && typeof record.mcpServers === "object") {
    servers = record.mcpServers as Record<string, McpServerConfig>
  } else {
    servers = {}
    for (const [key, value] of Object.entries(record)) {
      if (value && typeof value === "object" && !Array.isArray(value) && key !== "mcpServers") {
        servers[key] = value as McpServerConfig
      }
    }
  }

  return expandMcpServerEnvVars(servers, projectPath)
}

export async function readCursorProjectMcpJson(
  projectPath: string,
): Promise<Record<string, McpServerConfig>> {
  try {
    const mcpJsonPath = path.join(projectPath, ".cursor", "mcp.json")
    const stats = await fs.stat(mcpJsonPath).catch(() => null)
    if (!stats) return {}

    const cached = cursorMcpJsonCache.get(mcpJsonPath)
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.servers
    }

    const content = await fs.readFile(mcpJsonPath, "utf-8")
    const servers = parseMcpJsonContent(JSON.parse(content), projectPath)
    cursorMcpJsonCache.set(mcpJsonPath, {
      servers,
      mtime: stats.mtimeMs,
    })
    return servers
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[cursor-mcp] Failed to read .cursor/mcp.json from ${projectPath}:`, error)
    }
    return {}
  }
}

export async function readCursorGlobalMcpJson(): Promise<Record<string, McpServerConfig>> {
  try {
    const mcpJsonPath = path.join(homedir(), ".cursor", "mcp.json")
    const stats = await fs.stat(mcpJsonPath).catch(() => null)
    if (!stats) return {}

    const cached = cursorMcpJsonCache.get(mcpJsonPath)
    if (cached && cached.mtime === stats.mtimeMs) {
      return cached.servers
    }

    const content = await fs.readFile(mcpJsonPath, "utf-8")
    // No project context: ${workspaceFolder} expands empty for globals.
    const servers = parseMcpJsonContent(JSON.parse(content))
    cursorMcpJsonCache.set(mcpJsonPath, {
      servers,
      mtime: stats.mtimeMs,
    })
    return servers
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[cursor-mcp] Failed to read ~/.cursor/mcp.json:`, error)
    }
    return {}
  }
}

export function clearCursorMcpCache(): void {
  cursorMcpJsonCache.clear()
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
  servers: Record<string, McpServerConfig> | undefined,
): Promise<CursorMcpServerForSettings[]> {
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
        console.error(`[cursor-mcp] Failed to fetch tools for ${name}:`, error)
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
    console.error("[cursor-mcp] Failed to read projects from DB:", error)
  }

  return [...projectPathSet].sort((a, b) => a.localeCompare(b))
}

export async function getCursorMcpConfigForProject(
  projectPath: string,
  options?: { includeTools?: boolean },
): Promise<CursorMcpConfigGroup | null> {
  const servers = await readCursorProjectMcpJson(projectPath)
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

export async function getAllCursorMcpConfigHandler(): Promise<{
  groups: CursorMcpConfigGroup[]
  error?: string
}> {
  try {
    const projectPaths = await getKnownProjectPaths()
    const groups: CursorMcpConfigGroup[] = []

    // Global ~/.cursor/mcp.json first (mirrors the claude "Global" group).
    const globalServers = await readCursorGlobalMcpJson()
    if (Object.keys(globalServers).length > 0) {
      groups.push({
        groupName: "Global",
        projectPath: null,
        mcpServers: await convertServers(globalServers),
      })
    }

    const results = await Promise.allSettled(
      projectPaths.map(async (projectPath) =>
        getCursorMcpConfigForProject(projectPath, { includeTools: true }),
      ),
    )

    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        groups.push(result.value)
        continue
      }
      if (result.status === "rejected") {
        console.error(
          "[cursor.getAllMcpConfig] Failed to resolve project MCP snapshot:",
          result.reason,
        )
      }
    }

    return { groups }
  } catch (error) {
    console.error("[cursor.getAllMcpConfig] Error:", error)
    return { groups: [], error: String(error) }
  }
}
