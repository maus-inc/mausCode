/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import { app } from "electron"
import { getExistingClaudeCredentials, getValidExistingClaudeToken } from "./claude-token"

export type OAuthUsageWindow = {
  utilization: number | null
  resetsAt: string | null
}

export type OAuthExtraUsage = {
  isEnabled: boolean | null
  monthlyLimit: number | null
  usedCredits: number | null
  utilization: number | null
  currency: string | null
}

export type ClaudeOAuthUsage = {
  fiveHour: OAuthUsageWindow | null
  sevenDay: OAuthUsageWindow | null
  sevenDayOpus: OAuthUsageWindow | null
  sevenDaySonnet: OAuthUsageWindow | null
  sevenDayDesign: OAuthUsageWindow | null
  sevenDayRoutines: OAuthUsageWindow | null
  sevenDayOAuthApps: OAuthUsageWindow | null
  extraUsage: OAuthExtraUsage | null
}

export type ClaudeOAuthUsageResult =
  | { ok: true; usage: ClaudeOAuthUsage }
  | { ok: false; reason: "no_credentials" | "unauthorized" | "error"; message?: string }

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
const BETA_HEADER = "oauth-2025-04-20"
const FALLBACK_VERSION = "2.1.0"

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function pickBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

function parseWindow(value: unknown): OAuthUsageWindow | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  return {
    utilization: pickNumber(v.utilization),
    resetsAt: pickString(v.resets_at),
  }
}

function parseFirstWindow(
  source: Record<string, unknown>,
  keys: readonly string[],
): OAuthUsageWindow | null {
  for (const key of keys) {
    if (!(key in source)) continue
    const parsed = parseWindow(source[key])
    if (parsed) return parsed
  }
  return null
}

function parseExtraUsage(value: unknown): OAuthExtraUsage | null {
  if (!value || typeof value !== "object") return null
  const v = value as Record<string, unknown>
  return {
    isEnabled: pickBoolean(v.is_enabled),
    monthlyLimit: pickNumber(v.monthly_limit),
    usedCredits: pickNumber(v.used_credits),
    utilization: pickNumber(v.utilization),
    currency: pickString(v.currency),
  }
}

function parseUsageResponse(raw: unknown): ClaudeOAuthUsage {
  const source =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    fiveHour: parseFirstWindow(source, ["five_hour"]),
    sevenDay: parseFirstWindow(source, ["seven_day"]),
    sevenDayOpus: parseFirstWindow(source, ["seven_day_opus"]),
    sevenDaySonnet: parseFirstWindow(source, ["seven_day_sonnet"]),
    sevenDayDesign: parseFirstWindow(source, [
      "seven_day_design",
      "seven_day_claude_design",
      "claude_design",
      "design",
      "seven_day_omelette",
      "omelette",
    ]),
    sevenDayRoutines: parseFirstWindow(source, [
      "seven_day_routines",
      "seven_day_claude_routines",
      "claude_routines",
      "routines",
      "seven_day_cowork",
      "cowork",
    ]),
    sevenDayOAuthApps: parseFirstWindow(source, ["seven_day_oauth_apps"]),
    extraUsage: parseExtraUsage(source.extra_usage),
  }
}

function userAgent(): string {
  const version = app?.getVersion ? app.getVersion() : FALLBACK_VERSION
  return `claude-code/${version || FALLBACK_VERSION}`
}

async function callUsageEndpoint(accessToken: string): Promise<Response> {
  return fetch(USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": BETA_HEADER,
      "User-Agent": userAgent(),
    },
  })
}

export async function fetchClaudeOAuthUsage(): Promise<ClaudeOAuthUsageResult> {
  const creds = getExistingClaudeCredentials()
  const accessToken = await getValidExistingClaudeToken()
  if (!creds?.accessToken || !accessToken) {
    return { ok: false, reason: "no_credentials" }
  }

  let response: Response
  try {
    response = await callUsageEndpoint(accessToken)
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Network error",
    }
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    return {
      ok: false,
      reason: response.status === 401 ? "unauthorized" : "error",
      message: `HTTP ${response.status}${body ? ` – ${body.slice(0, 200)}` : ""}`,
    }
  }

  let json: unknown
  try {
    json = await response.json()
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Invalid JSON",
    }
  }

  return { ok: true, usage: parseUsageResponse(json) }
}
