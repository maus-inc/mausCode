/**
 * mausCode openclaw-print MCP config reader (ours, NOT verbatim).
 *
 * Source of truth is `openclaw mcp list --json` (live shape: a
 * `{name: definition}` map — NOT the `{path, servers[]}` shape shown
 * in the docs). The CLI is preferred over reading
 * `~/.openclaw/openclaw.json` directly: the loader resolves JSON5
 * syntax, `$include`, and config migrations that a raw file parse
 * would miss. The command only shows OpenClaw-managed `mcp.servers`
 * entries (mcporter servers in `config/mcporter.json` are a separate
 * surface and are NOT covered — see the decision brief).
 *
 * OpenClaw has no project-scoped MCP surface: every entry is global.
 *
 * Values posture (same as the sibling backends): `env`/`headers`
 * values ARE read here because the settings UI spawns MCP servers to
 * enumerate their tools. Values are never logged; the settings UI
 * renders env KEYS only.
 */
import { execFile } from "node:child_process"

export type OpenclawMcpTransport = "stdio" | "sse" | "streamable-http" | "unknown"

export type OpenclawMcpServerConfig = {
  name: string
  scope: "global"
  source: string
  command?: string
  args?: string[]
  url?: string
  transport: OpenclawMcpTransport
  disabled: boolean
  /** Full values (feeds MCP tool fetchers; the UI renders keys only). */
  env?: Record<string, string>
  headers?: Record<string, string>
  timeoutMs?: number
  toolFilter?: { include?: string[]; exclude?: string[] }
}

export type OpenclawMcpListSpawn = {
  command: string
  args: string[]
  env?: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === "string" && v.length > 0)
  return out.length > 0 ? out : undefined
}

/** Pure parser over `mcp list --json` output (fixture-tested). */
export function parseOpenclawMcpList(
  stdoutText: string,
  opts?: { source?: string },
): OpenclawMcpServerConfig[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdoutText)
  } catch {
    return []
  }
  if (!isRecord(parsed)) return []
  const source = opts?.source ?? "openclaw mcp list"
  const out: OpenclawMcpServerConfig[] = []
  for (const [name, raw] of Object.entries(parsed)) {
    if (!isRecord(raw)) continue
    const command =
      typeof raw.command === "string" && raw.command.length > 0 ? raw.command : undefined
    const url = typeof raw.url === "string" && raw.url.length > 0 ? raw.url : undefined
    const transportRaw = typeof raw.transport === "string" ? raw.transport : ""
    const transport: OpenclawMcpTransport = command
      ? "stdio"
      : transportRaw === "streamable-http"
        ? "streamable-http"
        : transportRaw === "sse"
          ? "sse"
          : url
            ? "sse"
            : "unknown"
    const toolFilterRaw = isRecord(raw.toolFilter) ? raw.toolFilter : undefined
    out.push({
      name,
      scope: "global",
      source,
      ...(command ? { command } : {}),
      ...(stringArray(raw.args) ? { args: stringArray(raw.args) } : {}),
      ...(url ? { url } : {}),
      transport,
      disabled: raw.disabled === true || raw.enabled === false,
      ...(stringMap(raw.env) ? { env: stringMap(raw.env) } : {}),
      ...(stringMap(raw.headers) ? { headers: stringMap(raw.headers) } : {}),
      ...(typeof raw.requestTimeoutMs === "number" && raw.requestTimeoutMs > 0
        ? { timeoutMs: raw.requestTimeoutMs }
        : {}),
      ...(toolFilterRaw
        ? {
            toolFilter: {
              ...(stringArray(toolFilterRaw.include)
                ? { include: stringArray(toolFilterRaw.include) }
                : {}),
              ...(stringArray(toolFilterRaw.exclude)
                ? { exclude: stringArray(toolFilterRaw.exclude) }
                : {}),
            },
          }
        : {}),
    })
  }
  return out
}

/**
 * Run `openclaw mcp list --json` and parse it. Used by the MCP
 * settings reader (never per-turn). Resolves [] on any failure.
 */
export function readOpenclawMcpList(
  spawn: OpenclawMcpListSpawn,
  opts?: { timeoutMs?: number },
): Promise<OpenclawMcpServerConfig[]> {
  return new Promise((resolve) => {
    execFile(
      spawn.command,
      [...spawn.args, "mcp", "list", "--json"],
      {
        timeout: opts?.timeoutMs ?? 30_000,
        env: { ...process.env, ...spawn.env },
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        resolve(parseOpenclawMcpList(String(stdout ?? "")))
      },
    )
  })
}
