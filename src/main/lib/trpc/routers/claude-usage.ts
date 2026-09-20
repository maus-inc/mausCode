/**
 * Claude Code usage-stats router.
 *
 * Transplanted from aadivar/1code (Apache-2.0, © the 1Code contributors) —
 * file/hunk-level port, not a merge. Adaptations for our tree:
 * - Credential source is the app's own Anthropic account store
 *   (`getActiveAnthropicToken`, secret-store-backed) instead of shelling out
 *   to the macOS `security` CLI for the Claude CLI keychain entry. Users
 *   without a stored app token get "Not connected" (honest; no silent
 *   keychain reach-around, no macOS-only shell-out).
 * - The stored token is used raw (no `{claudeAiOauth.accessToken}` unwrap,
 *   which was the CLI-credential shape).
 * Fetch/parse logic and the OAuth usage endpoint call are otherwise as
 * upstream in the fork. The `claude-code/*` User-Agent + `oauth-2025-04-20`
 * beta header are what the endpoint expects from OAuth clients.
 */
import { getActiveAnthropicToken } from "../../runtime"
import { publicProcedure, router } from "../index"

/**
 * Parsed usage data returned to the client
 * Always includes all model breakdowns (defaulting to 0 if not used)
 */
export interface ClaudeUsageData {
  fiveHour: {
    utilization: number
    resetsAt: string | null
  }
  sevenDay: {
    utilization: number
    resetsAt: string | null
  }
  sevenDayOpus: {
    utilization: number
  }
  sevenDaySonnet: {
    utilization: number
    resetsAt: string | null
  }
  lastFetched: string
}

/**
 * Parse utilization value that can be Int, Double, or String
 * Based on claude-usage-tracker's robust parser
 */
function parseUtilization(value: unknown): number {
  if (typeof value === "number") {
    return value
  }
  if (typeof value === "string") {
    const cleaned = value.trim().replace("%", "")
    const parsed = parseFloat(cleaned)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/**
 * Claude Usage Router
 * Fetches usage data from Anthropic's OAuth API
 */
export const claudeUsageRouter = router({
  /**
   * Get current usage stats
   */
  getUsage: publicProcedure.query(
    async (): Promise<{
      data: ClaudeUsageData | null
      error: string | null
    }> => {
      const token = getActiveAnthropicToken()

      if (!token) {
        return {
          data: null,
          error: "Not connected to Claude Code",
        }
      }

      try {
        const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "User-Agent": "claude-code/2.1.5",
            "anthropic-beta": "oauth-2025-04-20",
          },
        })

        if (response.status === 401 || response.status === 403) {
          return {
            data: null,
            error: "Token expired or invalid. Please reconnect Claude Code.",
          }
        }

        if (response.status === 429) {
          return {
            data: null,
            error: "Rate limited. Please try again later.",
          }
        }

        if (!response.ok) {
          console.error("[ClaudeUsage] API error:", response.status, response.statusText)
          return {
            data: null,
            error: `API error: ${response.status}`,
          }
        }

        const rawData = (await response.json()) as Record<string, unknown>

        // Parse each section with robust type handling (matching claude-usage-tracker)
        const fiveHour = rawData.five_hour as Record<string, unknown> | undefined
        const sevenDay = rawData.seven_day as Record<string, unknown> | undefined
        const sevenDayOpus = rawData.seven_day_opus as Record<string, unknown> | undefined
        const sevenDaySonnet = rawData.seven_day_sonnet as Record<string, unknown> | undefined

        const data: ClaudeUsageData = {
          fiveHour: {
            utilization: fiveHour ? parseUtilization(fiveHour.utilization) : 0,
            resetsAt: (fiveHour?.resets_at as string) ?? null,
          },
          sevenDay: {
            utilization: sevenDay ? parseUtilization(sevenDay.utilization) : 0,
            resetsAt: (sevenDay?.resets_at as string) ?? null,
          },
          // Always include model breakdowns (default to 0 if not present)
          sevenDayOpus: {
            utilization: sevenDayOpus ? parseUtilization(sevenDayOpus.utilization) : 0,
          },
          sevenDaySonnet: {
            utilization: sevenDaySonnet ? parseUtilization(sevenDaySonnet.utilization) : 0,
            resetsAt: (sevenDaySonnet?.resets_at as string) ?? null,
          },
          lastFetched: new Date().toISOString(),
        }

        return { data, error: null }
      } catch (error) {
        console.error("[ClaudeUsage] Fetch error:", error)
        return {
          data: null,
          error: "Network error. Please check your connection.",
        }
      }
    },
  ),
})
