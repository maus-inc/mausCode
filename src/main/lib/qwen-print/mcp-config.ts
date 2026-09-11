/**
 * mausCode qwen-print MCP config reader (ours, NOT verbatim).
 *
 * `qwen mcp list` is human-only output (no --json flag, ANSI-colored),
 * so the machine-readable source of truth is the `mcpServers` map in
 * settings files: user `~/.qwen/settings.json` plus project
 * `.qwen/settings.json` and `.mcp.json` (the CLI's approve command
 * looks in the latter two; all use the same map shape). Live server
 * status comes from scraping `qwen mcp list` (see ../qwen-mcp.ts).
 *
 * Values posture (same as the grok/cursor backends): `env`/`headers`
 * values ARE read here because the settings UI spawns MCP servers to
 * enumerate their tools. Values are never logged; the settings UI
 * renders env KEYS only.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type QwenMcpTransport = "stdio" | "sse" | "http" | "unknown"

export type QwenMcpServerConfig = {
  name: string
  scope: "user" | "project"
  source: string
  command?: string
  args?: string[]
  url?: string
  transport: QwenMcpTransport
  trust: boolean
  includeTools?: string[]
  excludeTools?: string[]
  timeoutMs?: number
  description?: string
  /** Full values (feeds MCP tool fetchers; the UI renders keys only). */
  env?: Record<string, string>
  headers?: Record<string, string>
}

export type QwenMcpConfigFile = {
  path: string
  scope: "user" | "project"
  exists: boolean
  error?: string
  serverCount: number
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
  scope: "user" | "project",
  source: string,
): QwenMcpServerConfig[] {
  if (typeof data !== "object" || data === null) return []
  const map = (data as Record<string, unknown>).mcpServers
  if (typeof map !== "object" || map === null || Array.isArray(map)) return []
  const out: QwenMcpServerConfig[] = []
  for (const [name, raw] of Object.entries(map)) {
    if (typeof raw !== "object" || raw === null) continue
    const entry = raw as Record<string, unknown>
    const command =
      typeof entry.command === "string" && entry.command.length > 0 ? entry.command : undefined
    const url =
      typeof entry.url === "string" && entry.url.length > 0
        ? entry.url
        : typeof entry.httpUrl === "string" && entry.httpUrl.length > 0
          ? entry.httpUrl
          : typeof entry.serverUrl === "string" && entry.serverUrl.length > 0
            ? entry.serverUrl
            : undefined
    const declared = entry.transport
    const transport: QwenMcpTransport =
      declared === "stdio" || declared === "sse" || declared === "http"
        ? declared
        : command
          ? "stdio"
          : url
            ? "http"
            : "unknown"
    const env = stringMap(entry.env)
    const headers = stringMap(entry.headers)
    const timeoutMs =
      typeof entry.timeout === "number" && Number.isFinite(entry.timeout)
        ? entry.timeout
        : undefined
    const description =
      typeof entry.description === "string" && entry.description.length > 0
        ? entry.description
        : undefined
    out.push({
      name,
      scope,
      source,
      ...(command ? { command } : {}),
      ...(stringArray(entry.args) ? { args: stringArray(entry.args) } : {}),
      ...(url ? { url } : {}),
      transport,
      trust: entry.trust === true,
      ...(stringArray(entry.includeTools) ? { includeTools: stringArray(entry.includeTools) } : {}),
      ...(stringArray(entry.excludeTools) ? { excludeTools: stringArray(entry.excludeTools) } : {}),
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      ...(description ? { description } : {}),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {}),
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function readQwenMcpConfig(opts?: { homeDir?: string; projectDir?: string }): {
  servers: QwenMcpServerConfig[]
  files: QwenMcpConfigFile[]
} {
  const home = opts?.homeDir ?? homedir()
  const candidates: { path: string; scope: "user" | "project" }[] = [
    { path: join(home, ".qwen", "settings.json"), scope: "user" },
  ]
  if (opts?.projectDir) {
    candidates.push(
      { path: join(opts.projectDir, ".qwen", "settings.json"), scope: "project" },
      { path: join(opts.projectDir, ".mcp.json"), scope: "project" },
    )
  }
  const servers: QwenMcpServerConfig[] = []
  const files: QwenMcpConfigFile[] = []
  for (const candidate of candidates) {
    const { data, error } = readJson(candidate.path)
    const parsed = error ? [] : parseServerMap(data, candidate.scope, candidate.path)
    servers.push(...parsed)
    files.push({
      path: candidate.path,
      scope: candidate.scope,
      exists: existsSync(candidate.path),
      ...(error ? { error } : {}),
      serverCount: parsed.length,
    })
  }
  return { servers, files }
}
