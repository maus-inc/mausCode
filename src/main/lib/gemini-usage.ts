/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import { existsSync, mkdirSync } from "node:fs"
import { appendFile, readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const GEMINI_USAGE_DIR = join(homedir(), ".mausCode-gemini", "sessions")

function todayParts(): { year: string; month: string; day: string } {
  const d = new Date()
  return {
    year: String(d.getFullYear()),
    month: String(d.getMonth() + 1).padStart(2, "0"),
    day: String(d.getDate()).padStart(2, "0"),
  }
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export interface GeminiUsageEvent {
  sessionId: string
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  timestamp: string
}

export async function appendGeminiUsage(event: GeminiUsageEvent): Promise<void> {
  const { year, month, day } = todayParts()
  const dayDir = join(GEMINI_USAGE_DIR, year, month, day)
  ensureDir(dayDir)
  const filePath = join(dayDir, `${event.sessionId}.jsonl`)
  ensureDir(dirname(filePath))
  const line = `${JSON.stringify({ type: "usage", ...event })}\n`
  await appendFile(filePath, line, "utf-8")
}

export interface GeminiTodayUsage {
  tokens: number
  inputTokens: number
  outputTokens: number
  sessions: number
}

interface SessionTotals {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  hasUsage: boolean
}

async function readSessionTotals(filePath: string): Promise<SessionTotals> {
  const totals: SessionTotals = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasUsage: false,
  }
  let content: string
  try {
    content = await readFile(filePath, "utf8")
  } catch {
    return totals
  }

  for (const line of content.split("\n")) {
    if (!line) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.type !== "usage") continue
    const input = typeof e.inputTokens === "number" ? e.inputTokens : 0
    const output = typeof e.outputTokens === "number" ? e.outputTokens : 0
    const total = typeof e.totalTokens === "number" ? e.totalTokens : input + output
    totals.inputTokens += Math.max(0, input)
    totals.outputTokens += Math.max(0, output)
    totals.totalTokens += Math.max(0, total)
    totals.hasUsage = true
  }
  return totals
}

export async function readGeminiToday(): Promise<GeminiTodayUsage | null> {
  if (!existsSync(GEMINI_USAGE_DIR)) {
    return null
  }
  const empty: GeminiTodayUsage = {
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    sessions: 0,
  }
  const { year, month, day } = todayParts()
  const dayDir = join(GEMINI_USAGE_DIR, year, month, day)
  if (!existsSync(dayDir)) return empty

  let entries: string[]
  try {
    entries = await readdir(dayDir)
  } catch {
    return empty
  }

  const jsonlFiles = entries.filter((name) => name.endsWith(".jsonl"))
  if (jsonlFiles.length === 0) return empty

  const totalsList = await Promise.all(
    jsonlFiles.map(async (name) => {
      const filePath = join(dayDir, name)
      try {
        await stat(filePath)
      } catch {
        return null
      }
      return readSessionTotals(filePath)
    }),
  )

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let sessions = 0
  for (const totals of totalsList) {
    if (!totals || !totals.hasUsage) continue
    sessions += 1
    inputTokens += totals.inputTokens
    outputTokens += totals.outputTokens
    totalTokens += totals.totalTokens
  }

  return {
    tokens: totalTokens,
    inputTokens,
    outputTokens,
    sessions,
  }
}
