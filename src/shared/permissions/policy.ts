/**
 * Permission policy vocabulary: the rule classes, the three verdicts, the
 * shipped floor, the tool-rule grammar, and the resolution that turns a policy
 * plus a mode plus a class into one verdict.
 *
 * Pure and node-free so the main process can enforce it and the renderer can
 * render it from the same definitions. `src/shared` imports no node builtin,
 * which is why the file reader lives in `src/main/lib/permissions/` instead.
 * Design and precedence table:
 * `.dump/app/plans/2026-09-13-permission-floor.md`. Decision record:
 * `.dump/app/decisions/2026-09-13-permission-floor.md`.
 */

import { z } from "zod"
import type { AgentMode } from "../agent-mode"

/**
 * Modes a policy file may configure. Plan mode is absent on purpose: the
 * evaluator floors it to read-only plus markdown edits, and a floor that a file
 * could lift would not be a floor. Writing `[modes.plan]` is a schema error, so
 * the attempt fails loudly instead of being ignored. A mode added to
 * `AGENT_MODES` later is not configurable until its floor is decided here.
 */
export const CONFIGURABLE_AGENT_MODES = [
  "ask",
  "edit",
  "agent",
  "turbo",
] as const satisfies readonly AgentMode[]

export type ConfigurableAgentMode = (typeof CONFIGURABLE_AGENT_MODES)[number]

/** What the gate answers. `deny` wins every tie. */
export const PERMISSION_VERDICTS = ["allow", "ask", "deny"] as const

export type PermissionVerdict = (typeof PERMISSION_VERDICTS)[number]

export const permissionVerdictSchema = z.enum(PERMISSION_VERDICTS)

/**
 * The five rule classes step 10 of the roadmap names. A tool call lands in
 * exactly one. There is no sixth class: adding one is an "ask first" boundary
 * in `.dump/app/roadmap/10-permission-floor.md` section 8.
 */
export const PERMISSION_RULE_CLASSES = [
  "read-only",
  "approval",
  "destructive",
  "network",
  "exfiltration",
] as const

export type PermissionRuleClass = (typeof PERMISSION_RULE_CLASSES)[number]

export const permissionRuleClassSchema = z.enum(PERMISSION_RULE_CLASSES)

/**
 * Verdict each class carries when nothing overrides it. The dangerous three
 * deny, the middle tier asks, and only reads allow.
 */
export const DEFAULT_CLASS_VERDICTS: Record<PermissionRuleClass, PermissionVerdict> = {
  "read-only": "allow",
  approval: "ask",
  destructive: "deny",
  network: "deny",
  exfiltration: "deny",
}

/** Per-mode verdicts plus the tool rules that allow without a card. */
export interface ModePolicy {
  "read-only"?: PermissionVerdict
  approval?: PermissionVerdict
  destructive?: PermissionVerdict
  network?: PermissionVerdict
  exfiltration?: PermissionVerdict
  /** Tool rules that allow without a card in this mode. Turbo is the consumer. */
  allow_tools?: string[]
}

/** One fully resolved policy: every class carries a verdict in every mode. */
export interface PermissionPolicy {
  classes: Record<PermissionRuleClass, PermissionVerdict>
  modes: Record<AgentMode, ModePolicy>
}

/** Where a policy came from, so a denial can tell the user which file to edit. */
export const POLICY_SOURCES = ["default", "file", "invalid-file"] as const

export type PolicySource = (typeof POLICY_SOURCES)[number]

/** What `permissions.toml` may contain. Every key is optional. */
export interface PermissionPolicyDocument {
  classes?: Partial<Record<PermissionRuleClass, PermissionVerdict>>
  modes?: Partial<Record<ConfigurableAgentMode, ModePolicy>>
}

/**
 * The floor this app ships. It applies when the file is absent, and it sits
 * underneath whatever the file writes, so a file that mentions only `[classes]`
 * cannot drop the ask-mode or turbo behaviour by omission.
 *
 * Three shipped widenings, each tied to what its mode promises the user in
 * `src/renderer/features/agents/lib/mode-display.ts`:
 *
 * - ask gets `destructive = "ask"`, because ask publishes "Ask permission
 *   before edits, commands and deletions" and a human answers the card, so
 *   denying there would break the mode's own contract.
 * - agent gets `network = "ask"` with `WebFetch` and `WebSearch` on its
 *   allow-list. Those two tools fetch a URL and return it; they cannot carry a
 *   local file outbound. The egress shell commands (`curl`, `wget`, `nc`,
 *   `ssh`, `scp`, `ftp`, `telnet`) can, so they fall through to the `ask`
 *   verdict and reach a human instead of being refused outright. An agent that
 *   could not reach the network at all could not do research.
 * - turbo is the deliberate opt-out tier: every class allows, so it runs
 *   destructive commands and egress without a card.
 *
 * Exfiltration denies in all five modes and no override here lifts it, because
 * `matchAllowList` refuses the class before consulting any list. A mode can be
 * made fast; it cannot be made able to ship a secret out. Plan mode is not here
 * at all.
 */
export const SHIPPED_POLICY_FLOOR: PermissionPolicy = {
  classes: { ...DEFAULT_CLASS_VERDICTS },
  modes: {
    plan: {},
    ask: { destructive: "ask" },
    edit: { approval: "allow" },
    agent: { approval: "allow", network: "ask", allow_tools: ["WebFetch", "WebSearch"] },
    turbo: {
      "read-only": "allow",
      approval: "allow",
      destructive: "allow",
      network: "allow",
      exfiltration: "deny",
      allow_tools: [],
    },
  },
}

/**
 * The one verdict a policy file may not choose for exfiltration.
 *
 * A secret that leaves the machine cannot be taken back, and no later gate can
 * catch it, which is why the classifier treats the read itself as the boundary.
 * The evaluator already refuses to let an allow-list entry cover this class, so
 * letting the class verdict say `allow` would leave that one refusal as the only
 * thing standing between a policy file and a shipped secret. The file rejects it
 * instead, loudly, the same way it rejects `[modes.plan]`.
 *
 * `ask` and `deny` stay available. Being prompted before a secret is read is a
 * legitimate choice and is narrower than what turbo permits for every other
 * class.
 */
const exfiltrationVerdictSchema = permissionVerdictSchema.superRefine((verdict, ctx) => {
  if (verdict === "allow") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'exfiltration cannot be "allow", because a secret that leaves cannot be taken back; use "ask" or "deny"',
    })
  }
})

const toolRuleSchema = z
  .string()
  .min(1)
  .superRefine((rule, ctx) => {
    if (parseToolRule(rule) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a tool rule is `Tool`, `Tool(prefix *)`, `Tool(prefix:*)` or `Tool(exact text)`",
      })
    }
  })

const modePolicySchema = z
  .object({
    "read-only": permissionVerdictSchema.optional(),
    approval: permissionVerdictSchema.optional(),
    destructive: permissionVerdictSchema.optional(),
    network: permissionVerdictSchema.optional(),
    exfiltration: exfiltrationVerdictSchema.optional(),
    allow_tools: z.array(toolRuleSchema).optional(),
  })
  .strict()

/**
 * Strict on purpose. A typo in a security file must fail closed rather than be
 * ignored, so an unknown key anywhere in the document is a schema error and the
 * reader falls back to the shipped floor.
 */
export const permissionPolicyDocumentSchema = z
  .object({
    classes: z
      .object({
        "read-only": permissionVerdictSchema.optional(),
        approval: permissionVerdictSchema.optional(),
        destructive: permissionVerdictSchema.optional(),
        network: permissionVerdictSchema.optional(),
        exfiltration: exfiltrationVerdictSchema.optional(),
      })
      .strict()
      .optional(),
    modes: z.record(z.enum(CONFIGURABLE_AGENT_MODES), modePolicySchema).optional(),
  })
  .strict()

/**
 * Merge a parsed document over the shipped floor. The document wins key by key,
 * and a mode the document never mentions keeps the floor's verdicts and its
 * allow-list, so the floor cannot be dropped by omission.
 */
export function resolvePolicy(document: PermissionPolicyDocument): PermissionPolicy {
  const classes = { ...SHIPPED_POLICY_FLOOR.classes }
  for (const ruleClass of PERMISSION_RULE_CLASSES) {
    const written = document.classes?.[ruleClass]
    if (written) classes[ruleClass] = written
  }

  // Written out per mode on purpose. A mode added to AGENT_MODES later breaks
  // this record's type, which forces whoever adds it to decide its floor.
  const modes: Record<AgentMode, ModePolicy> = {
    plan: { ...SHIPPED_POLICY_FLOOR.modes.plan },
    ask: { ...SHIPPED_POLICY_FLOOR.modes.ask, ...document.modes?.ask },
    edit: { ...SHIPPED_POLICY_FLOOR.modes.edit, ...document.modes?.edit },
    agent: { ...SHIPPED_POLICY_FLOOR.modes.agent, ...document.modes?.agent },
    turbo: { ...SHIPPED_POLICY_FLOOR.modes.turbo, ...document.modes?.turbo },
  }
  return { classes, modes }
}

/** A tool rule from an allow-list, parsed. */
export interface ToolRule {
  tool: string
  /** Argument text the rule constrains. Undefined means the tool name alone. */
  specifier?: string
  /** True when the specifier ended in `*`, so it matches a prefix. */
  prefix?: boolean
  /**
   * True when the rule was spelled `Tool(prefix:*)`. That form requires a
   * separator after the prefix, so it matches `prefix`, `prefix ...` and
   * `prefix:...` but not a longer word that merely starts with the prefix.
   */
  separator?: boolean
}

/**
 * Parse one allow-list entry. Null means malformed.
 *
 * Four spellings, and only four:
 * - `Bash` names a tool, so every call to it matches.
 * - `Bash(git *)` matches a call whose primary argument starts with `git `,
 *   separator included, so it does not match `gitpush`.
 * - `Bash(npm test)` matches that argument exactly.
 * - `Bash(npm run test:*)` is the prefix form other provider docs use. It is
 *   accepted because refusing it made one copied line invalidate a whole policy
 *   file, and the reader then fell back to the shipped floor, so the user lost
 *   every rule they had written. Its colon is ambiguous about whether the
 *   separator belongs to the prefix, so this parser resolves it narrow: the
 *   prefix must be followed by a space, a colon or the end of the argument.
 *   That matches `npm run test --watch` and the `npm run test:unit` script form
 *   the colon exists for, and still refuses `npm run tests` and `gitleaks`.
 */
/**
 * True when a string can stand in for a tool name.
 *
 * A leading dash is refused because these strings become process arguments. An
 * allow-list entry is pushed onto argv as the value of `--allow`, and a parser
 * that reads the next token as a flag rather than as that value would turn
 * `allow_tools = ["--always-approve"]` into the bypass this file exists to keep
 * off the command line. Refusing it here fails the whole document closed and the
 * schema error says what to write instead, which is better than hoping every
 * provider's argument parser is strict.
 */
function isToolName(candidate: string): boolean {
  return candidate.length > 0 && !candidate.startsWith("-")
}

export function parseToolRule(rule: string): ToolRule | null {
  const trimmed = rule.trim()
  if (trimmed.length === 0) return null

  const open = trimmed.indexOf("(")
  if (open === -1) {
    if (trimmed.includes(")")) return null
    return isToolName(trimmed) ? { tool: trimmed } : null
  }
  if (!trimmed.endsWith(")") || trimmed.indexOf(")") !== trimmed.length - 1) return null

  const tool = trimmed.slice(0, open).trim()
  if (!isToolName(tool)) return null

  const pattern = trimmed.slice(open + 1, -1).trim()
  if (pattern.length === 0) return null
  if (pattern.endsWith(":*")) {
    const specifier = pattern.slice(0, -2)
    // `Bash(:*)` is a bare wildcard wearing a specifier's clothes. Refuse it so
    // a whole-tool grant has to be written as the whole tool.
    if (specifier.length === 0) return null
    return { tool, specifier, prefix: true, separator: true }
  }
  if (pattern.endsWith("*")) {
    return { tool, specifier: pattern.slice(0, -1), prefix: true }
  }
  return { tool, specifier: pattern }
}

/** True when a parsed rule covers this tool call's primary argument. */
export function toolRuleMatches(rule: ToolRule, toolName: string, matchText: string): boolean {
  if (rule.tool !== toolName) return false
  if (rule.specifier === undefined) return true
  if (!rule.prefix) return matchText === rule.specifier
  if (!rule.separator) return matchText.startsWith(rule.specifier)
  if (matchText === rule.specifier) return true
  const next = matchText.charAt(rule.specifier.length)
  return matchText.startsWith(rule.specifier) && (next === " " || next === ":")
}

/** The verdict a class carries in a mode, and the rule id that decided it. */
export interface ResolvedVerdict {
  verdict: PermissionVerdict
  /** Stable id: `<class>.mode.<mode>` or `<class>.policy`. */
  rule: string
}

/**
 * Resolve one class in one mode. A per-mode verdict beats the class verdict,
 * because the mode is what the user picked for this run.
 */
export function resolveVerdict(
  policy: PermissionPolicy,
  mode: AgentMode,
  ruleClass: PermissionRuleClass,
): ResolvedVerdict {
  const modeVerdict = policy.modes[mode][ruleClass]
  if (modeVerdict) {
    return { verdict: modeVerdict, rule: `${ruleClass}.mode.${mode}` }
  }
  return { verdict: policy.classes[ruleClass], rule: `${ruleClass}.policy` }
}
