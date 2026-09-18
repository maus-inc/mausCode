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
 * `[modes.ask] destructive = "ask"` is the only shipped widening. Ask mode
 * publishes "Ask permission before editing files or running commands" in
 * `src/renderer/features/agents/lib/mode-display.ts`, and a human answers the
 * card, so denying there would break the mode's own contract. Exfiltration and
 * network carry no override in any mode, and plan mode is not here at all.
 */
export const SHIPPED_POLICY_FLOOR: PermissionPolicy = {
  classes: { ...DEFAULT_CLASS_VERDICTS },
  modes: {
    plan: {},
    ask: { destructive: "ask" },
    edit: { approval: "allow" },
    agent: { approval: "allow" },
    turbo: { approval: "allow", allow_tools: [] },
  },
}

const toolRuleSchema = z
  .string()
  .min(1)
  .superRefine((rule, ctx) => {
    if (parseToolRule(rule) === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a tool rule is `Tool`, `Tool(prefix *)` or `Tool(exact text)`",
      })
    }
  })

const modePolicySchema = z
  .object({
    "read-only": permissionVerdictSchema.optional(),
    approval: permissionVerdictSchema.optional(),
    destructive: permissionVerdictSchema.optional(),
    network: permissionVerdictSchema.optional(),
    exfiltration: permissionVerdictSchema.optional(),
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
        exfiltration: permissionVerdictSchema.optional(),
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
}

/**
 * Parse one allow-list entry. Null means malformed.
 *
 * Three spellings, and only three:
 * - `Bash` names a tool, so every call to it matches.
 * - `Bash(git *)` matches a call whose primary argument starts with `git `,
 *   separator included, so it does not match `gitpush`.
 * - `Bash(npm test)` matches that argument exactly.
 *
 * The `Tool(prefix:*)` spelling some provider docs use is refused on purpose.
 * Its colon is ambiguous about whether the separator is part of the prefix, and
 * an allow-list that has to guess a separator guesses wide. A refused entry is
 * a schema error, which fails the whole file closed rather than widening it.
 */
export function parseToolRule(rule: string): ToolRule | null {
  const trimmed = rule.trim()
  if (trimmed.length === 0) return null

  const open = trimmed.indexOf("(")
  if (open === -1) {
    if (trimmed.includes(")")) return null
    return { tool: trimmed }
  }
  if (!trimmed.endsWith(")") || trimmed.indexOf(")") !== trimmed.length - 1) return null

  const tool = trimmed.slice(0, open).trim()
  if (tool.length === 0) return null

  const pattern = trimmed.slice(open + 1, -1).trim()
  if (pattern.length === 0) return null
  if (pattern.endsWith("*")) {
    const specifier = pattern.slice(0, -1)
    // Refuse the `Tool(prefix:*)` spelling outright. Accepting it would leave a
    // rule that matches nothing real, and a user who copied it from another
    // product's docs would believe the tool was allowed.
    if (specifier.endsWith(":")) return null
    return { tool, specifier, prefix: true }
  }
  return { tool, specifier: pattern }
}

/** True when a parsed rule covers this tool call's primary argument. */
export function toolRuleMatches(rule: ToolRule, toolName: string, matchText: string): boolean {
  if (rule.tool !== toolName) return false
  if (rule.specifier === undefined) return true
  return rule.prefix ? matchText.startsWith(rule.specifier) : matchText === rule.specifier
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
