/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import { z } from "zod"
import {
  clearGithubToken,
  getGithubAuthStatus,
  loadGithubToken,
  saveGithubToken,
  type GithubAuthStatus,
} from "../../github-auth-store"
import { publicProcedure, router } from "../index"

export type GithubCommitStats = {
  today: number
  week: number
  month: number
  login: string
  fetchedAt: string
}

export type GithubCommitStatsResult =
  | { available: true; stats: GithubCommitStats }
  | {
      available: false
      reason: "no_token" | "unauthorized" | "error"
      message?: string
    }

const GITHUB_REST = "https://api.github.com"

const COMMON_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "mausCode-desktop",
} as const

function startOfTodayLocal(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function startOfWeekLocal(): Date {
  const d = startOfTodayLocal()
  // Treat Monday as start of week (1..7 -> 0..6 offset)
  const day = d.getDay() // 0=Sun..6=Sat
  const offset = day === 0 ? 6 : day - 1
  d.setDate(d.getDate() - offset)
  return d
}

function startOfMonthLocal(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
}

type FetchFailure = {
  available: false
  reason: "no_token" | "unauthorized" | "error"
  message?: string
}

async function fetchLogin(
  token: string,
): Promise<{ ok: true; login: string } | { ok: false; result: FetchFailure }> {
  let response: Response
  try {
    response = await fetch(`${GITHUB_REST}/user`, {
      headers: { Authorization: `Bearer ${token}`, ...COMMON_HEADERS },
    })
  } catch (error) {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: error instanceof Error ? error.message : "Network error",
      },
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, result: { available: false, reason: "unauthorized" } }
  }

  if (!response.ok) {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: `GitHub API ${response.status}`,
      },
    }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: "Invalid response",
      },
    }
  }

  const login =
    typeof data === "object" &&
    data !== null &&
    typeof (data as { login?: unknown }).login === "string"
      ? (data as { login: string }).login
      : ""

  if (!login) {
    return {
      ok: false,
      result: { available: false, reason: "error", message: "No login" },
    }
  }

  return { ok: true, login }
}

async function searchCommitCount(
  token: string,
  query: string,
): Promise<{ ok: true; count: number } | { ok: false; result: FetchFailure }> {
  const url = `${GITHUB_REST}/search/commits?q=${encodeURIComponent(query)}&per_page=1`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, ...COMMON_HEADERS },
    })
  } catch (error) {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: error instanceof Error ? error.message : "Network error",
      },
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, result: { available: false, reason: "unauthorized" } }
  }

  if (!response.ok) {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: `GitHub API ${response.status}`,
      },
    }
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return {
      ok: false,
      result: {
        available: false,
        reason: "error",
        message: "Invalid response",
      },
    }
  }

  const total =
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as { total_count?: unknown }).total_count === "number"
      ? (payload as { total_count: number }).total_count
      : 0

  return { ok: true, count: total }
}

async function fetchCommitStats(
  token: string,
): Promise<GithubCommitStatsResult> {
  const loginResult = await fetchLogin(token)
  if (!loginResult.ok) return loginResult.result
  const { login } = loginResult

  const todayFrom = startOfTodayLocal()
  const weekFrom = startOfWeekLocal()
  const monthFrom = startOfMonthLocal()

  const buildQuery = (from: Date): string =>
    `author:${login} author-date:>=${from.toISOString()}`

  const [todayRes, weekRes, monthRes] = await Promise.all([
    searchCommitCount(token, buildQuery(todayFrom)),
    searchCommitCount(token, buildQuery(weekFrom)),
    searchCommitCount(token, buildQuery(monthFrom)),
  ])

  if (!todayRes.ok) return todayRes.result
  if (!weekRes.ok) return weekRes.result
  if (!monthRes.ok) return monthRes.result

  return {
    available: true,
    stats: {
      today: todayRes.count,
      week: weekRes.count,
      month: monthRes.count,
      login,
      fetchedAt: new Date().toISOString(),
    },
  }
}

export const githubRouter = router({
  getAuthStatus: publicProcedure.query((): GithubAuthStatus => {
    return getGithubAuthStatus()
  }),
  setToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ input }) => {
      saveGithubToken(input.token)
      return getGithubAuthStatus()
    }),
  clearToken: publicProcedure.mutation(() => {
    clearGithubToken()
    return getGithubAuthStatus()
  }),
  testToken: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const result = await fetchCommitStats(input.token)
      if (result.available) {
        return { ok: true as const, login: result.stats.login }
      }
      return {
        ok: false as const,
        error: result.message ?? result.reason,
      }
    }),
  commitStats: publicProcedure.query(
    async (): Promise<GithubCommitStatsResult> => {
      const token = loadGithubToken()
      if (!token) {
        return { available: false, reason: "no_token" }
      }
      return fetchCommitStats(token)
    },
  ),
})
