/**
 * mausCode qwen-print stored-auth probe (ours, NOT verbatim).
 *
 * `qwen auth` was REMOVED upstream (it prints a removal notice), so
 * there is no CLI login command to drive or query. Authentication is
 * purely configuration: ~/.qwen/settings.json (`modelProviders`,
 * `security.auth.selectedType`, `model.name`, `env` fallback) layered
 * with environment variables and `.env` files. This module answers
 * "do credentials appear to be configured?" from those locations
 * WITHOUT making network calls. A positive probe can still be stale
 * (revoked key); the router treats runtime auth errors as the
 * authoritative signal and surfaces auth-error then.
 *
 * Key values are NEVER read into return values or logs: only presence
 * is reported. Held (mausCode-stored) credentials live in the app DB
 * (see routers/qwen.ts) and are injected per-run via flags.
 */
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type QwenStoredModel = {
  id: string
  name?: string
  protocol: string
}

export type QwenStoredAuth = {
  /** Credentials appear present (fast file/env check, may be stale). */
  configured: boolean
  /** Effective auth-type (security.auth.selectedType). */
  authType?: string
  /** Default model id (model.name). */
  model?: string
  /** One-line human summary for the connect UI. Never a secret. */
  detail: string
  /** Locations that contributed (settings path, ".env", "environment"). */
  sources: string[]
  /** Discontinued OAuth cache still present (legacy only). */
  legacyOAuthCache?: boolean
}

export const QWEN_DEFAULT_ENV_KEY: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  "openai-responses": "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  "vertex-ai": "GOOGLE_API_KEY",
}

/** Minimal KEY=VALUE reader for the qwen .env discovery chain. */
export function parseQwenDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith("#")) continue
    const body = line.startsWith("export ") ? line.slice("export ".length).trim() : line
    const eq = body.indexOf("=")
    if (eq <= 0) continue
    const key = body.slice(0, eq).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    let value = body.slice(eq + 1).trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** The subset of `~/.qwen/settings.json` this module reads. */
interface QwenSettingsFile {
  model?: { name?: unknown; [key: string]: unknown }
  security?: { auth?: { selectedType?: unknown; [key: string]: unknown }; [key: string]: unknown }
  modelProviders?: Record<string, unknown>
  [key: string]: unknown
}

function readJsonFile(path: string): QwenSettingsFile {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as QwenSettingsFile
    }
    return {}
  } catch {
    return {}
  }
}

/**
 * First `.env` hit wins (no merging, per upstream docs): walk from the
 * project dir upward checking `.qwen/.env` then `.env`, then the home
 * fallbacks `~/.qwen/.env` and `~/.env`.
 */
function findDotenvValue(
  key: string,
  opts: { homeDir: string; projectDir?: string },
): { value: string; source: string } | null {
  const candidates: string[] = []
  if (opts.projectDir) {
    let dir = opts.projectDir
    for (;;) {
      candidates.push(join(dir, ".qwen", ".env"), join(dir, ".env"))
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  candidates.push(join(opts.homeDir, ".qwen", ".env"), join(opts.homeDir, ".env"))
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const parsed = parseQwenDotenv(readFileSync(path, "utf8"))
      if (parsed[key] && parsed[key].trim().length > 0) {
        return { value: parsed[key], source: path }
      }
      // File exists but lacks the key: upstream loads the FIRST file
      // found and does not merge across files, so stop here.
      return null
    } catch {}
  }
  return null
}

export function listQwenStoredModels(homeDir?: string): QwenStoredModel[] {
  const home = homeDir ?? homedir()
  const settings = readJsonFile(join(home, ".qwen", "settings.json"))
  const providers = settings.modelProviders
  if (typeof providers !== "object" || providers === null) return []
  const out: QwenStoredModel[] = []
  const seen = new Set<string>()
  for (const [protocol, entries] of Object.entries(providers)) {
    if (!Array.isArray(entries)) continue
    for (const entry of entries) {
      if (typeof entry !== "object" || entry === null) continue
      const id = (entry as Record<string, unknown>).id
      if (typeof id !== "string" || id.length === 0 || seen.has(id)) continue
      seen.add(id)
      const name = (entry as Record<string, unknown>).name
      out.push({
        id,
        protocol,
        ...(typeof name === "string" && name.length > 0 ? { name } : {}),
      })
    }
  }
  return out
}

export function probeQwenStoredAuth(opts?: {
  homeDir?: string
  projectDir?: string
  env?: NodeJS.ProcessEnv
}): QwenStoredAuth {
  const home = opts?.homeDir ?? homedir()
  const env = opts?.env ?? process.env
  const settingsPath = join(home, ".qwen", "settings.json")
  const settings = readJsonFile(settingsPath)
  const sources: string[] = []
  if (existsSync(settingsPath)) sources.push(settingsPath)

  const authType = settings.security?.auth?.selectedType
  const modelName = typeof settings.model?.name === "string" ? settings.model.name : undefined
  const legacyOAuthCache = existsSync(join(home, ".qwen", "oauth_creds.json"))

  if (typeof authType !== "string" || authType.length === 0) {
    return {
      configured: false,
      model: modelName,
      detail: "No qwen auth type selected. Connect with an API key or run /auth in the qwen CLI.",
      sources,
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }

  if (authType === "qwen-oauth") {
    // Discontinued 2026-04-15 upstream; cached tokens may linger.
    return {
      configured: legacyOAuthCache,
      authType,
      model: modelName,
      detail: legacyOAuthCache
        ? "Legacy Qwen OAuth cache found (free tier discontinued upstream; may fail)."
        : "Qwen OAuth selected but no cached credentials found.",
      sources,
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }

  // Per-model envKey override wins over the protocol default.
  let envKey = QWEN_DEFAULT_ENV_KEY[authType]
  if (!envKey && authType === "vertex-ai") envKey = "GOOGLE_API_KEY"
  const entries = settings.modelProviders?.[authType]
  if (Array.isArray(entries)) {
    const match =
      entries.find(
        (e: unknown) =>
          typeof e === "object" && e !== null && (e as Record<string, unknown>).id === modelName,
      ) ?? entries[0]
    const override = (match as Record<string, unknown> | undefined)?.envKey
    if (typeof override === "string" && override.length > 0) {
      envKey = override
    }
  }
  if (!envKey) {
    return {
      configured: false,
      authType,
      model: modelName,
      detail: `Unknown qwen auth type "${authType}".`,
      sources,
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }

  const settingsEnv =
    typeof settings.env === "object" && settings.env !== null
      ? (settings.env as Record<string, unknown>)
      : {}

  const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0

  // Priority (upstream): shell env > .env chain > settings env.
  if (nonEmpty(env[envKey])) {
    return {
      configured: true,
      authType,
      model: modelName,
      detail: `${envKey} is set in the environment (${authType}${modelName ? `, ${modelName}` : ""}).`,
      sources: [...sources, "environment"],
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }
  if (authType === "vertex-ai" && nonEmpty(env.GOOGLE_CLOUD_PROJECT)) {
    // Keyless ADC path (project + application-default credentials).
    return {
      configured: true,
      authType,
      model: modelName,
      detail: `Vertex AI via application-default credentials (${modelName ?? "default model"}).`,
      sources: [...sources, "environment"],
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }
  const dotenvHit = findDotenvValue(envKey, {
    homeDir: home,
    projectDir: opts?.projectDir,
  })
  if (dotenvHit) {
    return {
      configured: true,
      authType,
      model: modelName,
      detail: `${envKey} found in ${dotenvHit.source} (${authType}${modelName ? `, ${modelName}` : ""}).`,
      sources: [...sources, dotenvHit.source],
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }
  if (nonEmpty(settingsEnv[envKey])) {
    return {
      configured: true,
      authType,
      model: modelName,
      detail: `${envKey} stored in settings.json (${authType}${modelName ? `, ${modelName}` : ""}).`,
      sources,
      ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
    }
  }
  return {
    configured: false,
    authType,
    model: modelName,
    detail: `Auth type "${authType}" is selected but ${envKey} is not set.`,
    sources,
    ...(legacyOAuthCache ? { legacyOAuthCache: true } : {}),
  }
}
