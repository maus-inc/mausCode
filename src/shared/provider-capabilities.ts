/**
 * Provider capability manifest: the contract every backend self-reports
 * against. Pure + dependency-light so main and renderer agree.
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
  auth: z.array(z.string()),
  storesCredentials: z.boolean(),
  approvals: z.enum(["none", "session-auto", "per-action", "configurable"]),
  sandbox: z.string(),
  egress: z.array(z.string()),
  retention: z.string(),
  requiresHostedService: z.boolean(),
})

export const performanceProfileSchema = z.object({
  streaming: z.boolean(),
  partialStreaming: z.boolean(),
  parallelTools: z.boolean(),
  contextWindow: z.number().nullable(),
  latencyClass: z.enum(["local", "edge", "cloud"]),
  usageSurface: z.enum(["native", "session-files", "none"]),
})

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
