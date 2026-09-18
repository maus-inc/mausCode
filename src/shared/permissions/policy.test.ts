/**
 * The policy vocabulary: the floor, the merge, the schema, and the tool-rule
 * grammar.
 *
 * Roadmap step 10 section 10 asks for one test per allow rule, which is what the
 * `parseToolRule` and `toolRuleMatches` blocks below are. The grammar has three
 * spellings and refuses a fourth, and the refusal matters: an allow-list that
 * has to guess a separator guesses wide.
 */
import { describe, expect, it } from "vitest"
import { AGENT_MODES } from "../agent-mode"
import {
  CONFIGURABLE_AGENT_MODES,
  DEFAULT_CLASS_VERDICTS,
  PERMISSION_RULE_CLASSES,
  PERMISSION_VERDICTS,
  parseToolRule,
  permissionPolicyDocumentSchema,
  resolvePolicy,
  resolveVerdict,
  SHIPPED_POLICY_FLOOR,
  type ToolRule,
  toolRuleMatches,
} from "./policy"

describe("the shipped floor", () => {
  it("denies the three dangerous classes and asks on the middle tier", () => {
    expect(SHIPPED_POLICY_FLOOR.classes).toEqual({
      "read-only": "allow",
      approval: "ask",
      destructive: "deny",
      network: "deny",
      exfiltration: "deny",
    })
    expect(SHIPPED_POLICY_FLOOR.classes).toEqual(DEFAULT_CLASS_VERDICTS)
  })

  it("widens exactly one thing: destructive asks in ask mode", () => {
    expect(SHIPPED_POLICY_FLOOR.modes.ask).toEqual({ destructive: "ask" })
  })

  it("lets edit, agent and turbo edit files without a card", () => {
    for (const mode of ["edit", "agent", "turbo"] as const) {
      expect(SHIPPED_POLICY_FLOOR.modes[mode].approval).toBe("allow")
    }
  })

  it("gives turbo an empty allow-list, so it starts by denying what is unlisted", () => {
    expect(SHIPPED_POLICY_FLOOR.modes.turbo.allow_tools).toEqual([])
  })

  it("does not let a file configure plan mode", () => {
    expect(SHIPPED_POLICY_FLOOR.modes.plan).toEqual({})
    expect(CONFIGURABLE_AGENT_MODES).not.toContain("plan")
    expect(CONFIGURABLE_AGENT_MODES.every((m) => AGENT_MODES.includes(m))).toBe(true)
  })

  it("covers every class and every verdict in its vocabulary", () => {
    expect(PERMISSION_RULE_CLASSES).toHaveLength(5)
    expect(PERMISSION_VERDICTS).toEqual(["allow", "ask", "deny"])
  })
})

describe("resolvePolicy", () => {
  it("is the floor when the document is empty", () => {
    expect(resolvePolicy({})).toEqual(SHIPPED_POLICY_FLOOR)
  })

  it("lets the document win key by key", () => {
    const policy = resolvePolicy({ classes: { destructive: "ask" } })
    expect(policy.classes.destructive).toBe("ask")
    expect(policy.classes.network).toBe("deny")
  })

  it("keeps the floor for a mode the document never mentions", () => {
    const policy = resolvePolicy({ modes: { turbo: { allow_tools: ["Bash(git *)"] } } })
    expect(policy.modes.ask).toEqual(SHIPPED_POLICY_FLOOR.modes.ask)
    expect(policy.modes.edit).toEqual(SHIPPED_POLICY_FLOOR.modes.edit)
    expect(policy.modes.turbo.allow_tools).toEqual(["Bash(git *)"])
    // turbo's floor verdicts survive a document that only wrote its allow-list
    expect(policy.modes.turbo.approval).toBe("allow")
  })

  it("cannot drop the floor by omission", () => {
    const policy = resolvePolicy({ classes: { "read-only": "deny" } })
    expect(policy.modes.agent).toEqual(SHIPPED_POLICY_FLOOR.modes.agent)
    expect(policy.classes["read-only"]).toBe("deny")
  })
})

describe("the schema fails closed", () => {
  const rejected: Array<[string, unknown]> = [
    ["an unknown top-level key", { clases: {} }],
    ["an unknown class", { classes: { "read-write": "deny" } }],
    ["an unknown verdict", { classes: { network: "maybe" } }],
    ["an unknown mode", { modes: { yolo: { approval: "allow" } } }],
    ["a plan-mode block", { modes: { plan: { approval: "allow" } } }],
    ["an unknown per-mode key", { modes: { agent: { shell: "allow" } } }],
    ["a malformed tool rule", { modes: { turbo: { allow_tools: ["Bash(git"] } } }],
    ["a colon wildcard with no prefix", { modes: { turbo: { allow_tools: ["Bash(:*)"] } } }],
    ["an empty tool rule", { modes: { turbo: { allow_tools: [""] } } }],
    ["a non-string tool rule", { modes: { turbo: { allow_tools: [7] } } }],
  ]

  it.each(rejected)("refuses %s rather than ignoring it", (_label, document) => {
    expect(permissionPolicyDocumentSchema.safeParse(document).success).toBe(false)
  })

  it("accepts a well-formed document", () => {
    const parsed = permissionPolicyDocumentSchema.safeParse({
      classes: { destructive: "ask" },
      modes: {
        turbo: { allow_tools: ["Bash(git *)", "Bash(npm test)", "Bash(npm run test:*)", "Read"] },
      },
    })
    expect(parsed.success).toBe(true)
  })
})

describe("parseToolRule", () => {
  it("reads a bare tool name as matching every call", () => {
    expect(parseToolRule("Read")).toEqual({ tool: "Read" })
    expect(parseToolRule("Bash")).toEqual({ tool: "Bash" })
  })

  it("reads a prefix rule and keeps the separator in the prefix", () => {
    expect(parseToolRule("Bash(git *)")).toEqual({ tool: "Bash", specifier: "git ", prefix: true })
  })

  it("reads an exact rule", () => {
    expect(parseToolRule("Bash(npm test)")).toEqual({ tool: "Bash", specifier: "npm test" })
  })

  it("reads an explicit wildcard for a whole tool", () => {
    expect(parseToolRule("Bash(*)")).toEqual({ tool: "Bash", specifier: "", prefix: true })
  })

  it("tolerates surrounding whitespace", () => {
    expect(parseToolRule("  Bash( git * )  ")).toEqual({
      tool: "Bash",
      specifier: "git ",
      prefix: true,
    })
  })

  it("parses the colon prefix spelling as a separator-aware prefix", () => {
    expect(parseToolRule("Bash(npm run test:*)")).toEqual({
      tool: "Bash",
      specifier: "npm run test",
      prefix: true,
      separator: true,
    })
  })

  const refused = [
    "a colon wildcard with no prefix",
    "Bash(:*)",
    "an unclosed paren",
    "Bash(git",
    "an empty specifier",
    "Bash()",
    "a stray close paren",
    "Bash)",
    "a missing tool name",
    "(* )",
    "an empty rule",
    "   ",
    "trailing text after the rule",
    "Bash(git *) extra",
  ]

  for (let i = 0; i < refused.length; i += 2) {
    const label = refused[i] as string
    const rule = refused[i + 1] as string
    it(`refuses ${label}`, () => {
      expect(parseToolRule(rule)).toBeNull()
    })
  }
})

describe("toolRuleMatches", () => {
  /** Parse or fail: a rule these tests depend on must not be malformed. */
  function rule(text: string): ToolRule {
    const parsed = parseToolRule(text)
    if (parsed === null) throw new Error(`expected ${JSON.stringify(text)} to parse`)
    return parsed
  }

  const git = rule("Bash(git *)")
  const npmTest = rule("Bash(npm test)")
  const anyBash = rule("Bash")
  const wildcard = rule("Bash(*)")
  const colonForm = rule("Bash(npm run test:*)")

  it("matches a colon rule on a space, a colon or the end of the argument", () => {
    expect(toolRuleMatches(colonForm, "Bash", "npm run test")).toBe(true)
    expect(toolRuleMatches(colonForm, "Bash", "npm run test --watch")).toBe(true)
    // The colon form exists for npm scripts named with a colon, so it has to
    // reach them.
    expect(toolRuleMatches(colonForm, "Bash", "npm run test:unit")).toBe(true)
    // A longer word that shares the prefix is a different command. The official
    // wording calls this prefix matching and a published guide calls it a
    // separator requirement, and the narrow reading satisfies both.
    expect(toolRuleMatches(colonForm, "Bash", "npm run tests")).toBe(false)
    expect(toolRuleMatches(colonForm, "Bash", "npm run")).toBe(false)
    expect(toolRuleMatches(colonForm, "Bash", "npm run lint")).toBe(false)
  })

  it("matches a prefix only when the separator is there", () => {
    expect(toolRuleMatches(git, "Bash", "git status")).toBe(true)
    expect(toolRuleMatches(git, "Bash", "gitpush origin")).toBe(false)
    expect(toolRuleMatches(git, "Bash", "git")).toBe(false)
  })

  it("matches an exact rule only on equality", () => {
    expect(toolRuleMatches(npmTest, "Bash", "npm test")).toBe(true)
    expect(toolRuleMatches(npmTest, "Bash", "npm test -- --watch")).toBe(false)
  })

  it("matches a bare tool name for any call to it", () => {
    expect(toolRuleMatches(anyBash, "Bash", "rm -rf /")).toBe(true)
    expect(toolRuleMatches(anyBash, "Bash", "")).toBe(true)
  })

  it("matches an explicit wildcard for any argument", () => {
    expect(toolRuleMatches(wildcard, "Bash", "anything at all")).toBe(true)
  })

  it("never matches a different tool", () => {
    expect(toolRuleMatches(git, "Read", "git status")).toBe(false)
    expect(toolRuleMatches(anyBash, "Edit", "x")).toBe(false)
  })
})

describe("resolveVerdict", () => {
  it("prefers the per-mode verdict and says the mode decided", () => {
    const resolved = resolveVerdict(SHIPPED_POLICY_FLOOR, "ask", "destructive")
    expect(resolved).toEqual({ verdict: "ask", rule: "destructive.mode.ask" })
  })

  it("falls back to the class verdict and says the policy decided", () => {
    const resolved = resolveVerdict(SHIPPED_POLICY_FLOOR, "agent", "destructive")
    expect(resolved).toEqual({ verdict: "deny", rule: "destructive.policy" })
  })

  it("allows reads everywhere and edits in the acting modes", () => {
    for (const mode of AGENT_MODES) {
      expect(resolveVerdict(SHIPPED_POLICY_FLOOR, mode, "read-only").verdict).toBe("allow")
    }
    for (const mode of ["edit", "agent", "turbo"] as const) {
      expect(resolveVerdict(SHIPPED_POLICY_FLOOR, mode, "approval").verdict).toBe("allow")
    }
  })

  it("denies exfiltration in every mode, including turbo", () => {
    for (const mode of AGENT_MODES) {
      expect(resolveVerdict(SHIPPED_POLICY_FLOOR, mode, "exfiltration").verdict).toBe("deny")
    }
  })
})
