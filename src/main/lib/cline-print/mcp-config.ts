/**
 * mausCode cline-print MCP config reader (ours, NOT verbatim).
 *
 * `cline config mcp --json` lists servers but WITHOUT definitions
 * (name/transportType/disabled/path only — verified live), so the
 * machine-readable source of truth is the `mcpServers` map in the
 * settings files: global
 * `~/.cline/data/settings/cline_mcp_settings.json` (the path `cline
 * config mcp` reads — verified live; the `~/.cline/mcp.json` path in
 * the docs is NOT read by the CLI) plus project `.cline/mcp.json`
 * (documented project path; shown as its own group even though the
 * CLI list command does not merge it).
 *
 * Values posture (same as the sibling backends): `env`/`headers`
 * values ARE read here because the settings UI spawns MCP servers to
 * enumerate their tools. Values are never logged; the settings UI
 * renders env KEYS only.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type ClineMcpTransport = "stdio" | "sse" | "streamableHttp" | "unknown"

export type ClineMcpServerConfig = {
  name: string
  scope: "global" | "project"
  source: string
  command?: string
  args?: string[]
  url?: string
  transport: ClineMcpTransport
  disabled: boolean
  autoApprove?: string[]
  timeoutMs?: number
  /** Full values (feeds MCP tool fetchers; the UI renders keys only). */
  env?: Record<string, string>
  headers?: Record<string, string>
}

export type ClineMcpConfigFile = {
  path: string
  scope: "global" | "project"
  exists: boolean
  error?: string
  serverCount: number
}

export function clineGlobalMcpPath(opts?: {
  homeDir?: string
  dataDir?: string
  env?: NodeJS.ProcessEnv
}): string {
  const dataDir =
    opts?.dataDir ??
    (opts?.env?.CLINE_DATA_DIR?.trim() || join(opts?.homeDir ?? homedir(), ".cline", "data"))
  return join(dataDir, "settings", "cline_mcp_settings.json")
}

export function clineProjectMcpPath(projectDir: string): string {
  return join(projectDir, ".cline", "mcp.json")
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
): ClineMcpServerConfig[] {
  if (typeof data !== "object" || data === null) return []
  const map = (data as Record<string, unknown>).mcpServers
  if (typeof map !== "object" || map === null || Array.isArray(map)) return []
  const out: ClineMcpServerConfig[] = []
  for (const [name, raw] of Object.entries(map as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      continue
    }
    const server = raw as Record<string, unknown>
    const command =
      typeof server.command === "string" && server.command.length > 0 ? server.command : undefined
    const url = typeof server.url === "string" && server.url.length > 0 ? server.url : undefined
    const typeField = typeof server.type === "string" ? server.type : ""
    // Documented: omitting `type` defaults to legacy `sse` for REMOTE
    // servers; command-bearing entries are stdio.
    const transport: ClineMcpTransport = command
      ? "stdio"
      : typeField === "streamableHttp"
        ? "streamableHttp"
        : url
          ? "sse"
          : "unknown"
    out.push({
      name,
      scope,
      source,
      ...(command ? { command } : {}),
      ...(stringArray(server.args) ? { args: stringArray(server.args) } : {}),
      ...(url ? { url } : {}),
      transport,
      disabled: server.disabled === true,
      ...(stringArray(server.autoApprove) ? { autoApprove: stringArray(server.autoApprove) } : {}),
      ...(typeof server.timeout === "number" && server.timeout > 0
        ? { timeoutMs: server.timeout }
        : {}),
      ...(stringMap(server.env) ? { env: stringMap(server.env) } : {}),
      ...(stringMap(server.headers) ? { headers: stringMap(server.headers) } : {}),
    })
  }
  return out
}

export function readClineMcpConfig(opts?: {
  homeDir?: string
  dataDir?: string
  projectDir?: string
  env?: NodeJS.ProcessEnv
}): { servers: ClineMcpServerConfig[]; files: ClineMcpConfigFile[] } {
  const servers: ClineMcpServerConfig[] = []
  const files: ClineMcpConfigFile[] = []

  const globalPath = clineGlobalMcpPath(opts)
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
    const projectPath = clineProjectMcpPath(opts.projectDir)
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
