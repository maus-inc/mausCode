/**
 * Native-engine endpoint URL logic: pure, no Electron, no DB.
 *
 * Evidence (`add-native-endpoint-config`): the stock daemon honors endpoint
 * overrides ONLY via process env (`JCODE_OPENAI_API_BASE`/`OPENAI_BASE_URL`/
 * `OPENAI_API_BASE`, `JCODE_ANTHROPIC_API_BASE`/`ANTHROPIC_BASE_URL`). There is
 * no per-session endpoint surface, so custom endpoints are configured
 * daemon-wide in app settings and applied as env at daemon launch. Per-chat
 * *different* endpoints on one daemon need a Rust session-scoped override
 * (recorded Phase 2, not implemented here).
 *
 * Precedence: explicit settings use the `JCODE_*` names so they WIN over
 * ambient shell env (the daemon checks `JCODE_*` first). Unset settings leave
 * ambient env untouched — never blank out the user's shell.
 */
export interface NativeEndpoints {
  openaiBaseUrl: string | null
  anthropicBaseUrl: string | null
}

/** Normalize a user-entered endpoint URL; throws on anything unusable. */
export function normalizeEndpointUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "")
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error(`Invalid endpoint URL: ${raw.trim() || "(empty)"}`)
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Endpoint URL must be http(s): ${trimmed}`)
  }
  return parsed.toString().replace(/\/+$/, "")
}

/** Normalized equality: trailing slashes and case never cause a false miss. */
export function endpointMatches(requested: string, configured: string): boolean {
  try {
    return normalizeEndpointUrl(requested) === normalizeEndpointUrl(configured)
  } catch {
    return false
  }
}

/**
 * Does `requested` match any endpoint the daemon will honor — an explicitly
 * configured setting or an ambient process-env override (both honored by the
 * daemon, so both are honest accepts)?
 */
export function isHonoredEndpoint(requested: string, settings: NativeEndpoints): boolean {
  const candidates = [
    settings.openaiBaseUrl,
    settings.anthropicBaseUrl,
    process.env.JCODE_OPENAI_API_BASE,
    process.env.OPENAI_BASE_URL,
    process.env.OPENAI_API_BASE,
    process.env.JCODE_ANTHROPIC_API_BASE,
    process.env.ANTHROPIC_BASE_URL,
  ]
  return candidates.some((c) => !!c && endpointMatches(requested, c))
}

/**
 * Env to apply at daemon launch. Only set keys for configured endpoints;
 * unset settings leave ambient env untouched.
 */
export function buildDaemonEndpointEnv(settings: NativeEndpoints): Record<string, string> {
  const env: Record<string, string> = {}
  if (settings.openaiBaseUrl) env.JCODE_OPENAI_API_BASE = settings.openaiBaseUrl
  if (settings.anthropicBaseUrl) env.JCODE_ANTHROPIC_API_BASE = settings.anthropicBaseUrl
  return env
}

/**
 * Probe an endpoint URL without credentials: a short-timeout GET that only
 * reports reachability. Never sends tokens; never follows the URL into
 * anything but a bare connectivity check.
 */
export async function probeEndpoint(url: string, timeoutMs = 8000): Promise<{ ok: boolean; detail: string }> {
  const normalized = normalizeEndpointUrl(url)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(normalized, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    })
    // Any HTTP response (even 4xx/5xx) proves the endpoint is reachable;
    // auth/probe-path failures are expected without credentials.
    return { ok: true, detail: `Reachable (HTTP ${res.status})` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      detail: controller.signal.aborted ? `Timed out after ${timeoutMs}ms` : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

