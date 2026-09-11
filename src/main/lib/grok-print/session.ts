/**
 * mausCode grok native-print turn runner (ours, NOT verbatim).
 *
 * Spawns `grok -p --output-format streaming-json` (or `--prompt-file`
 * for long prompts) and projects the NDJSON event stream onto the shared
 * chunk dialect. Protocol source: the official user guide
 * (xai-org/grok-build, 14-headless-mode.md — event table, exit codes,
 * interrupt/resume semantics).
 *
 * Event mapping:
 * - text {data}: incremental response chunks -> text deltas.
 * - thought: suppressed (reasoning tokens; matches cursor behavior).
 * - tool_call {toolCallId, title, kind, toolName, rawInput}: tool-input
 *   trio. toolName is the internal ID (read_file, search_replace,
 *   run_terminal_cmd, ...); mapped to canonical UI names below.
 * - tool_call_update {toolCallId, status, rawOutput, content}: progress
 *   updates (no result payload, running-ish status) are ignored; the
 *   first result-bearing/terminal update emits tool-output. Repeat
 *   terminals for one id are ignored (at-most-once output).
 * - usage: accumulated for result metadata (end usage wins when present).
 * - plan {entries}: rendered as text lines (plan content would otherwise
 *   be lost in plan mode, which has no approval surface headless).
 * - available_commands, max_turns_reached, auto_compact_*: skipped.
 * - end (always last): terminal success/interrupt; carries sessionId,
 *   stopReason, usage, num_turns, modelUsage, cost.
 * - error {message}: terminal failure; spend fields preserved.
 *
 * Interrupts: SIGTERM (session state is saved server-side; exit 143).
 * Exit 130/143 after interrupt settles `interrupted` and keeps the
 * session id so the router can resume ("continue").
 */

import { type ChildProcess, spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"

export type GrokPrintChunk =
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | {
      type: "tool-input-available"
      toolCallId: string
      toolName: string
      input: unknown
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | { type: "error"; errorText: string }

export type GrokUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  reasoningTokens?: number
  totalTokens?: number
}

export type GrokPrintResult = {
  status: "completed" | "error" | "interrupted"
  sessionId?: string
  stopReason?: string
  usage?: GrokUsage
  numTurns?: number
  modelUsage?: Record<string, unknown>
  totalCostUsd?: number
  errorMessage?: string
  durationMs: number
}

/** Internal grok tool IDs -> canonical UI tool names. */
const TOOL_NAME_MAP: Record<string, string> = {
  read_file: "Read",
  search_replace: "Edit",
  run_terminal_cmd: "Bash",
  bash: "Bash",
  grep: "Grep",
  grep_search: "Grep",
  list_dir: "LS",
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  todo_write: "TodoWrite",
  task: "Task",
  enter_plan_mode: "EnterPlanMode",
  exit_plan_mode: "ExitPlanMode",
  ask_user_question: "AskUserQuestion",
}

/** Statuses that mean "still running, no result yet". */
const PROGRESS_STATUSES = new Set(["in_progress", "running", "started", "progress", "pending"])

/** Statuses that mean the tool call failed. */
const FAILED_STATUSES = new Set(["failed", "error"])

function canonicalToolName(toolName: unknown, title: unknown): string {
  if (typeof toolName === "string" && toolName.length > 0) {
    // MCP invocation meta-tool: surface the fully-qualified target
    // (e.g. github__create_issue) as mcp__github__create_issue when the
    // input carries one; otherwise keep the raw id.
    if (toolName === "use_tool") return "UseTool"
    const mapped = TOOL_NAME_MAP[toolName]
    if (mapped) return mapped
    return toolName
  }
  if (typeof title === "string" && title.length > 0) return title
  return "Tool"
}

/** Best-effort mcp__server__tool from a use_tool input payload. */
function mcpNameFromInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const values = Object.values(input as Record<string, unknown>)
  for (const value of values) {
    if (typeof value !== "string") continue
    // Fully-qualified MCP tool names use server__tool (tool side may
    // itself contain __ for nested names: split on the first one).
    const text = value.trim()
    if (text.length === 0 || /\s/.test(text)) continue
    const sep = text.indexOf("__")
    if (sep <= 0 || sep + 2 >= text.length) continue
    const server = text.slice(0, sep)
    const tool = text.slice(sep + 2)
    if (!/^[A-Za-z0-9_.-]+$/.test(server)) continue
    if (!/^[A-Za-z0-9_. -]+$/.test(tool.replace(/__/g, "_"))) continue
    return `mcp__${server}__${tool}`
  }
  return null
}

function usageFromPayload(payload: any): GrokUsage | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined
  const usage: GrokUsage = {
    inputTokens: num(payload.input_tokens),
    outputTokens: num(payload.output_tokens),
    cacheReadInputTokens: num(payload.cache_read_input_tokens),
    cacheCreationInputTokens: num(payload.cache_creation_input_tokens),
    reasoningTokens: num(payload.reasoning_tokens),
    totalTokens: num(payload.total_tokens),
  }
  if (Object.values(usage).every((v) => v === undefined)) return undefined
  return usage
}

function mergeUsage(base: GrokUsage | undefined, add: GrokUsage): GrokUsage {
  const out: GrokUsage = { ...(base ?? {}) }
  for (const [key, value] of Object.entries(add)) {
    if (value === undefined) continue
    const k = key as keyof GrokUsage
    out[k] = (out[k] ?? 0) + value
  }
  return out
}

function planEntriesToText(entries: unknown): string | null {
  if (!Array.isArray(entries) || entries.length === 0) return null
  const lines: string[] = []
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      lines.push(`- ${entry.trim()}`)
    } else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>
      const text = record.title ?? record.text ?? record.content ?? record.description
      if (typeof text === "string" && text.trim().length > 0) {
        lines.push(`- ${text.trim()}`)
      }
    }
  }
  if (lines.length === 0) return null
  return `Plan:\n${lines.join("\n")}`
}

function failureMessage(status: unknown, rawOutput: unknown): string {
  if (rawOutput && typeof rawOutput === "object") {
    const record = rawOutput as Record<string, unknown>
    for (const key of ["message", "error", "errorText"]) {
      const value = record[key]
      if (typeof value === "string" && value.length > 0) return value
    }
  }
  if (typeof rawOutput === "string" && rawOutput.length > 0) return rawOutput
  return typeof status === "string" && status.length > 0 ? `tool ${status}` : "tool failed"
}

export function runGrokPrintTurn(opts: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  /** Prompt text for --prompt-file argv (path spliced after the flag). */
  promptFileText?: string
  onChunk: (chunk: GrokPrintChunk) => void
  onUsage?: (usage: GrokUsage) => void
  /** Fired when the run's session id becomes known (`end` event). */
  onSessionId?: (sessionId: string) => void
}): {
  done: Promise<GrokPrintResult>
  interrupt: () => void
} {
  let resolveDone!: (result: GrokPrintResult) => void
  const done = new Promise<GrokPrintResult>((resolve) => {
    resolveDone = resolve
  })
  const startedAt = Date.now()

  let settled = false
  let interrupted = false
  let sessionId: string | undefined
  let stopReason: string | undefined
  let lineUsage: GrokUsage | undefined
  let endUsage: GrokUsage | undefined
  let numTurns: number | undefined
  let modelUsage: Record<string, unknown> | undefined
  let totalCostUsd: number | undefined

  const textId = randomUUID()
  let textOpen = false
  const emit = (chunk: GrokPrintChunk) => {
    if (settled) return
    opts.onChunk(chunk)
  }
  const closeText = () => {
    if (!textOpen) return
    textOpen = false
    emit({ type: "text-end", id: textId })
  }
  const emitDelta = (delta: string) => {
    if (delta.length === 0) return
    if (!textOpen) {
      textOpen = true
      emit({ type: "text-start", id: textId })
    }
    emit({ type: "text-delta", id: textId, delta })
  }
  const settle = (result: Omit<GrokPrintResult, "durationMs">) => {
    if (settled) return
    closeText() // Emits while still unsettled; post-settle emits stop.
    settled = true
    resolveDone({ ...result, durationMs: Date.now() - startedAt })
  }

  // Tool correlation: updates normally carry toolCallId; when missing,
  // attribute oldest-open-first (same class of CLI gap as cursor).
  const openToolCallIds: string[] = []
  const completedToolCallIds = new Set<string>()

  const removeOpen = (callId: string) => {
    const index = openToolCallIds.indexOf(callId)
    if (index >= 0) openToolCallIds.splice(index, 1)
  }

  const handleEvent = (event: any) => {
    if (!event || typeof event !== "object") return
    switch (event.type) {
      case "text": {
        if (typeof event.data === "string") emitDelta(event.data)
        break
      }
      case "thought": {
        // Suppressed: reasoning tokens never reach the transcript.
        break
      }
      case "tool_call": {
        const hasCallId = typeof event.toolCallId === "string"
        const callId = hasCallId ? (event.toolCallId as string) : randomUUID()
        if (!hasCallId) {
          openToolCallIds.push(callId)
        } else if (!openToolCallIds.includes(callId)) {
          openToolCallIds.push(callId)
        }
        let name = canonicalToolName(event.toolName, event.title)
        const input = event.rawInput !== undefined && event.rawInput !== null ? event.rawInput : {}
        if (name === "UseTool") {
          name = mcpNameFromInput(input) ?? "UseTool"
        }
        emit({ type: "tool-input-start", toolCallId: callId, toolName: name })
        emit({
          type: "tool-input-available",
          toolCallId: callId,
          toolName: name,
          input,
        })
        break
      }
      case "tool_call_update": {
        const hasCallId = typeof event.toolCallId === "string"
        const callId = hasCallId
          ? (event.toolCallId as string)
          : (openToolCallIds[0] ?? randomUUID())
        if (completedToolCallIds.has(callId)) break
        const status = event.status
        const rawOutput = (event as Record<string, unknown>).rawOutput
        const isProgress =
          rawOutput === undefined &&
          (status === undefined || (typeof status === "string" && PROGRESS_STATUSES.has(status)))
        if (isProgress) break
        // Consumed exactly once: removeOpen drops the peeked id (or the
        // explicit one); progress updates above never reach this point.
        removeOpen(callId)
        completedToolCallIds.add(callId)
        if (typeof status === "string" && FAILED_STATUSES.has(status)) {
          emit({
            type: "tool-output-available",
            toolCallId: callId,
            output: { error: failureMessage(status, rawOutput) },
          })
        } else {
          emit({
            type: "tool-output-available",
            toolCallId: callId,
            output:
              rawOutput !== undefined
                ? rawOutput
                : (event.content ?? { status: status ?? "completed" }),
          })
        }
        break
      }
      case "usage": {
        const parsed = usageFromPayload(event.usage)
        if (parsed) {
          lineUsage = mergeUsage(lineUsage, parsed)
          opts.onUsage?.(parsed)
        }
        if (typeof event.stopReason === "string") {
          // Per-response reason; the end line is authoritative.
          stopReason = event.stopReason
        }
        break
      }
      case "plan": {
        const text = planEntriesToText(event.entries)
        if (text) emitDelta(text)
        break
      }
      case "available_commands":
      case "max_turns_reached":
      case "auto_compact_start":
      case "auto_compact_end": {
        break
      }
      case "end": {
        if (typeof event.sessionId === "string") {
          const sid: string = event.sessionId
          sessionId = sid
          try {
            opts.onSessionId?.(sid)
          } catch {
            // Listener bugs must not break the turn.
          }
        }
        if (typeof event.stopReason === "string") stopReason = event.stopReason
        const parsed = usageFromPayload(event.usage)
        if (parsed) endUsage = parsed
        if (typeof event.num_turns === "number") numTurns = event.num_turns
        if (event.modelUsage && typeof event.modelUsage === "object") {
          modelUsage = event.modelUsage as Record<string, unknown>
        }
        if (typeof event.total_cost_usd === "number") {
          totalCostUsd = event.total_cost_usd
        }
        if (stopReason === "cancelled") {
          settle({
            status: "interrupted",
            sessionId,
            stopReason,
            usage: endUsage ?? lineUsage,
            numTurns,
            modelUsage,
            totalCostUsd,
          })
        } else if (stopReason === "refusal") {
          const message = "grok refused the request"
          emit({ type: "error", errorText: message })
          settle({
            status: "error",
            errorMessage: message,
            sessionId,
            stopReason,
            usage: endUsage ?? lineUsage,
            numTurns,
            modelUsage,
            totalCostUsd,
          })
        } else {
          settle({
            status: "completed",
            sessionId,
            stopReason,
            usage: endUsage ?? lineUsage,
            numTurns,
            modelUsage,
            totalCostUsd,
          })
        }
        break
      }
      case "error": {
        if (typeof event.sessionId === "string") sessionId = event.sessionId
        const parsed = usageFromPayload(event.usage)
        if (parsed) endUsage = parsed
        const message =
          typeof event.message === "string" && event.message.length > 0
            ? event.message
            : "grok run failed"
        emit({ type: "error", errorText: message })
        settle({
          status: "error",
          errorMessage: message,
          sessionId,
          usage: endUsage ?? lineUsage,
          numTurns,
          modelUsage,
          totalCostUsd,
        })
        break
      }
      default: {
        // Non-exhaustive stream: ignore future event types.
        break
      }
    }
  }

  let child: ChildProcess | null = null
  let stdoutBuffer = ""
  let stderrText = ""
  const stdoutDecoder = new StringDecoder("utf8")
  const stderrDecoder = new StringDecoder("utf8")

  const failUnsettled = (message: string) => {
    if (settled) return
    emit({ type: "error", errorText: message })
    settle({ status: "error", errorMessage: message, sessionId })
  }

  const boot = async () => {
    let promptFileDir: string | null = null
    let spawnArgs = opts.args
    try {
      if (opts.promptFileText !== undefined) {
        promptFileDir = await mkdtemp(join(tmpdir(), "mauscode-grok-prompt-"))
        const promptPath = join(promptFileDir, "prompt.txt")
        await writeFile(promptPath, opts.promptFileText, "utf8")
        // Insert the temp path right after the --prompt-file flag,
        // wherever the argv builder placed it.
        const flagIndex = opts.args.indexOf("--prompt-file")
        if (flagIndex < 0) {
          throw new Error("[grok] promptFileText without a --prompt-file flag in argv")
        }
        spawnArgs = [
          ...opts.args.slice(0, flagIndex + 1),
          promptPath,
          ...opts.args.slice(flagIndex + 1),
        ]
      }

      child = spawn(opts.command, spawnArgs, {
        cwd: opts.cwd,
        env: opts.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      })
    } catch (error) {
      if (promptFileDir) {
        await rm(promptFileDir, { recursive: true, force: true }).catch(() => {})
      }
      failUnsettled(
        `[grok] Failed to start: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }

    child.stdout?.on("data", (chunk) => {
      stdoutBuffer += stdoutDecoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
      let newline = stdoutBuffer.indexOf("\n")
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line.length > 0) {
          try {
            handleEvent(JSON.parse(line))
          } catch {
            // Non-JSON stdout line: ignore (stdout stays clean per docs,
            // but never let a stray line kill the turn).
          }
        }
        newline = stdoutBuffer.indexOf("\n")
      }
    })
    child.stderr?.on("data", (chunk) => {
      stderrText += stderrDecoder.write(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
    })
    child.once("error", (error) => {
      failUnsettled(`[grok] Failed to start: ${error.message ?? String(error)}`)
    })
    child.once("close", async (exitCode) => {
      // Flush a final line without a trailing newline.
      stdoutBuffer += stdoutDecoder.end()
      stderrText += stderrDecoder.end()
      const tail = stdoutBuffer.trim()
      stdoutBuffer = ""
      if (tail.length > 0) {
        try {
          handleEvent(JSON.parse(tail))
        } catch {
          // Ignore stray tail bytes.
        }
      }
      if (promptFileDir) {
        await rm(promptFileDir, { recursive: true, force: true }).catch(() => {})
      }
      if (settled) return
      if (interrupted || exitCode === 130 || exitCode === 143) {
        settle({ status: "interrupted", sessionId, usage: lineUsage })
        return
      }
      const detail = stderrText.trim()
      failUnsettled(
        detail.length > 0
          ? `[grok] Exited with code ${exitCode ?? "unknown"}: ${detail.slice(0, 2000)}`
          : `[grok] Exited with code ${exitCode ?? "unknown"}`,
      )
    })
  }

  void boot()

  return {
    done,
    interrupt: () => {
      interrupted = true
      if (!child || child.killed) return
      try {
        // SIGTERM first: grok saves session state on SIGTERM/SIGINT.
        child.kill("SIGTERM")
      } catch {
        // Already gone.
      }
      setTimeout(() => {
        try {
          if (child && !child.killed && !settled) child.kill("SIGKILL")
        } catch {
          // Already gone.
        }
      }, 5000).unref?.()
    },
  }
}
