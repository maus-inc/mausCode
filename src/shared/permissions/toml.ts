/**
 * A constrained TOML reader for the permission policy file.
 *
 * No TOML parser is installed and `AGENTS.md` forbids adding a dependency
 * outside the dependency step, so this module parses exactly the subset the
 * policy file uses and rejects everything else. Rejecting is the safe direction:
 * `readPolicyFile` turns a rejection into the shipped deny-by-default floor, so
 * a file this parser cannot read never widens anything.
 *
 * Supported subset, per TOML v1.0.0 (https://toml.io/en/v1.0.0): comments,
 * blank lines, `[table]` and `[table.sub]` headers, bare and quoted keys,
 * dotted key paths, basic and literal strings, and arrays of strings on one
 * line or many. Not supported: integers, floats, booleans, dates, inline
 * tables, and arrays of tables.
 *
 * Read-only on purpose. Nothing writes this file yet: the policy is edited by
 * hand, and a serializer with no caller is an unused export. The settings
 * surface that writes it adds the writer, and this subset is the contract that
 * writer will have to stay inside.
 */

/** Result of a parse. `error` names the line, so a user can fix their file. */
export type TomlParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

type TomlTable = Record<string, unknown>

function fail(line: number, message: string): TomlParseResult {
  return { ok: false, error: `line ${line}: ${message}` }
}

/**
 * Strip a trailing comment, respecting quotes. Null means the line ends inside
 * an unterminated string, which the caller reports.
 */
function stripComment(line: string): string | null {
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === "#") return line.slice(0, index)
    if (char === '"' || char === "'") {
      const closed = skipString(line, index)
      if (closed === -1) return null
      index = closed
      continue
    }
    index += 1
  }
  return line
}

/** Index just past the string that starts at `start`, or -1 when unterminated. */
function skipString(text: string, start: number): number {
  const quote = text[start]
  let index = start + 1
  while (index < text.length) {
    if (text[index] === "\\" && quote === '"') {
      index += 2
      continue
    }
    if (text[index] === quote) return index + 1
    index += 1
  }
  return -1
}

/** Split a dotted table or key name into parts, honouring quoted segments. */
function splitKeyPath(raw: string): string[] | null {
  const parts: string[] = []
  let index = 0
  let current = ""
  let openQuote: string | null = null

  while (index < raw.length) {
    const char = raw[index]
    if (openQuote) {
      if (char === "\\" && openQuote === '"') {
        const next = raw[index + 1]
        const unescaped = next === undefined ? null : unescapeBasic(next)
        if (unescaped === null) return null
        current += unescaped
        index += 2
        continue
      }
      if (char === openQuote) {
        openQuote = null
        index += 1
        continue
      }
      current += char
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      openQuote = char
      index += 1
      continue
    }
    if (char === ".") {
      const trimmed = current.trim()
      if (trimmed.length === 0) return null
      parts.push(trimmed)
      current = ""
      index += 1
      continue
    }
    current += char
    index += 1
  }

  if (openQuote) return null
  const trimmed = current.trim()
  if (trimmed.length === 0) return null
  parts.push(trimmed)
  return parts
}

/** Translate one basic-string escape. Null means the escape is not valid TOML. */
function unescapeBasic(char: string): string | null {
  switch (char) {
    case "n":
      return "\n"
    case "t":
      return "\t"
    case "r":
      return "\r"
    case "f":
      return "\f"
    case "b":
      return "\b"
    case '"':
      return '"'
    case "\\":
      return "\\"
    default:
      return null
  }
}

/** Read a basic or literal string starting at `start`. */
function readString(text: string, start: number): { value: string; end: number } | null {
  const quote = text[start]
  if (quote !== '"' && quote !== "'") return null

  let index = start + 1
  let value = ""
  while (index < text.length) {
    const char = text[index]
    if (char === "\\" && quote === '"') {
      const next = text[index + 1]
      if (next === undefined) return null
      const unescaped = unescapeBasic(next)
      if (unescaped === null) return null
      value += unescaped
      index += 2
      continue
    }
    if (char === quote) return { value, end: index + 1 }
    value += char
    index += 1
  }
  return null
}

/** Parse an array of strings. `body` is the text between the brackets. */
function parseStringArray(body: string): string[] | null {
  const values: string[] = []
  let index = 0
  while (index < body.length) {
    while (index < body.length && /[\s,]/.test(body[index])) index += 1
    if (index >= body.length) break
    if (body[index] === "#") break
    const parsed = readString(body, index)
    if (parsed === null) return null
    values.push(parsed.value)
    index = parsed.end
  }
  return values
}

/** Index of the `=` that separates key from value, ignoring quoted keys. */
function findAssignment(line: string): number {
  let index = 0
  while (index < line.length) {
    const char = line[index]
    if (char === '"' || char === "'") {
      const parsed = readString(line, index)
      if (parsed === null) return -1
      index = parsed.end
      continue
    }
    if (char === "=") return index
    index += 1
  }
  return -1
}

/** Walk or create nested tables. Null means a value already holds that key. */
function descend(from: TomlTable, path: string[]): TomlTable | null {
  let node = from
  for (const part of path) {
    const existing = node[part]
    if (existing === undefined) {
      const created: TomlTable = {}
      node[part] = created
      node = created
      continue
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return null
    node = existing as TomlTable
  }
  return node
}

/** Parse a document into a plain object. */
export function parseConstrainedToml(text: string): TomlParseResult {
  const root: TomlTable = {}
  let current: TomlTable = root
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1
    const uncommented = stripComment(lines[index])
    if (uncommented === null) return fail(lineNumber, "unterminated string")
    const line = uncommented.trim()
    if (line.length === 0) continue

    if (line.startsWith("[")) {
      if (line.startsWith("[[") || !line.endsWith("]")) {
        return fail(lineNumber, "only [table] headers are supported")
      }
      const path = splitKeyPath(line.slice(1, -1))
      if (path === null) return fail(lineNumber, "malformed table header")
      const table = descend(root, path)
      if (table === null) return fail(lineNumber, "table header collides with a value")
      current = table
      continue
    }

    const equals = findAssignment(line)
    if (equals === -1) return fail(lineNumber, "expected key = value")

    const keyPath = splitKeyPath(line.slice(0, equals))
    if (keyPath === null) return fail(lineNumber, "malformed key")
    const leaf = keyPath[keyPath.length - 1]
    if (leaf === undefined) return fail(lineNumber, "empty key")

    const rawValue = line.slice(equals + 1).trim()
    let value: unknown
    let lastLine = index

    if (rawValue.startsWith("[")) {
      let body = rawValue
      while (!body.trimEnd().endsWith("]") && lastLine + 1 < lines.length) {
        lastLine += 1
        const next = stripComment(lines[lastLine])
        if (next === null) return fail(lastLine + 1, "unterminated string")
        body += `\n${next.trim()}`
      }
      if (!body.trimEnd().endsWith("]")) return fail(lineNumber, "unterminated array")
      const parsed = parseStringArray(body.slice(1, body.lastIndexOf("]")))
      if (parsed === null) return fail(lineNumber, "only arrays of strings are supported")
      value = parsed
      index = lastLine
    } else if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
      const parsed = readString(rawValue, 0)
      if (parsed === null || parsed.end !== rawValue.length) {
        return fail(lineNumber, "malformed string value")
      }
      value = parsed.value
    } else {
      return fail(lineNumber, "only string and string-array values are supported")
    }

    const parent = descend(current, keyPath.slice(0, -1))
    if (parent === null) return fail(lineNumber, "key collides with a table")
    if (Object.hasOwn(parent, leaf)) return fail(lineNumber, `duplicate key ${leaf}`)
    parent[leaf] = value
  }

  return { ok: true, value: root }
}
