/**
 * mausCode cline-print stored-auth probe (ours, NOT verbatim).
 *
 * `cline auth` persists provider credentials to
 * `~/.cline/data/settings/providers.json` (`providers.<id>.settings`,
 * non-interactive when all flags are passed — verified live). This
 * module answers "do credentials appear to be configured?" from that
 * file WITHOUT network calls. A positive probe can still be stale
 * (revoked key); runtime auth errors are authoritative.
 *
 * Key values are NEVER read into return values or logs: only presence
 * is reported. Held (mausCode-stored) credentials live in the app DB
 * (see routers/cline.ts) and are injected per-run via `-P/-k/-m`
 * flags — mausCode never writes providers.json (which stores apiKey
 * in PLAINTEXT, observed live).
 *
 * `CLINE_DATA_DIR` (documented) replaces `~/.cline/data/` when set.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export type ClineStoredAuth = {
  /** Credentials appear present (fast file check, may be stale). */
  configured: boolean
  /** Last-used provider id (`-P` value). */
  provider?: string
  /** Last-used model id (`-m` value). */
  model?: string
  /** One-line human summary for the connect UI. Never a secret. */
  detail: string
  /** Locations that contributed. */
  sources: string[]
}

/** Local runtimes need no key: entry presence = configured. */
const KEYLESS_PROVIDERS = new Set(["ollama", "lmstudio"])

export function resolveClineDataDir(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  const env = opts?.env ?? process.env
  const override = env.CLINE_DATA_DIR?.trim()
  if (override) return override
  return join(opts?.homeDir ?? homedir(), ".cline", "data")
}

export function clineProvidersPath(opts?: {
  homeDir?: string
  dataDir?: string
  env?: NodeJS.ProcessEnv
}): string {
  const dataDir = opts?.dataDir ?? resolveClineDataDir({ homeDir: opts?.homeDir, env: opts?.env })
  return join(dataDir, "settings", "providers.json")
}

function readJsonFile(path: string): Record<string, any> {
  try {
    if (!existsSync(path)) return {}
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as Record<string, any>
    }
    return {}
  } catch {
    return {}
  }
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0

export type ClineIsolatedDataDir = {
  dataDir: string
  cleanup: () => void
}

/**
 * Per-run isolated data dir for CUSTOM-baseUrl credentials (`-P
 * openai-native` + baseUrl). The CLI has no per-run baseUrl flag, so
 * the endpoint must come from a providers.json — but mausCode refuses
 * to write the user's real one (plaintext keys). Instead each turn
 * gets a temp dir (0600 providers.json, deleted after the turn) with
 * the user's MCP/rules/skills COPIED in (copies, not symlinks: MCP
 * servers must keep loading and copies are Windows-safe).
 *
 * Plaintext-on-disk window = one turn, inside the OS temp dir. Only
 * used when a baseUrl is set; fixed-endpoint providers inject via
 * `-P/-k/-m` with no disk touch.
 */
export function prepareClineIsolatedDataDir(opts: {
  provider: string
  apiKey?: string
  baseUrl: string
  homeDir?: string
  env?: NodeJS.ProcessEnv
}): ClineIsolatedDataDir {
  const home = opts.homeDir ?? homedir()
  const realDataDir = resolveClineDataDir({ homeDir: home, env: opts.env })
  const dataDir = mkdtempSync(join(tmpdir(), "cline-run-"))
  const settingsDir = join(dataDir, "settings")
  mkdirSync(settingsDir, { recursive: true })

  const providersDoc = {
    version: 1,
    lastUsedProvider: opts.provider,
    modes: {},
    providers: {
      [opts.provider]: {
        // No `model` key on purpose: the per-run `-m` flag overrides
        // the stored model, and the router's unknown-model retry drops
        // `-m` to reach the provider default — a pinned model here
        // would defeat that retry.
        settings: {
          provider: opts.provider,
          ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
          baseUrl: opts.baseUrl,
        },
        updatedAt: new Date().toISOString(),
        tokenSource: "manual",
      },
    },
  }
  writeFileSync(join(settingsDir, "providers.json"), JSON.stringify(providersDoc, null, 2), {
    mode: 0o600,
  })

  // Keep the user's MCP/rules/skills loading inside the isolated dir.
  for (const rel of [
    join("settings", "cline_mcp_settings.json"),
    join("settings", "rules"),
    join("settings", "skills"),
  ]) {
    try {
      const src = join(realDataDir, rel)
      if (!existsSync(src)) continue
      cpSync(src, join(dataDir, rel), { recursive: true })
    } catch {
      // Best-effort: the turn still runs without them.
    }
  }

  return {
    dataDir,
    cleanup: () => {
      try {
        rmSync(dataDir, { recursive: true, force: true })
      } catch {
        // Best-effort.
      }
    },
  }
}

export type ClineStoredModel = {
  id: string
  provider: string
}

export function listClineStoredModels(opts?: {
  homeDir?: string
  dataDir?: string
  env?: NodeJS.ProcessEnv
}): ClineStoredModel[] {
  const data = readJsonFile(clineProvidersPath(opts))
  const providers =
    typeof data.providers === "object" && data.providers !== null
      ? (data.providers as Record<string, any>)
      : {}
  const out: ClineStoredModel[] = []
  const seen = new Set<string>()
  for (const [provider, entry] of Object.entries(providers)) {
    const model = (entry as any)?.settings?.model
    if (!nonEmpty(model) || seen.has(model)) continue
    seen.add(model)
    out.push({ id: model, provider })
  }
  return out
}

export function probeClineStoredAuth(opts?: {
  homeDir?: string
  dataDir?: string
  env?: NodeJS.ProcessEnv
}): ClineStoredAuth {
  const providersPath = clineProvidersPath(opts)
  const sources: string[] = []
  if (existsSync(providersPath)) sources.push(providersPath)
  const data = readJsonFile(providersPath)
  const providers =
    typeof data.providers === "object" && data.providers !== null
      ? (data.providers as Record<string, any>)
      : {}

  const lastUsed = nonEmpty(data.lastUsedProvider) ? (data.lastUsedProvider as string) : undefined
  const lastSettings = lastUsed ? providers[lastUsed]?.settings : undefined
  const lastModel = nonEmpty(lastSettings?.model) ? (lastSettings.model as string) : undefined

  // Prefer the last-used provider, else any configured provider.
  const candidates = [
    ...(lastUsed ? [lastUsed] : []),
    ...Object.keys(providers).filter((id) => id !== lastUsed),
  ]
  for (const id of candidates) {
    const settings = providers[id]?.settings
    if (!settings || typeof settings !== "object") continue
    if (KEYLESS_PROVIDERS.has(id)) {
      return {
        configured: true,
        provider: id,
        model: nonEmpty(settings.model) ? settings.model : undefined,
        detail: `Local provider "${id}" is configured (no key needed).`,
        sources,
      }
    }
    if (nonEmpty(settings.apiKey)) {
      return {
        configured: true,
        provider: id,
        model: nonEmpty(settings.model) ? settings.model : undefined,
        detail: `Provider "${id}" has a stored API key${nonEmpty(settings.model) ? ` (${settings.model})` : ""}.`,
        sources,
      }
    }
  }

  if (lastUsed) {
    return {
      configured: false,
      provider: lastUsed,
      model: lastModel,
      detail: `Provider "${lastUsed}" is selected but has no stored API key.`,
      sources,
    }
  }
  return {
    configured: false,
    detail: "No Cline provider is configured. Connect with a provider API key.",
    sources,
  }
}
