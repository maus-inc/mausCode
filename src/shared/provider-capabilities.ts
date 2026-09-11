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
      message:
        `${capability.displayName} requires mausCode hosted services and is disabled while local-only mode is on.`,
      severity: "block",
    })
  }

  if (capability.security.approvals === "none") {
    violations.push({
      backendId: capability.id,
      code: "no-approval-gate",
      message:
        `${capability.displayName} runs without an approval gate; every action is auto-approved.`,
      severity: "warn",
    })
  }

  if (capability.security.storesCredentials) {
    violations.push({
      backendId: capability.id,
      code: "stores-credentials",
      message:
        `${capability.displayName} stores credentials outside mausCode-managed state.`,
      severity: "warn",
    })
  }

  return violations
}
