/**
 * Provider capability manifest: the contract every backend self-reports
 * against. Rendered in Settings (tucked away); only violations surface in
 * chat UI. Pure + dependency-light so main and renderer agree.
 */
import { z } from "zod"

export const backendKindSchema = z.enum([
  "local-cli",
  "local-sdk",
  "local-gateway",
  "cloud-api",
  "extension-host",
])

export const securityPostureSchema = z.object({
  /** Auth mechanisms, e.g. ["oauth-chatgpt", "api-key-env", "cli-login"]. */
  auth: z.array(z.string()),
  storesCredentials: z.boolean(),
  approvals: z.enum(["none", "session-auto", "per-action", "configurable"]),
  /** Effective sandbox, e.g. "workspace-write", "read-only", "none". */
  sandbox: z.string(),
  /** Network egress, e.g. ["provider-configured"] or concrete hosts. */
  egress: z.array(z.string()),
  /** Retention story, e.g. "local-session-files", "vendor-policy". */
  retention: z.string(),
  /**
   * True only when the backend needs mausCode/1Code hosted services or
   * remote sandbox infra. User-owned provider APIs (OpenAI, Anthropic,
   * BYOK) do NOT count — local-only mode leaves those untouched.
   */
  requiresHostedService: z.boolean(),
  /**
   * Who enforces the permission floor of roadmap step 10 for the modes that
   * write, per `.dump/app/decisions/2026-09-13-permission-floor.md`.
   *
   * - `app-gate`: every side-effecting action reaches the evaluator in
   *   `src/main/lib/permissions/`, so all five rule classes are enforced in
   *   this app and a denial names the rule that produced it.
   * - `engine-only`: the backend is a subprocess or an extension host that
   *   gives this app no per-action callback, so the floor can only be
   *   expressed as engine flags. A class the engine has no flag for is not
   *   enforced at all, and the decision record names those classes per
   *   backend rather than this field pretending otherwise.
   */
  permissionFloor: z.enum(["app-gate", "engine-only"]),
})

export const performanceProfileSchema = z.object({
  streaming: z.boolean(),
  partialStreaming: z.boolean(),
  parallelTools: z.boolean(),
  /** Tokens; null = model-dependent. */
  contextWindow: z.number().nullable(),
  latencyClass: z.enum(["local", "edge", "cloud"]),
  usageSurface: z.enum(["native", "session-files", "none"]),
})

/**
 * A feature is true only when it works end-to-end through mausCode chat for
 * this backend (server-side-automatic counts; merely server-possible does
 * not). When in doubt, false: the UI must not offer what isn't wired.
 */
export const featureFlagsSchema = z.object({
  chat: z.boolean(),
  images: z.boolean(),
  resume: z.boolean(),
  fork: z.boolean(),
  mcp: z.boolean(),
  subagents: z.boolean(),
  cron: z.boolean(),
  skills: z.boolean(),
  structuredOutput: z.boolean(),
  fileCheckpointing: z.boolean(),
  /** The backend accepts a reasoning-effort level from `src/shared/effort.ts` on a turn. */
  effort: z.boolean(),
  /** The backend can pick its own thinking budget per turn instead of being handed one. */
  adaptiveThinking: z.boolean(),
  /** The backend can suggest a next prompt after it finishes a turn. */
  promptSuggestions: z.boolean(),
})

export const providerCapabilitySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  kind: backendKindSchema,
  /** Human transport description, e.g. "codex app-server (JSON-RPC stdio)". */
  transport: z.string(),
  license: z.string(),
  billing: z.string(),
  security: securityPostureSchema,
  performance: performanceProfileSchema,
  features: featureFlagsSchema,
  notes: z.array(z.string()).default([]),
})

export type ProviderCapability = z.infer<typeof providerCapabilitySchema>

/** The two answers to "who enforces the permission floor of roadmap step 10". */
export type PermissionFloor = ProviderCapability["security"]["permissionFloor"]

/** The three turn-shaping features the 0.3.270 SDK pin made expressible. */
export type TurnControlFeatures = Pick<
  ProviderCapability["features"],
  "effort" | "adaptiveThinking" | "promptSuggestions"
>

/**
 * The "when in doubt, false" rule above, stated once for those three features.
 * A manifest spreads this and then names only what its own backend carries end
 * to end, so eight backends that support none of them cannot drift to eight
 * hand-written copies of the same default, and a fourth flag added to the
 * schema fails typecheck here rather than being silently missing from one
 * manifest. The per-backend evidence is in
 * `.dump/app/research/2026-09-13-sdk-0-3-bump.md`.
 */
export const TURN_CONTROLS_OFF: TurnControlFeatures = {
  effort: false,
  adaptiveThinking: false,
  promptSuggestions: false,
}

/**
 * The floor behind a sub-chat provider id, which is the vocabulary the chat UI
 * holds. The manifests are keyed by backend id and live in main, so the renderer
 * cannot read one for the id it has, and two ids it does hold, `gemini` and
 * `openrouter`, name a path no backend manifest carries at all.
 *
 * Only the Claude path routes a tool call through `evaluateAction`, so it is the
 * only id with an app gate. `src/main/lib/providers/permission-floor.test.ts`
 * asserts this agrees with every manifest that has a sub-chat binding, so the two
 * vocabularies cannot drift apart silently.
 */
export function permissionFloorFor(provider: string): PermissionFloor {
  return provider === "claude-code" ? "app-gate" : "engine-only"
}

export type ViolationSeverity = "block" | "warn"

export type CapabilityViolation = {
  backendId: string
  code: string
  message: string
  severity: ViolationSeverity
}

export type PolicyInput = {
  localOnly: boolean
}

/**
 * Pure policy evaluation shared by main (providers router) and renderer.
 * Rule: if a backend can't report a capability, the UI must not offer it —
 * violations are the surfacing mechanism.
 */
export function evaluateViolations(
  capability: ProviderCapability,
  policy: PolicyInput,
): CapabilityViolation[] {
  const violations: CapabilityViolation[] = []

  // Local-only blocks hosted upstream services, not user-owned provider
  // APIs (see src/shared/local-only.ts). A backend trips this only when it
  // cannot work without mausCode/1Code hosted infrastructure.
  if (policy.localOnly && capability.security.requiresHostedService) {
    violations.push({
      backendId: capability.id,
      code: "local-only-blocked",
      message: `${capability.displayName} requires mausCode hosted services and is disabled while local-only mode is on.`,
      severity: "block",
    })
  }

  if (capability.security.approvals === "none") {
    violations.push({
      backendId: capability.id,
      code: "no-approval-gate",
      message: `${capability.displayName} runs without an approval gate; every action is auto-approved.`,
      severity: "warn",
    })
  }

  if (capability.security.storesCredentials) {
    violations.push({
      backendId: capability.id,
      code: "stores-credentials",
      message: `${capability.displayName} stores credentials outside mausCode-managed state.`,
      severity: "warn",
    })
  }

  return violations
}
