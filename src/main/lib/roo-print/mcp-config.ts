/**
 * mausCode roo-print MCP config reader (ours, NOT verbatim).
 *
 * The `roo` CLI has no MCP list surface (`roo list` covers only
 * commands/modes/models/sessions), so the machine-readable source of
 * truth is the `mcpServers` map in the settings files
 * (source-verified in RooCodeInc/Roo-Code src/services/mcp/McpHub.ts
 * at cli-v0.1.17):
 *   - global `~/.vscode-mock/global-storage/settings/mcp_settings.json`
 *     (the vscode-shim globalStorage path the CLI's extension host
 *     resolves: getSettingsDirectoryPath(globalStoragePath) +
 *     GlobalFileNames.mcpSettings), and
 *   - project `<project>/.roo/mcp.json` (watched + merged by McpHub).
 *
 * Server schema (source: McpHub createServerTypeSchema): `type` is
 * "stdio" (command/args/env/cwd), "sse" (url/headers), or
 * "streamable-http" (url/headers); base fields are disabled?,
 * timeout? (SECONDS, default 60), alwaysAllow[], disabledTools[].
 *
 * Values posture (same as the sibling backends): `env`/`headers`
 * values ARE read here because the settings UI spawns MCP servers to
 * enumerate their tools. Values are never logged; the settings UI
 * renders env KEYS only.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type RooMcpTransport = "stdio" | "sse" | "streamableHttp" | "unknown"

export type RooMcpServerConfig = {
  name: string
  scope: "global" | "project"
  source: string
  command?: string
  args?: string[]
  url?: string
  transport: RooMcpTransport
  disabled: boolean
  autoApprove?: string[]
  timeoutMs?: number
  /** Full values (feeds MCP tool fetchers; the UI renders keys only). */
  env?: Record<string, string>
  headers?: Record<string, string>
}

export type RooMcpConfigFile = {
  path: string
  scope: "global" | "project"
  exists: boolean
  error?: string
  serverCount: number
}

export function rooGlobalMcpPath(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  const home = opts?.env?.HOME?.trim() || opts?.homeDir || homedir()
  return join(home, ".vscode-mock", "global-storage", "settings", "mcp_settings.json")
}

export function rooProjectMcpPath(projectDir: string): string {
  return join(projectDir, ".roo", "mcp.json")
}

function readJson(path: string): { data: unknown; error?: string } {
  try {
    if (!existsSync(path)) return { data: null }
    return { data: JSON.parse(readFileSync(path, "utf8")) }
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unreadable JSON",
    }
  }
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0)
  return out.length > 0 ? out : undefined
}

function parseServerMap(
  data: unknown,
  scope: "global" | "project",
  source: string,
): RooMcpServerConfig[] {
  if (typeof data !== "object" || data === null) return []
  const map = (data as Record<string, unknown>).mcpServers
  if (typeof map !== "object" || map === null || Array.isArray(map)) return []
  const out: RooMcpServerConfig[] = []
  for (const [name, raw] of Object.entries(map as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      continue
    }
    const server = raw as Record<string, unknown>
    const command =
      typeof server.command === "string" && server.command.length > 0 ? server.command : undefined
    const url = typeof server.url === "string" && server.url.length > 0 ? server.url : undefined
    const typeField = typeof server.type === "string" ? server.type : ""
    // Upstream requires a matching `type` for url servers, but older
    // files may omit it: command-bearing entries are stdio, url
    // entries default to sse unless streamable-http is declared.
    const transport: RooMcpTransport = command
      ? "stdio"
      : typeField === "streamable-http" || typeField === "streamableHttp"
        ? "streamableHttp"
        : url
          ? "sse"
          : "unknown"
    const timeoutSec =
      typeof server.timeout === "number" && server.timeout > 0 ? server.timeout : undefined
    out.push({
      name,
      scope,
      source,
      ...(command ? { command } : {}),
      ...(stringArray(server.args) ? { args: stringArray(server.args) } : {}),
      ...(url ? { url } : {}),
      transport,
      disabled: server.disabled === true,
      ...((stringArray(server.alwaysAllow) ?? stringArray(server.autoApprove))
        ? {
            autoApprove: stringArray(server.alwaysAllow) ?? stringArray(server.autoApprove)!,
          }
        : {}),
      ...(timeoutSec !== undefined ? { timeoutMs: timeoutSec * 1000 } : {}),
      ...(stringMap(server.env) ? { env: stringMap(server.env) } : {}),
      ...(stringMap(server.headers) ? { headers: stringMap(server.headers) } : {}),
    })
  }
  return out
}

export function readRooMcpConfig(opts?: {
  homeDir?: string
  projectDir?: string
  env?: NodeJS.ProcessEnv
}): { servers: RooMcpServerConfig[]; files: RooMcpConfigFile[] } {
  const servers: RooMcpServerConfig[] = []
  const files: RooMcpConfigFile[] = []

  const globalPath = rooGlobalMcpPath(opts)
  const global = readJson(globalPath)
  const globalServers = parseServerMap(global.data, "global", globalPath)
  servers.push(...globalServers)
  files.push({
    path: globalPath,
    scope: "global",
    exists: existsSync(globalPath),
    ...(global.error ? { error: global.error } : {}),
    serverCount: globalServers.length,
  })

  if (opts?.projectDir) {
    const projectPath = rooProjectMcpPath(opts.projectDir)
    const project = readJson(projectPath)
    const projectServers = parseServerMap(project.data, "project", projectPath)
    servers.push(...projectServers)
    files.push({
      path: projectPath,
      scope: "project",
      exists: existsSync(projectPath),
      ...(project.error ? { error: project.error } : {}),
      serverCount: projectServers.length,
    })
  }

  return { servers, files }
}
