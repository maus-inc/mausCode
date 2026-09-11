/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import { loadOpenRouterApiKey } from "./openrouter-auth-store"

export type OpenRouterPlanUsage = {
  label: string | null
  usageUsd: number | null
  limitUsd: number | null
  remainingUsd: number | null
  utilization: number | null
  isFreeTier: boolean
}

type FetchResult =
  | { ok: true; usage: OpenRouterPlanUsage }
  | { ok: false; reason: "no_credentials" | "unauthorized" | "error"; message?: string }

export async function fetchOpenRouterPlanUsage(): Promise<FetchResult> {
  const apiKey = loadOpenRouterApiKey()
  if (!apiKey) {
    return { ok: false, reason: "no_credentials" }
  }

  let response: Response
  try {
    response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Network error",
    }
  }

  if (response.status === 401 || response.status === 403) {
    return { ok: false, reason: "unauthorized" }
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "error",
      message: `HTTP ${response.status}`,
    }
  }

  let body: unknown
  try {
    body = await response.json()
  } catch (error) {
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "Invalid JSON",
    }
  }

  const data =
    typeof body === "object" && body !== null
      ? ((body as Record<string, unknown>).data as Record<string, unknown> | undefined)
      : undefined

  if (!data || typeof data !== "object") {
    return { ok: false, reason: "error", message: "Unexpected response shape" }
  }

  const label = typeof data.label === "string" ? data.label : null
  const usage = typeof data.usage === "number" ? data.usage : null
  const limit = typeof data.limit === "number" ? data.limit : null
  const isFreeTier = data.is_free_tier === true

  const remaining =
    usage !== null && limit !== null ? Math.max(0, limit - usage) : null
  const utilization =
    usage !== null && limit !== null && limit > 0
      ? Math.min(100, (usage / limit) * 100)
      : null

  return {
    ok: true,
    usage: {
      label,
      usageUsd: usage,
      limitUsd: limit,
      remainingUsd: remaining,
      utilization,
      isFreeTier,
    },
  }
}
