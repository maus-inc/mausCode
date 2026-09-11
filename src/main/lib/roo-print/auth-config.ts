/**
 * mausCode roo-print auth surface (ours, NOT verbatim).
 *
 * Held-credential injection is ENVIRONMENT-ONLY (source-verified in
 * run.ts: the CLI resolves its key via getApiKeyFromEnv(provider),
 * never from a config file). mausCode never writes `~/.roo`
 * (cli-settings.json holds provider/model/mode defaults only — no
 * secrets live there) and never passes `-k/--api-key` (process-table
 * exposure).
 *
 * Ambient auth is a pure file+env read, no spawn: the effective
 * provider comes from `~/.roo/cli-settings.json` (default
 * openrouter) and auth counts as present when that provider's env
 * variable is non-empty. A stale key reports connected until a turn
 * fails; the router then surfaces auth-error.
 *
 * Model ids are PROVIDER-SCOPED (source-verified per handler):
 * - anthropic/openai-native/gemini look `-m` up in a frozen table
 *   and SILENTLY fall back to the provider default on miss
 *   (anthropic.ts getModel()). Only table ids are offered.
 * - openrouter/vercel-ai-gateway pass `-m` through verbatim to the
 *   router API (openRouterModelId is used as `model` directly;
 *   unknown ids fail loudly at the API). Only ids confirmed in the
 *   frozen sources are offered.
 *
 * All tables below are curated from the frozen sources
 * (RooCodeInc/Roo-Code @ cli-v0.1.17, archived 2026-05-15):
 * packages/types/src/providers/{anthropic,gemini,openai,openrouter,
 * vercel-ai-gateway}.ts and apps/cli DEFAULT_FLAGS.
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

/** CLI-supported providers (source: supportedProviders, types.ts). */
export const ROO_SUPPORTED_PROVIDERS = [
  "anthropic",
  "openai-native",
  "gemini",
  "openrouter",
  "vercel-ai-gateway",
] as const

export type RooSupportedProvider = (typeof ROO_SUPPORTED_PROVIDERS)[number]

export function isRooSupportedProvider(value: unknown): value is RooSupportedProvider {
  return typeof value === "string" && (ROO_SUPPORTED_PROVIDERS as readonly string[]).includes(value)
}

/** Spawn-env key variables (source: README provider table). */
export const ROO_PROVIDER_ENV_VARS: Record<RooSupportedProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  "openai-native": "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  "vercel-ai-gateway": "VERCEL_AI_GATEWAY_API_KEY",
}

/** Upstream default provider (source: run.ts effectiveProvider). */
export const DEFAULT_ROO_PROVIDER: RooSupportedProvider = "openrouter"

/** Upstream CLI default model (source: DEFAULT_FLAGS.model). */
export const DEFAULT_ROO_MODEL = "anthropic/claude-opus-4.6"

export type RooModelEntry = {
  id: string
  name: string
}

/**
 * Per-provider defaults (source: *DefaultModelId in
 * packages/types/src/providers/*.ts).
 */
export const ROO_PROVIDER_DEFAULT_MODELS: Record<RooSupportedProvider, string> = {
  anthropic: "claude-sonnet-4-5",
  "openai-native": "gpt-5.1-codex-max",
  gemini: "gemini-3.1-pro-preview",
  openrouter: "anthropic/claude-sonnet-4.5",
  "vercel-ai-gateway": "anthropic/claude-sonnet-4",
}

/**
 * Curated per-provider model ids. Every id is confirmed in the
 * frozen upstream tables (see header); defaults lead each list.
 */
export const ROO_PROVIDER_MODELS: Record<RooSupportedProvider, RooModelEntry[]> = {
  anthropic: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-opus-4-5-20251101", name: "Claude Opus 4.5" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4-1-20250805", name: "Claude Opus 4.1" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
  ],
  "openai-native": [
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4o", name: "GPT-4o" },
  ],
  gemini: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-flash-latest", name: "Gemini Flash Latest" },
    { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite Latest" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  "vercel-ai-gateway": [
    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
}

export function isKnownRooModelId(provider: RooSupportedProvider, modelId: string): boolean {
  return ROO_PROVIDER_MODELS[provider].some((entry) => entry.id === modelId)
}

export function rooConfigDir(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  const home = opts?.env?.HOME?.trim() || opts?.homeDir || homedir()
  return join(home, ".roo")
}

export function rooCliSettingsPath(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  return join(rooConfigDir(opts), "cli-settings.json")
}

export type RooCliSettings = {
  provider?: string
  model?: string
  mode?: string
  reasoningEffort?: string
  consecutiveMistakeLimit?: number
  requireApproval?: boolean
  oneshot?: boolean
}

/** Pure parse of cli-settings.json content (fixture-tested). */
export function parseRooCliSettings(content: string): RooCliSettings {
  try {
    const parsed: unknown = JSON.parse(content)
    if (typeof parsed !== "object" || parsed === null) return {}
    const record = parsed as Record<string, unknown>
    const pick = (key: string): string | undefined =>
      typeof record[key] === "string" ? (record[key] as string) : undefined
    const settings: RooCliSettings = {}
    const provider = pick("provider")
    if (provider) settings.provider = provider
    const model = pick("model")
    if (model) settings.model = model
    const mode = pick("mode")
    if (mode) settings.mode = mode
    return settings
  } catch {
    return {}
  }
}

export function readRooCliSettings(opts?: {
  homeDir?: string
  env?: NodeJS.ProcessEnv
}): RooCliSettings {
  try {
    const path = rooCliSettingsPath(opts)
    if (!existsSync(path)) return {}
    return parseRooCliSettings(readFileSync(path, "utf8"))
  } catch {
    return {}
  }
}

export type RooAmbientAuth = {
  /** Effective provider (settings file or upstream default). */
  provider: RooSupportedProvider
  /** Provider env var is present and non-empty. */
  configured: boolean
  /** Settings-file default model, if any. */
  model?: string
  /** One-line human summary for the connect UI. Never a secret. */
  detail: string
}

/**
 * Ambient-auth probe (pure file+env read, no spawn). Mirrors the
 * run.ts default chain: settings provider, else openrouter.
 */
export function resolveRooAmbientAuth(opts?: {
  homeDir?: string
  env?: NodeJS.ProcessEnv
}): RooAmbientAuth {
  const settings = readRooCliSettings(opts)
  const provider = isRooSupportedProvider(settings.provider)
    ? settings.provider
    : DEFAULT_ROO_PROVIDER
  const envVar = ROO_PROVIDER_ENV_VARS[provider]
  const env = opts?.env ?? process.env
  const configured = typeof env[envVar] === "string" && (env[envVar] as string).trim().length > 0
  return {
    provider,
    configured,
    ...(settings.model ? { model: settings.model } : {}),
    detail: configured
      ? `Provider "${provider}" has ambient auth via ${envVar}.`
      : `No ambient auth for provider "${provider}" (set ${envVar} or connect with a key).`,
  }
}
