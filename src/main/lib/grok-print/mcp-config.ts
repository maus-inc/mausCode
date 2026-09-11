/**
 * Pure config parsers for Grok Build MCP (TOML + `mcp list --json`).
 * Kept electron-free so unit tests run under plain vitest.
 */

import type { McpServerConfig } from "../claude-config"

// ---------------------------------------------------------------------------
// TOML subset reader ([mcp_servers.*] only)
// ---------------------------------------------------------------------------

function stripTomlComment(line: string): string {
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === "'" && !inDouble && line[i - 1] !== "\\") inSingle = !inSingle
    else if (ch === '"' && !inSingle && line[i - 1] !== "\\") inDouble = !inDouble
    else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i)
  }
  return line
}

function parseTomlScalar(raw: string): unknown {
  const text = raw.trim()
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return text
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
  }
  if (text === "true") return true
  if (text === "false") return false
  const numeric = Number(text)
  if (text !== "" && Number.isFinite(numeric)) return numeric
  if (text.startsWith("[") && text.endsWith("]")) {
    // String arrays only (`args = ["a", "b"]`); anything else is kept raw.
    const inner = text.slice(1, -1).trim()
    if (!inner) return []
    const items: unknown[] = []
    for (const chunk of inner.split(",")) {
      // Tolerate trailing commas (`args = ["a",]` is valid TOML).
      if (chunk.trim() === "") continue
      const parsed = parseTomlScalar(chunk)
      if (typeof parsed !== "string") return text
      items.push(parsed)
    }
    return items
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    // Flat inline tables only (`env = { A = "b" }`).
    const inner = text.slice(1, -1).trim()
    const table: Record<string, unknown> = {}
    if (inner) {
      for (const chunk of inner.split(",")) {
        const eq = chunk.indexOf("=")
        if (eq < 0) return text
        const key = chunk.slice(0, eq).trim()
        if (!key) return text
        table[key] = parseTomlScalar(chunk.slice(eq + 1))
      }
    }
    return table
  }
  return text
}

function countUnbalanced(line: string): number {
  let depth = 0
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === "'" && !inDouble && line[i - 1] !== "\\") {
      inSingle = !inSingle
      continue
    }
    if (ch === '"' && !inSingle && line[i - 1] !== "\\") {
      inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue
    if (ch === "[" || ch === "{") depth += 1
    else if (ch === "]" || ch === "}") depth -= 1
  }
  return depth
}

/**
 * Parse `[mcp_servers.<name>]` tables out of a grok `config.toml`.
 * Everything outside `mcp_servers` is ignored. Handles wrapped arrays /
 * inline tables (continuation lines) and one sub-table level
 * (`[mcp_servers.<name>.<section>]`, e.g. `.env`), merged as an object.
 */
export function parseGrokMcpToml(content: string): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {}
  // Join continuation lines so wrapped arrays/tables parse as one value.
  const logicalLines: string[] = []
  let pending = ""
  for (const rawLine of content.split("\n")) {
    pending += (pending ? "\n" : "") + rawLine
    const stripped = stripTomlComment(pending)
    if (countUnbalanced(stripped) > 0) continue
    logicalLines.push(pending)
    pending = ""
  }
  if (pending.trim()) logicalLines.push(pending)

  let current: string | null = null
  let currentSub: string | null = null

  const ensureServer = (name: string): McpServerConfig => {
    if (!servers[name]) servers[name] = {}
    return servers[name]!
  }

  for (const rawLine of logicalLines) {
    const line = stripTomlComment(rawLine).trim()
    if (!line) continue
    const tableMatch = line.match(/^\[([^\]]+)\]$/)
    if (tableMatch) {
      const tablePath = tableMatch[1]!.trim()
      const subMatch = tablePath.match(/^mcp_servers\.([^.[\]]+)\.([^.[\]]+)$/)
      const mcpMatch = tablePath.match(/^mcp_servers\.([^.[\]]+)$/)
      if (subMatch) {
        current = subMatch[1]!
        currentSub = subMatch[2]!
        const server = ensureServer(current)
        if (!server[currentSub] || typeof server[currentSub] !== "object") {
          server[currentSub] = {}
        }
      } else {
        current = mcpMatch ? mcpMatch[1]! : null
        currentSub = null
        if (current) ensureServer(current)
      }
      continue
    }
    if (!current) continue
    const eq = line.indexOf("=")
    if (eq < 0) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    // Newlines inside joined values are insignificant whitespace.
    const value = parseTomlScalar(line.slice(eq + 1).replace(/\n/g, " "))
    if (currentSub) {
      const sub = ensureServer(current)[currentSub]
      if (sub && typeof sub === "object" && !Array.isArray(sub)) {
        ;(sub as Record<string, unknown>)[key] = value
      }
    } else {
      ensureServer(current)[key] = value
    }
  }

  return servers
}

// ---------------------------------------------------------------------------
// `grok mcp list --json` reader (primary)
// ---------------------------------------------------------------------------

function normalizeMcpListEntry(name: string, value: unknown): McpServerConfig | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const config: McpServerConfig = {}
  for (const [key, entryValue] of Object.entries(record)) {
    if (key === "name") continue
    config[key] = entryValue
  }
  if (typeof record.url !== "string" && typeof record.command !== "string") {
    // Transport-less entries (e.g. disabled stubs) carry no usable config.
    return Object.keys(config).length > 0 ? config : null
  }
  return config
}

/**
 * Defensive parse of `grok mcp list --json` output. The exact envelope is
 * not pinned by the docs, so arrays and the common object envelopes are
 * all accepted. Exported for unit tests.
 */
export function parseGrokMcpListJson(value: unknown): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {}
  const absorb = (name: unknown, entry: unknown) => {
    if (typeof name !== "string" || !name) return
    const normalized = normalizeMcpListEntry(name, entry)
    if (normalized) servers[name] = normalized
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const name =
        entry && typeof entry === "object" ? (entry as Record<string, unknown>).name : undefined
      absorb(name, entry)
    }
    return servers
  }
  if (!value || typeof value !== "object") return servers
  const record = value as Record<string, unknown>
  for (const key of ["mcp_servers", "mcpServers", "servers"]) {
    const envelope = record[key]
    if (Array.isArray(envelope)) {
      for (const entry of envelope) {
        const name =
          entry && typeof entry === "object" ? (entry as Record<string, unknown>).name : undefined
        absorb(name, entry)
      }
      return servers
    }
    if (envelope && typeof envelope === "object" && !Array.isArray(envelope)) {
      for (const [name, entry] of Object.entries(envelope as Record<string, unknown>)) {
        absorb(name, entry)
      }
      return servers
    }
  }
  // Bare map fallback: every object value is a server.
  for (const [name, entry] of Object.entries(record)) {
    absorb(name, entry)
  }
  return servers
}
