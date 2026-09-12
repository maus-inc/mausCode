/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/ci/research/fork-network-harvest-catalog.md.
 */
import { existsSync } from "node:fs"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { type ClaudeOAuthUsage, fetchClaudeOAuthUsage } from "../../claude-oauth-usage"
import { loadGeminiApiKey } from "../../gemini-auth-store"
import { fetchGeminiPlanUsage, type GeminiPlanUsage } from "../../gemini-plan-usage"
import { type GeminiTodayUsage, readGeminiToday } from "../../gemini-usage"
import { loadOpenRouterApiKey } from "../../openrouter-auth-store"
import { fetchOpenRouterPlanUsage, type OpenRouterPlanUsage } from "../../openrouter-plan-usage"
import { type OpenRouterTodayUsage, readOpenRouterToday } from "../../openrouter-usage"
import { publicProcedure, router } from "../index"

export type ClaudeTodayUsage = {
  tokens: number
  sessions: number
  messages: number
  toolCalls: number
}

export type CodexTodayUsage = {
  tokens: number
  inputTokens: number
  outputTokens: number
  sessions: number
}

export type UsageTodayResult = {
  claude: ClaudeTodayUsage | null
  codex: CodexTodayUsage | null
  gemini: GeminiTodayUsage | null
  openrouter: OpenRouterTodayUsage | null
  date: string
}

function todayLocalISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

function todayLocalParts(): { year: string; month: string; day: string } {
  const d = new Date()
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    day: String(d.getDate()).padStart(2, "0"),
  }
}

type ClaudeSessionTotals = {
  messages: number
  toolCalls: number
  tokens: number
}

function pickNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0
}

function localDayBounds(): { start: Date; end: Date } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start, end }
}

async function scanClaudeSessionForDay(
  filePath: string,
  start: Date,
  end: Date,
): Promise<ClaudeSessionTotals | null> {
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  let messages = 0
  let toolCalls = 0
  let tokens = 0

  for (const line of content.split("\n")) {
    if (!line) continue

    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    if (
      typeof entry !== "object" ||
      entry === null ||
      (entry as { type?: unknown }).type !== "assistant"
    ) {
      continue
    }

    const tsRaw = (entry as { timestamp?: unknown }).timestamp
    if (typeof tsRaw !== "string") continue
    const ts = new Date(tsRaw)
    if (Number.isNaN(ts.getTime())) continue
    if (ts < start || ts >= end) continue

    messages += 1

    const message = (entry as { message?: unknown }).message
    if (typeof message !== "object" || message === null) continue

    const usage = (message as { usage?: unknown }).usage
    if (typeof usage === "object" && usage !== null) {
      const u = usage as Record<string, unknown>
      tokens +=
        pickNonNegativeNumber(u.input_tokens) +
        pickNonNegativeNumber(u.output_tokens) +
        pickNonNegativeNumber(u.cache_read_input_tokens) +
        pickNonNegativeNumber(u.cache_creation_input_tokens)
    }

    const contentBlocks = (message as { content?: unknown }).content
    if (Array.isArray(contentBlocks)) {
      for (const block of contentBlocks) {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "tool_use"
        ) {
          toolCalls += 1
        }
      }
    }
  }

  return { messages, toolCalls, tokens }
}

async function readClaudeToday(): Promise<ClaudeTodayUsage | null> {
  const projectsDir = join(homedir(), ".claude", "projects")
  if (!existsSync(projectsDir)) return null

  let projectNames: string[]
  try {
    projectNames = await readdir(projectsDir)
  } catch {
    return null
  }

  const { start, end } = localDayBounds()

  let sessions = 0
  let messages = 0
  let toolCalls = 0
  let tokens = 0

  const sessionFiles: string[] = []
  for (const projectName of projectNames) {
    const projectDir = join(projectsDir, projectName)
    let entries: { name: string; isFile: boolean }[]
    try {
      const dirents = await readdir(projectDir, { withFileTypes: true })
      entries = dirents.map((d) => ({ name: d.name, isFile: d.isFile() }))
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile) continue
      if (!entry.name.endsWith(".jsonl")) continue

      const filePath = join(projectDir, entry.name)
      let mtime: Date
      try {
        const s = await stat(filePath)
        mtime = s.mtime
      } catch {
        continue
      }
      if (mtime < start) continue
      sessionFiles.push(filePath)
    }
  }

  const totalsList = await Promise.all(
    sessionFiles.map((filePath) => scanClaudeSessionForDay(filePath, start, end)),
  )

  for (const totals of totalsList) {
    if (!totals || totals.messages === 0) continue
    sessions += 1
    messages += totals.messages
    toolCalls += totals.toolCalls
    tokens += totals.tokens
  }

  return { tokens, sessions, messages, toolCalls }
}

type CodexLastTokenUsage = {
  inputTokens: number | null
  cachedInputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

async function readLatestCodexUsage(filePath: string): Promise<CodexLastTokenUsage | null> {
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = content.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim()
    if (!line) continue

    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      typeof event !== "object" ||
      event === null ||
      (event as { type?: unknown }).type !== "event_msg"
    ) {
      continue
    }

    const payload = (event as { payload?: unknown }).payload
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== "token_count"
    ) {
      continue
    }

    const info = (payload as { info?: unknown }).info
    if (typeof info !== "object" || info === null) continue

    const usage = (info as { last_token_usage?: unknown }).last_token_usage
    if (typeof usage !== "object" || usage === null) continue

    const u = usage as Record<string, unknown>
    return {
      inputTokens: pickNumber(u.input_tokens),
      cachedInputTokens: pickNumber(u.cached_input_tokens),
      outputTokens: pickNumber(u.output_tokens),
      totalTokens: pickNumber(u.total_tokens),
    }
  }

  return null
}

async function readCodexToday(): Promise<CodexTodayUsage | null> {
  const sessionsRoot = join(homedir(), ".codex", "sessions")
  if (!existsSync(sessionsRoot)) return null

  const emptyToday: CodexTodayUsage = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    sessions: 0,
  }

  const { year, month, day } = todayLocalParts()
  const dayDir = join(sessionsRoot, year, month, day)
  if (!existsSync(dayDir)) return emptyToday

  let entries: string[]
  try {
    entries = await readdir(dayDir)
  } catch {
    return emptyToday
  }

  const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"))
  if (jsonlFiles.length === 0) {
    return emptyToday
  }

  const usages = await Promise.all(
    jsonlFiles.map((name) => readLatestCodexUsage(join(dayDir, name))),
  )

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let sessions = 0
  for (const usage of usages) {
    if (!usage) continue
    sessions += 1
    const rawInput = usage.inputTokens ?? 0
    const cached = usage.cachedInputTokens ?? 0
    const nonCachedInput = Math.max(0, rawInput - cached)
    const out = usage.outputTokens ?? 0
    inputTokens += nonCachedInput
    outputTokens += out
    totalTokens += usage.totalTokens ?? rawInput + out
  }

  return {
    tokens: totalTokens,
    inputTokens,
    outputTokens,
    sessions,
  }
}

export type ClaudePlanUsageResult =
  | { available: true; usage: ClaudeOAuthUsage; fetchedAt: string }
  | {
      available: false
      reason: "no_credentials" | "unauthorized" | "error"
      message?: string
      fetchedAt: string
    }

export type CodexUsageWindow = {
  utilization: number | null
  resetsAt: string | null
  windowMinutes: number | null
}

export type CodexPlanUsage = {
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  planType: string | null
  hasCredits: boolean | null
  source: { sessionFile: string; observedAt: string } | null
}

export type CodexPlanUsageResult =
  | { available: true; usage: CodexPlanUsage; fetchedAt: string }
  | {
      available: false
      reason: "no_sessions" | "error"
      message?: string
      fetchedAt: string
    }

type RawCodexRateLimits = {
  primary: CodexUsageWindow | null
  secondary: CodexUsageWindow | null
  planType: string | null
  hasCredits: boolean | null
  observedAt: string
}

function parseCodexWindow(value: unknown): CodexUsageWindow | null {
  if (typeof value !== "object" || value === null) return null
  const v = value as Record<string, unknown>
  const utilization = pickNumber(v.used_percent)
  const windowMinutes = pickNumber(v.window_minutes)
  const resetsRaw = v.resets_at
  let resetsAt: string | null = null
  if (typeof resetsRaw === "number" && Number.isFinite(resetsRaw)) {
    resetsAt = new Date(resetsRaw * 1000).toISOString()
  } else if (typeof resetsRaw === "string" && resetsRaw.length > 0) {
    resetsAt = resetsRaw
  }
  if (utilization === null && resetsAt === null && windowMinutes === null) {
    return null
  }
  return { utilization, resetsAt, windowMinutes }
}

async function readLatestCodexRateLimits(filePath: string): Promise<RawCodexRateLimits | null> {
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = content.split("\n")
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]?.trim()
    if (!line) continue

    let event: unknown
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }

    if (
      typeof event !== "object" ||
      event === null ||
      (event as { type?: unknown }).type !== "event_msg"
    ) {
      continue
    }

    const payload = (event as { payload?: unknown }).payload
    if (
      typeof payload !== "object" ||
      payload === null ||
      (payload as { type?: unknown }).type !== "token_count"
    ) {
      continue
    }

    const rateLimits = (payload as { rate_limits?: unknown }).rate_limits
    if (typeof rateLimits !== "object" || rateLimits === null) continue

    const r = rateLimits as Record<string, unknown>
    const primary = parseCodexWindow(r.primary)
    const secondary = parseCodexWindow(r.secondary)
    if (!primary && !secondary) continue

    const credits =
      typeof r.credits === "object" && r.credits !== null
        ? (r.credits as Record<string, unknown>)
        : null
    const hasCredits = typeof credits?.has_credits === "boolean" ? credits.has_credits : null

    const planType = typeof r.plan_type === "string" && r.plan_type.length > 0 ? r.plan_type : null

    const tsRaw = (event as { timestamp?: unknown }).timestamp
    const observedAt = typeof tsRaw === "string" ? tsRaw : new Date().toISOString()

    return { primary, secondary, planType, hasCredits, observedAt }
  }

  return null
}

async function findMostRecentCodexSession(): Promise<string | null> {
  const sessionsRoot = join(homedir(), ".codex", "sessions")
  if (!existsSync(sessionsRoot)) return null

  let years: string[]
  try {
    years = await readdir(sessionsRoot)
  } catch {
    return null
  }

  let bestPath: string | null = null
  let bestMtime = 0

  for (const year of years) {
    if (!/^\d{4}$/.test(year)) continue
    const yearDir = join(sessionsRoot, year)
    let months: string[]
    try {
      months = await readdir(yearDir)
    } catch {
      continue
    }
    for (const month of months) {
      if (!/^\d{2}$/.test(month)) continue
      const monthDir = join(yearDir, month)
      let days: string[]
      try {
        days = await readdir(monthDir)
      } catch {
        continue
      }
      for (const day of days) {
        if (!/^\d{2}$/.test(day)) continue
        const dayDir = join(monthDir, day)
        let entries: string[]
        try {
          entries = await readdir(dayDir)
        } catch {
          continue
        }
        for (const name of entries) {
          if (!name.endsWith(".jsonl")) continue
          const filePath = join(dayDir, name)
          try {
            const s = await stat(filePath)
            const mtime = s.mtime.getTime()
            if (mtime > bestMtime) {
              bestMtime = mtime
              bestPath = filePath
            }
          } catch {}
        }
      }
    }
  }

  return bestPath
}

async function readCodexPlanUsage(): Promise<CodexPlanUsageResult> {
  const fetchedAt = new Date().toISOString()
  const sessionsRoot = join(homedir(), ".codex", "sessions")
  if (!existsSync(sessionsRoot)) {
    return { available: false, reason: "no_sessions", fetchedAt }
  }

  let sessionFile: string | null
  try {
    sessionFile = await findMostRecentCodexSession()
  } catch {
    return { available: false, reason: "error", fetchedAt }
  }

  if (!sessionFile) {
    return { available: false, reason: "no_sessions", fetchedAt }
  }

  const limits = await readLatestCodexRateLimits(sessionFile)
  if (!limits) {
    return { available: false, reason: "no_sessions", fetchedAt }
  }

  return {
    available: true,
    usage: {
      primary: limits.primary,
      secondary: limits.secondary,
      planType: limits.planType,
      hasCredits: limits.hasCredits,
      source: { sessionFile, observedAt: limits.observedAt },
    },
    fetchedAt,
  }
}

export type GeminiPlanUsageResult =
  | { available: true; usage: GeminiPlanUsage; fetchedAt: string }
  | {
      available: false
      reason: "not_logged_in" | "unsupported_auth" | "error"
      message?: string
      fetchedAt: string
    }

async function readGeminiPlanUsage(): Promise<GeminiPlanUsageResult> {
  const fetchedAt = new Date().toISOString()
  const result = await fetchGeminiPlanUsage()
  if (result.ok) {
    return { available: true, usage: result.usage, fetchedAt }
  }
  return {
    available: false,
    reason: result.reason,
    message: result.message,
    fetchedAt,
  }
}

export type OpenRouterPlanUsageResult =
  | { available: true; usage: OpenRouterPlanUsage; fetchedAt: string }
  | {
      available: false
      reason: "no_credentials" | "unauthorized" | "error"
      message?: string
      fetchedAt: string
    }

async function readOpenRouterPlan(): Promise<OpenRouterPlanUsageResult> {
  const fetchedAt = new Date().toISOString()
  const result = await fetchOpenRouterPlanUsage()
  if (result.ok) {
    return { available: true, usage: result.usage, fetchedAt }
  }
  return {
    available: false,
    reason: result.reason,
    message: result.message,
    fetchedAt,
  }
}

export const usageRouter = router({
  today: publicProcedure.query(async (): Promise<UsageTodayResult> => {
    const [claude, codex, gemini, openrouter] = await Promise.all([
      readClaudeToday(),
      readCodexToday(),
      readGeminiToday(),
      readOpenRouterToday(),
    ])
    let geminiResolved = gemini
    if (geminiResolved === null && loadGeminiApiKey()) {
      geminiResolved = { tokens: 0, inputTokens: 0, outputTokens: 0, sessions: 0 }
    }
    let openRouterResolved = openrouter
    if (openRouterResolved === null && loadOpenRouterApiKey()) {
      openRouterResolved = {
        tokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        sessions: 0,
        costUsd: 0,
      }
    }
    return {
      claude,
      codex,
      gemini: geminiResolved,
      openrouter: openRouterResolved,
      date: todayLocalISO(),
    }
  }),
  plan: publicProcedure.query(async (): Promise<ClaudePlanUsageResult> => {
    const result = await fetchClaudeOAuthUsage()
    const fetchedAt = new Date().toISOString()
    if (result.ok) {
      return { available: true, usage: result.usage, fetchedAt }
    }
    return {
      available: false,
      reason: result.reason,
      message: result.message,
      fetchedAt,
    }
  }),
  codexPlan: publicProcedure.query(async (): Promise<CodexPlanUsageResult> => readCodexPlanUsage()),
  geminiPlan: publicProcedure.query(
    async (): Promise<GeminiPlanUsageResult> => readGeminiPlanUsage(),
  ),
  openRouterPlan: publicProcedure.query(
    async (): Promise<OpenRouterPlanUsageResult> => readOpenRouterPlan(),
  ),
})
