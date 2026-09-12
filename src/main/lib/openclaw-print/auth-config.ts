/**
 * mausCode openclaw-print auth surface (ours, NOT verbatim).
 *
 * Held-credential injection is ENVIRONMENT-ONLY (live-verified):
 * placing the provider key in the spawn env (`OPENAI_API_KEY`, ...)
 * is honored in the default run mode while the ambient config (MCP
 * servers, skills, harness selection) stays loaded. mausCode never
 * writes `~/.openclaw` (onboarding persists keys as PLAINTEXT auth
 * profiles by default, per the docs) and never runs `onboard`.
 *
 * The ambient-auth probe reads `openclaw models status --json`
 * (live: exit 0, side-effect-free, no files created, honors $HOME):
 * `missingProvidersInUse` + the `providers[]` entries say which
 * providers have usable auth and from where. Key values are NEVER
 * read into return values or logs — only presence/kind (the CLI
 * itself redacts values in this output).
 *
 * Only providers whose env-only run path was verified live are
 * listed: openai, anthropic, openrouter (`openrouter/auto`
 * resolves), xai (`xai/grok-4`, `xai/grok-code-fast-1` resolve).
 * gemini/deepseek/zai/moonshot/ollama need config entries the
 * held-credential path cannot supply — see the decision brief.
 */
import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { join } from "node:path"

/** Held providers and their live-verified spawn-env key variables. */
export const OPENCLAW_PROVIDER_ENV_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  xai: "XAI_API_KEY",
}

export function openclawConfigPath(opts?: { homeDir?: string; env?: NodeJS.ProcessEnv }): string {
  // No documented config-path env override exists for the ambient
  // config (only the per-run `--config` flag); resolution honors
  // $HOME, which the CLI itself follows (live-verified).
  const home = opts?.env?.HOME?.trim() || opts?.homeDir || homedir()
  return join(home, ".openclaw", "openclaw.json")
}

export type OpenclawStatusProvider = {
  provider: string
  /** Effective auth kind (`env`, `profile`, `missing`, ...). */
  kind: string
  /** Human source label when the CLI reports one (never a secret). */
  source?: string
}

export type OpenclawModelsStatus = {
  raw: string
  configPath?: string
  defaultModel?: string
  missingProvidersInUse: string[]
  providers: OpenclawStatusProvider[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Pure parser over `models status --json` output (fixture-tested). */
export function parseOpenclawModelsStatus(stdoutText: string): OpenclawModelsStatus | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdoutText)
  } catch {
    return null
  }
  if (!isRecord(parsed)) return null
  const auth = parsed.auth
  const providersRaw = isRecord(auth) && Array.isArray(auth.providers) ? auth.providers : []
  const providers: OpenclawStatusProvider[] = []
  for (const entry of providersRaw) {
    if (!isRecord(entry) || typeof entry.provider !== "string") continue
    const effective = isRecord(entry.effective) ? entry.effective : undefined
    const env = isRecord(entry.env) ? entry.env : undefined
    providers.push({
      provider: entry.provider,
      kind:
        typeof effective?.kind === "string" && effective.kind.length > 0
          ? effective.kind
          : "unknown",
      ...(typeof env?.source === "string" && env.source.length > 0 ? { source: env.source } : {}),
    })
  }
  const missing =
    isRecord(auth) && Array.isArray(auth.missingProvidersInUse)
      ? auth.missingProvidersInUse.filter((p): p is string => typeof p === "string")
      : []
  return {
    raw: stdoutText,
    ...(typeof parsed.configPath === "string" ? { configPath: parsed.configPath } : {}),
    ...(typeof parsed.defaultModel === "string" ? { defaultModel: parsed.defaultModel } : {}),
    missingProvidersInUse: missing,
    providers,
  }
}

export type OpenclawStoredAuth = {
  /** Some provider auth appears present (file/status check, may be stale). */
  configured: boolean
  /** A provider with usable auth, if any. */
  provider?: string
  /** Resolved default model ref, if reported. */
  model?: string
  /** One-line human summary for the connect UI. Never a secret. */
  detail: string
}

/** Summarize a parsed status for the connect UI / integration probe. */
export function summarizeModelsStatusAuth(status: OpenclawModelsStatus | null): OpenclawStoredAuth {
  if (!status) {
    return {
      configured: false,
      detail: "Could not read OpenClaw model status.",
    }
  }
  const usable = status.providers.find((p) => p.kind !== "missing")
  if (usable) {
    const via = usable.source ? ` via ${usable.source}` : ""
    return {
      configured: true,
      provider: usable.provider,
      ...(status.defaultModel ? { model: status.defaultModel } : {}),
      detail: `Provider "${usable.provider}" has usable auth${via} (default model ${status.defaultModel ?? "unknown"}).`,
    }
  }
  if (status.missingProvidersInUse.length > 0) {
    return {
      configured: false,
      ...(status.defaultModel ? { model: status.defaultModel } : {}),
      detail: `No usable auth for ${status.missingProvidersInUse.join(", ")}. Connect with a provider API key.`,
    }
  }
  return {
    configured: false,
    ...(status.defaultModel ? { model: status.defaultModel } : {}),
    detail: "No OpenClaw provider auth is configured. Connect with a provider API key.",
  }
}

export type OpenclawListedModel = {
  id: string
  name: string
  available: boolean
}

/**
 * Pure parser over `models list --json` output (`{count,
 * models:[{key,name,available,...}]}` — fixture-tested on the live
 * shape, trimmed to 3 entries).
 */
export function parseOpenclawModelsList(stdoutText: string): OpenclawListedModel[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdoutText)
  } catch {
    return []
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models)) return []
  const out: OpenclawListedModel[] = []
  for (const entry of parsed.models) {
    if (!isRecord(entry) || typeof entry.key !== "string") continue
    out.push({
      id: entry.key,
      name: typeof entry.name === "string" ? entry.name : entry.key,
      available: entry.available === true,
    })
  }
  return out
}

export type OpenclawModelsStatusSpawn = {
  command: string
  args: string[]
  env?: Record<string, string>
}

/**
 * Run `openclaw models list --json` and parse it. Used by
 * listModels (spawned with the held key in env so the catalog
 * expands for the held provider) and NEVER per-turn. Resolves []
 * on any failure (binary missing, timeout, unparseable).
 */
export function readOpenclawModelsList(
  spawn: OpenclawModelsStatusSpawn,
  opts?: { timeoutMs?: number },
): Promise<OpenclawListedModel[]> {
  return new Promise((resolve) => {
    execFile(
      spawn.command,
      [...spawn.args, "models", "list", "--json"],
      {
        timeout: opts?.timeoutMs ?? 30_000,
        env: { ...process.env, ...spawn.env },
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve([])
          return
        }
        resolve(parseOpenclawModelsList(String(stdout ?? "")))
      },
    )
  })
}

/**
 * Run `openclaw models status --json` and parse it. Used by the
 * integration probe (ambient auth) and NEVER per-turn. Resolves
 * null on any failure (binary missing, timeout, unparseable).
 */
export function readOpenclawModelsStatus(
  spawn: OpenclawModelsStatusSpawn,
  opts?: { timeoutMs?: number },
): Promise<OpenclawModelsStatus | null> {
  return new Promise((resolve) => {
    execFile(
      spawn.command,
      [...spawn.args, "models", "status", "--json"],
      {
        timeout: opts?.timeoutMs ?? 30_000,
        env: { ...process.env, ...spawn.env },
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout) => {
        if (error) {
          resolve(null)
          return
        }
        resolve(parseOpenclawModelsStatus(String(stdout ?? "")))
      },
    )
  })
}
