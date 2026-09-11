/**
 * Native-engine MCP observability, Phase 1 (app-side, no Rust changes).
 *
 * The v1 harness exposes no MCP surface (no events/requests, no tool list;
 * the bridge drops `McpStatus`), so the app mirrors the daemon's own config
 * resolution over the same files plus its schema cache:
 *
 * Sources, low to high precedence (mirrors `McpConfig::load_for_dir` in
 * `runtime/jcode/crates/jcode-base/src/mcp/protocol.rs`):
 *   1. `{jcodeHome}/mcp.json` (jcode global; JCODE_HOME is the manager's home)
 *   2. `~/.claude.json` top-level `mcpServers` + `projects.<cwd>.mcpServers`
 *      (skipped when JCODE_DISABLE_CLAUDE_MCP is set)
 *   3. `~/.claude/mcp.json` (legacy Claude global)
 *   4. Project locals: `.jcode/mcp.json`, `.mcp.json`, `.claude/mcp.json`
 *
 * Collision rule (`merge_servers_preferring_runnable`): incoming wins,
 * except an existing stdio server beats an incoming non-stdio one.
 * Enabled rule (`is_enabled`): `"disabled": true` wins over `"enabled"`;
 * default true.
 *
 * Connection evidence comes from `{jcodeHome}/mcp-schema-cache.json`
 * (version-gated, exactly like the daemon): a server with cached tool
 * schemas was connected at least once under the current config
 * fingerprint... (fingerprint comparison is skipped: the cache is keyed by
 * server name and the daemon re-captures on mismatch, so presence of tools
 * is "connected recently", absence is "not known connected").
 *
 * Status mapping (honest subset of the renderer's MCPServerStatus):
 *   connected — enabled + cached tool schemas present
 *   pending   — enabled + configured, no cache evidence yet
 *   failed    — reserved for Phase 2 (Rust relay of live connect failures);
 *               Phase 1 never emits it for servers. Unparseable config FILES
 *               are reported separately via `errors` (config-failure notices).
 *   needs-auth — never emitted by Phase 1 (unknowable app-side).
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export interface NativeMcpServerConfig {
  command?: string
  transport?: string
  disabled?: boolean
  enabled?: boolean
}

export interface NativeMcpServerView {
  name: string
  /** Absolute path of the config file this definition won from. */
  source: string
  enabled: boolean
  status: "connected" | "pending"
  /** Cached tool names (empty unless connected). */
  tools: string[]
}

export interface NativeMcpConfigError {
  file: string
  error: string
}

export interface NativeMcpSnapshot {
  servers: NativeMcpServerView[]
  errors: NativeMcpConfigError[]
}

const PROJECT_CONFIG_FILES = [".jcode/mcp.json", ".mcp.json", ".claude/mcp.json"]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJsonFile(file: string): { value?: unknown; error?: string } {
  let content: string
  try {
    content = fs.readFileSync(file, "utf8")
  } catch {
    return {}
  }
  try {
    return { value: JSON.parse(content) as unknown }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Mirror of `McpServerConfig::is_stdio`. */
function isStdioConfig(cfg: NativeMcpServerConfig): boolean {
  if (typeof cfg.transport === "string") {
    const t = cfg.transport.toLowerCase()
    if (t === "http" || t === "sse" || t === "streamable-http") return false
  }
  return (cfg.command ?? "").trim().length > 0
}

/** Mirror of `McpServerConfig::is_enabled`. */
export function isMcpServerEnabled(cfg: NativeMcpServerConfig): boolean {
  if (cfg.disabled === true || cfg.disabled === false) return !cfg.disabled
  if (typeof cfg.enabled === "boolean") return cfg.enabled
  return true
}

function extractServers(value: unknown): Record<string, NativeMcpServerConfig> {
  if (!isRecord(value)) return {}
  const map = value["mcpServers"] ?? value["servers"]
  if (!isRecord(map)) return {}
  const out: Record<string, NativeMcpServerConfig> = {}
  for (const [name, cfg] of Object.entries(map)) {
    if (isRecord(cfg)) out[name] = cfg as unknown as NativeMcpServerConfig
  }
  return out
}

interface SourcedConfig {
  cfg: NativeMcpServerConfig
  source: string
}

/** Mirror of `merge_servers_preferring_runnable` (tracks winning source). */
function mergePreferringRunnable(
  existing: Map<string, SourcedConfig>,
  incoming: Record<string, NativeMcpServerConfig>,
  source: string,
): void {
  for (const [name, cfg] of Object.entries(incoming)) {
    const current = existing.get(name)
    if (current && isStdioConfig(current.cfg) && !isStdioConfig(cfg)) continue
    existing.set(name, { cfg, source })
  }
}

/**
 * Resolve the effective MCP server map for a project directory, mirroring
 * the daemon's `McpConfig::load_for_dir`. `homeDir` is injectable for tests
 * (defaults to the real user home: `~/.claude.json` / `~/.claude/mcp.json`
 * are read from the REAL home, like the daemon does).
 */
export function resolveNativeMcpConfigs(
  projectDir: string,
  jcodeHome: string,
  homeDir: string = os.homedir(),
): { servers: Map<string, SourcedConfig>; errors: NativeMcpConfigError[] } {
  const merged = new Map<string, SourcedConfig>()
  const errors: NativeMcpConfigError[] = []

  const loadLayer = (file: string): void => {
    const { value, error } = readJsonFile(file)
    if (error) {
      errors.push({ file, error: `Unparseable MCP config (daemon ignores this file): ${error}` })
      return
    }
    if (value === undefined) return
    mergePreferringRunnable(merged, extractServers(value), file)
  }

  // 1. jcode global.
  loadLayer(path.join(jcodeHome, "mcp.json"))

  // 2-3. Claude sources (live in the daemon unless disabled).
  if (process.env["JCODE_DISABLE_CLAUDE_MCP"] === undefined) {
    const claudeJson = path.join(homeDir, ".claude.json")
    const { value, error } = readJsonFile(claudeJson)
    if (error) {
      errors.push({
        file: claudeJson,
        error: `Unparseable MCP config (daemon ignores this file): ${error}`,
      })
    } else if (value !== undefined && isRecord(value)) {
      // Top-level mcpServers...
      mergePreferringRunnable(merged, extractServers(value), claudeJson)
      // ...then per-project entries for this project dir.
      const projects = value["projects"]
      if (isRecord(projects)) {
        const project = projects[projectDir]
        if (isRecord(project)) {
          mergePreferringRunnable(
            merged,
            extractServers(project),
            `${claudeJson} (project ${projectDir})`,
          )
        }
      }
    }
    loadLayer(path.join(homeDir, ".claude", "mcp.json"))
  }

  // 4. Project locals, in override order.
  for (const relative of PROJECT_CONFIG_FILES) {
    loadLayer(path.join(projectDir, relative))
  }

  return { servers: merged, errors }
}

interface CachedServerSchemas {
  fingerprint: string
  tools: { name: string }[]
}

/**
 * Read the daemon's MCP schema cache (`{jcodeHome}/mcp-schema-cache.json`),
 * version-gated exactly like the daemon (unknown version / unparseable =
 * empty, never throws).
 */
export function readMcpSchemaCache(jcodeHome: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const { value } = readJsonFile(path.join(jcodeHome, "mcp-schema-cache.json"))
  if (!isRecord(value) || value["version"] !== 1) return out
  const servers = value["servers"]
  if (!isRecord(servers)) return out
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue
    const tools = (entry as unknown as CachedServerSchemas).tools
    if (!Array.isArray(tools)) continue
    out.set(
      name,
      tools
        .filter((t) => isRecord(t) && typeof t["name"] === "string")
        .map((t) => (t as { name: string }).name),
    )
  }
  return out
}

/**
 * Full Phase 1 snapshot: effective configs + cache evidence. Disabled
 * servers are omitted (the daemon never auto-connects them; Phase 2
 * surfaces on-demand state via the Rust relay).
 */
export function resolveNativeMcpSnapshot(
  projectDir: string,
  jcodeHome: string,
  homeDir: string = os.homedir(),
): NativeMcpSnapshot {
  const { servers, errors } = resolveNativeMcpConfigs(projectDir, jcodeHome, homeDir)
  const cache = readMcpSchemaCache(jcodeHome)
  const views: NativeMcpServerView[] = []
  for (const [name, { cfg, source }] of servers) {
    if (!isMcpServerEnabled(cfg)) continue
    const cached = cache.get(name) ?? []
    views.push({
      name,
      source,
      enabled: true,
      status: cached.length > 0 ? "connected" : "pending",
      tools: cached,
    })
  }
  views.sort((a, b) => a.name.localeCompare(b.name))
  return { servers: views, errors }
}
