/**
 * The constrained TOML reader.
 *
 * Rejecting is the safe direction here: `readPolicyFile` turns a rejection into
 * the shipped deny-by-default floor, so a file this parser cannot read never
 * widens anything. That is why the rejection cases carry as much weight as the
 * supported subset, and why each one asserts the line number a user would need
 * to fix their file.
 */
import { describe, expect, it } from "vitest"
import { parseConstrainedToml } from "./toml"

function ok(text: string): Record<string, unknown> {
  const result = parseConstrainedToml(text)
  expect(result.ok, JSON.stringify(result)).toBe(true)
  return result.ok ? result.value : {}
}

function error(text: string): string {
  const result = parseConstrainedToml(text)
  expect(result.ok, JSON.stringify(result)).toBe(false)
  return result.ok ? "" : result.error
}

describe("the supported subset", () => {
  it("reads an empty document", () => {
    expect(ok("")).toEqual({})
    expect(ok("\n\n")).toEqual({})
  })

  it("reads a bare key and a basic string", () => {
    expect(ok('destructive = "ask"')).toEqual({ destructive: "ask" })
  })

  it("ignores comments and blank lines", () => {
    const text = `# a leading comment

destructive = "ask"   # a trailing comment
# another
`
    expect(ok(text)).toEqual({ destructive: "ask" })
  })

  it("keeps a hash inside a string", () => {
    expect(ok('rule = "Bash(git #1 *)"')).toEqual({ rule: "Bash(git #1 *)" })
  })

  it("reads a table header", () => {
    expect(ok('[classes]\nnetwork = "deny"')).toEqual({ classes: { network: "deny" } })
  })

  it("reads a nested table header", () => {
    expect(ok('[modes.turbo]\napproval = "allow"')).toEqual({
      modes: { turbo: { approval: "allow" } },
    })
  })

  it("reads a quoted key", () => {
    expect(ok('"read-only" = "allow"')).toEqual({ "read-only": "allow" })
  })

  it("reads a dotted key path", () => {
    expect(ok('modes.agent.approval = "allow"')).toEqual({
      modes: { agent: { approval: "allow" } },
    })
  })

  it("reads a literal string with no escapes", () => {
    const result = ok("rule = 'Bash(git *)'")
    expect(result).toEqual({ rule: "Bash(git *)" })
  })

  it("does not interpret escapes inside a literal string", () => {
    const result = ok(String.raw`rule = 'a\nb'`)
    expect(result).toEqual({ rule: String.raw`a\nb` })
  })

  it.each([
    ["\\n", "\n"],
    ["\\t", "\t"],
    ["\\r", "\r"],
    ["\\f", "\f"],
    ["\\b", "\b"],
    ['\\"', '"'],
    ["\\\\", "\\"],
  ])("unescapes %s in a basic string", (written, expected) => {
    expect(ok(`value = "a${written}b"`)).toEqual({ value: `a${expected}b` })
  })

  it.each([
    ["\\u00e9", "\u00e9"],
    ["\\u00E9", "\u00e9"],
    ["\\U0001F600", "\u{1F600}"],
  ])("unescapes the unicode escape %s in a basic string", (written, expected) => {
    expect(ok(`value = "a${written}b"`)).toEqual({ value: `a${expected}b` })
  })

  it("rejects a unicode escape with a bad digit, no digit, a surrogate at either width, or a point past 0x10FFFF", () => {
    expect(error('value = "a\\u12G4b"')).toContain("malformed string value")
    expect(error('value = "a\\u12"')).toContain("malformed string value")
    expect(error('value = "a\\ud800b"')).toContain("malformed string value")
    expect(error('value = "a\\U0000D800b"')).toContain("malformed string value")
    expect(error('value = "a\\U0000DFFFb"')).toContain("malformed string value")
    expect(error('value = "a\\U110000b"')).toContain("malformed string value")
  })

  it("reads a one-line array of strings", () => {
    expect(ok('allow_tools = ["Bash(git *)", "Read"]')).toEqual({
      allow_tools: ["Bash(git *)", "Read"],
    })
  })

  it("reads an empty array", () => {
    expect(ok("allow_tools = []")).toEqual({ allow_tools: [] })
  })

  it("reads a multi-line array", () => {
    const text = `allow_tools = [
  "Bash(git *)",
  "Bash(npm test)",
]`
    expect(ok(text)).toEqual({ allow_tools: ["Bash(git *)", "Bash(npm test)"] })
  })

  it("reads the whole policy file shape", () => {
    const text = `# mausCode permission policy

[classes]
destructive = "ask"

[modes.turbo]
approval = "allow"
allow_tools = [
  "Bash(git *)",
  "Bash(npm test)",
]
`
    expect(ok(text)).toEqual({
      classes: { destructive: "ask" },
      modes: { turbo: { approval: "allow", allow_tools: ["Bash(git *)", "Bash(npm test)"] } },
    })
  })
})

describe("rejections", () => {
  it("names the line", () => {
    const text = 'good = "yes"\nbad = 7\n'
    expect(error(text)).toContain("line 2")
  })

  it.each([
    ["an integer", "count = 7"],
    ["a float", "count = 7.5"],
    ["a boolean", "enabled = true"],
    ["a date", "when = 1979-05-27"],
    ["an inline table", 'point = { x = "1" }'],
  ])("refuses %s", (_label, text) => {
    expect(error(text)).toContain("only string and string-array values are supported")
  })

  it("refuses a value with no key at all", () => {
    // No `=` on the line, so this is a missing assignment rather than a bad
    // value type. The message says which, because the fix is different.
    expect(error('"ask"')).toContain("expected key = value")
  })

  it("refuses an array of tables", () => {
    expect(error("[[rules]]")).toContain("only [table] headers are supported")
  })

  it("refuses an unterminated table header", () => {
    expect(error("[classes")).toContain("only [table] headers are supported")
  })

  it("refuses an unterminated string", () => {
    expect(error('value = "open')).toContain("unterminated string")
  })

  it("refuses an unterminated array", () => {
    expect(error('allow_tools = ["a"')).toContain("unterminated array")
  })

  it("refuses an array of integers", () => {
    expect(error("allow_tools = [1, 2]")).toContain("only arrays of strings are supported")
  })

  it("refuses a duplicate key", () => {
    expect(error('a = "1"\na = "2"')).toContain("duplicate key a")
  })

  it("refuses a table a second header names, explicit or created by a key", () => {
    expect(error('[a]\nx = "1"\n[a]\ny = "2"')).toContain("duplicate table header")
    expect(error('[a.b]\nx = "1"\n[a]\ny = "2"')).toContain("duplicate table header")
    expect(error('a.b = "1"\n[a]\nc = "2"')).toContain("duplicate table header")
  })

  it("records a table created by a dotted key under its absolute name", () => {
    // The key lives in table `a`, so the table it creates is `a.b`, the name a
    // header would use, and the header is the duplicate it is.
    expect(error('[a]\nb.c = "1"\n[a.b]\nd = "2"')).toContain("duplicate table header")
    expect(error('a.b.c = "1"\n[a.b]\nd = "2"')).toContain("duplicate table header")
  })

  it("lets a deeper header define a table its parent header left unnamed", () => {
    const result = parseConstrainedToml('[a]\nx = "1"\n[a.b]\ny = "2"')
    expect(result.ok).toBe(true)
  })

  it("lets a sibling header stand beside a table a dotted key created", () => {
    const result = parseConstrainedToml('[a]\nb.c = "1"\n[a.c]\nd = "2"')
    expect(result.ok).toBe(true)
  })

  it("refuses a key that collides with a table", () => {
    expect(error('[a]\nb = "1"\n[a.b]\nc = "2"')).toContain("collides")
  })

  it("refuses a table header that collides with a value", () => {
    expect(error('a = "1"\n[a.b]\nc = "2"')).toContain("collides")
  })

  it.each([
    'allow_tools = ["a" "b"]',
    'allow_tools = [, "a"]',
    'allow_tools = ["a",, "b"]',
    // A comment inside the brackets swallows the closing one, which the array
    // reader already refuses rather than guessing where the list ended.
    'allow_tools = ["a" # trailing comment]',
  ])("refuses an array whose elements are not comma separated: %s", (document) => {
    expect(parseConstrainedToml(document).ok).toBe(false)
  })

  it.each([
    ['allow_tools = ["a", "b"]', ["a", "b"]],
    ['allow_tools = ["a",]', ["a"]],
    ["allow_tools = []", []],
    ['allow_tools = ["a"] # trailing comment', ["a"]],
  ])("still reads a well formed array in %s", (document, expected) => {
    const parsed = parseConstrainedToml(document)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.allow_tools).toEqual(expected)
  })

  it("refuses a malformed key", () => {
    expect(error('= "value"')).toContain("malformed key")
  })

  it.each([
    "[__proto__]\nx = 1",
    "__proto__.x = 1",
    "[a.__proto__]\ny = 2",
    "constructor.prototype.polluted = true",
    "[constructor]\n[constructor.prototype]\npolluted = true",
    // A reserved leaf, which the walk never sees because the leaf is assigned
    // rather than descended into. This parser allows arrays and an array is an
    // object, so assigning one to `__proto__` reparents the table.
    'x.__proto__ = ["polluted"]',
    'x.prototype = ["polluted"]',
    'x.constructor = ["polluted"]',
  ])("refuses the reserved key segment in `%s`", (document) => {
    const own = Object.getOwnPropertyNames(Object.prototype).length
    const parsed = parseConstrainedToml(document)
    expect(parsed.ok).toBe(false)
    expect(Object.getOwnPropertyNames(Object.prototype)).toHaveLength(own)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it("refuses a missing assignment", () => {
    expect(error("destructive")).toContain("expected key = value")
  })

  it("refuses an invalid escape in a basic string", () => {
    expect(error(String.raw`value = "a\qb"`)).toContain("malformed string value")
  })
})
