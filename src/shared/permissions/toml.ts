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

/**
 * Key segments that are never accepted, in a header, in a dotted key or as a
 * leaf.
 *
 * `node["__proto__"]` returns `Object.prototype` rather than undefined, so
 * walking that segment reached the shared prototype and then wrote through it.
 * The leaf needs the same refusal for a different reason: this parser allows
 * arrays, an array is an object, and `x.__proto__ = ["a"]` reparents the table
 * the schema validator then reads. Rejecting the segment makes the document
 * malformed, which is the fail-closed answer the rest of this parser gives, and
 * it puts the rule in one place rather than in each of the three spots that walk
 * or assign a key.
 */
const RESERVED_KEY_SEGMENTS = new Set(["__proto__", "constructor", "prototype"])

/** Split a dotted table or key name into parts, honouring quoted segments. */
function splitKeyPath(raw: string): string[] | null {
  const parts: string[] = []
  let index = 0

  while (index < raw.length) {
    const segment = readKeySegment(raw, index)
    if (segment === null || segment.text.length === 0) return null
    if (RESERVED_KEY_SEGMENTS.has(segment.text)) return null
    parts.push(segment.text)
    index = segment.end
    if (index >= raw.length) return parts
    // Anything other than a dot between segments is a malformed key path.
    if (raw[index] !== ".") return null
    index += 1
  }

  // An empty raw, or a trailing dot with no segment after it.
  return null
}

/**
 * Read one key segment, stopping at the dot that ends it. Quoted parts are read
 * by `readString`, so a dot inside quotes belongs to the key rather than
 * separating two of them, and escape handling stays in one place.
 */
function readKeySegment(raw: string, start: number): { text: string; end: number } | null {
  let index = start
  let text = ""

  while (index < raw.length) {
    const char = raw[index]
    if (char === ".") break
    if (char !== '"' && char !== "'") {
      text += char
      index += 1
      continue
    }
    const quoted = readString(raw, index)
    if (quoted === null) return null
    text += quoted.value
    index = quoted.end
  }

  return { text: text.trim(), end: index }
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

/**
 * Parse an array of strings. `body` is the text between the brackets.
 *
 * Elements have to be separated by a comma. Skipping commas and whitespace
 * together, which is what this did first, read `["a" "b"]` as a list of two
 * rules rather than as the malformed document it is, and this file's contract is
 * that a document it cannot read is rejected so the reader falls back to the
 * shipped floor instead of guessing what the user meant.
 */
function parseStringArray(body: string): string[] | null {
  const values: string[] = []
  let index = startOfElement(body, 0)
  while (index < body.length) {
    const parsed = readString(body, index)
    if (parsed === null) return null
    values.push(parsed.value)
    index = startOfElement(body, parsed.end)
    if (index >= body.length) break
    // A second string with nothing between it and the last one is the malformed
    // document this refuses, which is the case the comma check exists for.
    if (body[index] !== ",") return null
    index = startOfElement(body, index + 1)
    if (index >= body.length) break
    // Two commas in a row have no element between them.
    if (body[index] === ",") return null
  }
  return values
}

/**
 * Index of the next element in an array body, which is the length of `body` when
 * a comment ends the list first, so the caller stops reading.
 */
function startOfElement(body: string, from: number): number {
  let index = from
  while (index < body.length && /\s/.test(body[index])) index += 1
  if (body[index] === "#") return body.length
  return index
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

/**
 * Walk or create nested tables, marking every table it creates in `defined`
 * under its absolute path: `base` is the path of `from` from the root, so a
 * dotted key in a table the root does not sit under still records the name a
 * header would use. Null means a value already holds that key. The mark is
 * what keeps a second header from naming a table that already exists,
 * explicit or not.
 */
function descend(
  from: TomlTable,
  path: string[],
  defined: Set<string>,
  base: string[],
): TomlTable | null {
  let node = from
  const walked: string[] = []
  for (const part of path) {
    walked.push(part)
    // `splitKeyPath` has already refused a reserved segment, so every part here
    // is a plain key and reading it cannot reach the shared prototype.
    const existing = Object.hasOwn(node, part) ? node[part] : undefined
    if (existing === undefined) {
      const created: TomlTable = {}
      node[part] = created
      defined.add(base.concat(walked).join("\u0000"))
      node = created
      continue
    }
    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) return null
    node = existing as TomlTable
  }
  return node
}

/** A parse step: either it consumed lines, or the document is invalid. */
type StepResult = { ok: true; resumeAt: number } | { ok: false; error: TomlParseResult }

/** A value read off one line, plus the first line still to read after it. */
type ValueResult =
  | (StepResult & { ok: true; value: unknown })
  | { ok: false; error: TomlParseResult }

/** Parse a document into a plain object. */
export function parseConstrainedToml(text: string): TomlParseResult {
  const root: TomlTable = {}
  const defined = new Set<string>()
  let current: TomlTable = root
  let currentPath: string[] = []
  const physical = text.split(/\r?\n/)
  // The first line still to read. An array that spans several lines moves this
  // past the ones it swallowed, so the loop below never assigns its own counter.
  let resumeAt = 0

  for (const [index, raw] of physical.entries()) {
    if (index < resumeAt) continue
    const lineNumber = index + 1

    const uncommented = stripComment(raw)
    if (uncommented === null) return fail(lineNumber, "unterminated string")
    const line = uncommented.trim()
    if (line.length === 0) continue

    if (line.startsWith("[")) {
      const header = readTableHeader(root, line, defined)
      if ("error" in header) return fail(lineNumber, header.error)
      current = header.table
      currentPath = header.path
      continue
    }

    const applied = applyAssignment(
      current,
      currentPath,
      line,
      lineNumber,
      physical,
      index,
      defined,
    )
    if (!applied.ok) return applied.error
    resumeAt = applied.resumeAt
  }

  return { ok: true, value: root }
}

/**
 * Read a `[table]` header and walk or create the table it names.
 *
 * TOML defines a table at most once, whether the definition came from a header
 * or from the key that created it, so a second header for the same table is a
 * parse error rather than a merge. Merging would let a file this parser claims
 * to read change the settings it says it changes.
 */
function readTableHeader(
  root: TomlTable,
  line: string,
  defined: Set<string>,
): { table: TomlTable; path: string[] } | { error: string } {
  if (line.startsWith("[[") || !line.endsWith("]")) {
    return { error: "only [table] headers are supported" }
  }
  const path = splitKeyPath(line.slice(1, -1))
  if (path === null) return { error: "malformed table header" }
  if (defined.has(path.join("\u0000"))) return { error: "duplicate table header" }
  const table = descend(root, path, defined, [])
  if (table === null) return { error: "table header collides with a value" }
  return { table, path }
}

/** Read one `key = value` line, store it, and report the lines it consumed. */
function applyAssignment(
  current: TomlTable,
  currentPath: string[],
  line: string,
  lineNumber: number,
  physical: string[],
  start: number,
  defined: Set<string>,
): StepResult {
  const equals = findAssignment(line)
  if (equals === -1) return { ok: false, error: fail(lineNumber, "expected key = value") }

  const keyPath = splitKeyPath(line.slice(0, equals))
  if (keyPath === null) return { ok: false, error: fail(lineNumber, "malformed key") }
  const leaf = keyPath.at(-1)
  if (leaf === undefined) return { ok: false, error: fail(lineNumber, "empty key") }

  const read = readValue(line.slice(equals + 1).trim(), lineNumber, physical, start)
  if (!read.ok) return read

  const parent = descend(current, keyPath.slice(0, -1), defined, currentPath)
  if (parent === null) return { ok: false, error: fail(lineNumber, "key collides with a table") }
  if (Object.hasOwn(parent, leaf)) {
    return { ok: false, error: fail(lineNumber, `duplicate key ${leaf}`) }
  }
  parent[leaf] = read.value
  return { ok: true, resumeAt: read.resumeAt }
}

/** Read the value on one line. Only strings and arrays of strings are allowed. */
function readValue(
  rawValue: string,
  lineNumber: number,
  physical: string[],
  start: number,
): ValueResult {
  if (rawValue.startsWith("[")) return readArrayValue(rawValue, lineNumber, physical, start)

  if (rawValue.startsWith('"') || rawValue.startsWith("'")) {
    const parsed = readString(rawValue, 0)
    if (parsed?.end !== rawValue.length) {
      return { ok: false, error: fail(lineNumber, "malformed string value") }
    }
    return { ok: true, value: parsed.value, resumeAt: start + 1 }
  }

  return {
    ok: false,
    error: fail(lineNumber, "only string and string-array values are supported"),
  }
}

/**
 * Read an array of strings, joining the physical lines it spans onto the line
 * that opened it. A comment inside the array is stripped per line, the same as
 * anywhere else in the document.
 */
function readArrayValue(
  rawValue: string,
  lineNumber: number,
  physical: string[],
  start: number,
): ValueResult {
  let body = rawValue
  let lastLine = start

  while (!body.trimEnd().endsWith("]") && lastLine + 1 < physical.length) {
    lastLine += 1
    const next = stripComment(physical[lastLine])
    if (next === null) return { ok: false, error: fail(lastLine + 1, "unterminated string") }
    body += `\n${next.trim()}`
  }

  if (!body.trimEnd().endsWith("]")) {
    return { ok: false, error: fail(lineNumber, "unterminated array") }
  }
  const parsed = parseStringArray(body.slice(1, body.lastIndexOf("]")))
  if (parsed === null) {
    return { ok: false, error: fail(lineNumber, "only arrays of strings are supported") }
  }
  return { ok: true, value: parsed, resumeAt: lastLine + 1 }
}
