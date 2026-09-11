/**
 * mausCode cline-print turn runner (ours, NOT verbatim).
 *
 * Spawns one `cline --json -- <prompt>` process per turn and projects
 * its NDJSON stream to UIMessage chunks. The 3.x wire vocabulary
 * (NOT the stale ask/say docs) was captured live against cline CLI
 * v3.0.61 with a stub Responses-API provider:
 *
 * - `hook_event` (agent_start/agent_end/agent_error/tool_call/
 *   tool_result): lifecycle markers, ignored (taskId recorded for
 *   debugging only — it is NOT resumable, `--id` is broken headless).
 * - `agent_event`:
 *   - `iteration_start`/`iteration_end{hadToolCalls,toolCallCount}`:
 *     iteration framing; one text block id per iteration.
 *   - `content_start{contentType:"text",text}`: streaming deltas ->
 *     text-start (first) + text-delta.
 *   - `content_end{contentType:"text"}`: text-end.
 *   - `content_start{contentType:"tool"}`: carries NO input (empty
 *     text, no ids) — held silently.
 *   - `content_end{contentType:"tool",toolCallId,toolName,output}`:
 *     tool-input-available (input genuinely absent from the CLI
 *     stream, so `{}`) immediately followed by
 *     tool-output-available. Tool cards render name + result.
 *   - `usage{...}`: stashed; `run_result` usage wins at settle time.
 *   - `done{reason,text,usage}`: reason completed|error|aborted.
 *   - `error{error:{message}}`: provider failures (TLS etc.).
 * - `run_result{finishReason,usage,aggregateUsage,durationMs,text}`:
 *   terminal settlement; usage/duration source of truth.
 * - top-level `{"type":"error","message"}`: CLI failures AND an echo
 *   of agent failures. `hook dispatch failed` lines are hub noise
 *   and are ignored.
 * - stderr ALSO carries JSON error lines (live: the TLS failure
 *   printed there) — parsed with the same handler. Non-JSON stderr
 *   (styled `error: ...` text) is collected for error context only.
 *
 * Exit codes are UNRELIABLE (live: success 0, `-t` overrun 1,
 * agent-error 0-or-1 depending on the failure, SIGINT-cancel 0, arg
 * errors 0) — completion status comes from EVENTS, never the code.
 * Cancellation is detected via our own abort flag.
 *
 * Completion ownership mirrors the sibling runners: this runner
 * never emits message-metadata/finish — the ROUTER owns completion
 * (retry downgrades + persistence ordering). Error turns surface as
 * a held `{type:"error"}` chunk (never a premature finish).
 */

import { type ChildProcess, spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

export type ClineUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalTokens?: number
  totalCost?: number
}

export type ClinePrintResult = {
  status: "completed" | "error" | "interrupted"
  /** Cline task id (`conv_*`) — NOT resumable, debugging only. */
  taskId?: string
  stopReason?: string
  usage?: ClineUsage
  numTurns?: number
  finalTextId?: string
  errorMessage?: string
  durationMs: number
}

export type ClinePrintTurn = {
  interrupt: () => void
  done: Promise<ClinePrintResult>
}

export type RunClinePrintTurnOptions = {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  onChunk: (chunk: any) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toUsage(value: unknown): ClineUsage | undefined {
  if (!isRecord(value)) return undefined
  const usage: ClineUsage = {}
  if (typeof value.inputTokens === "number") usage.inputTokens = value.inputTokens
  if (typeof value.outputTokens === "number") usage.outputTokens = value.outputTokens
  if (typeof value.cacheReadTokens === "number") {
    usage.cacheReadInputTokens = value.cacheReadTokens
  }
  if (typeof value.cacheWriteTokens === "number") {
    usage.cacheCreationInputTokens = value.cacheWriteTokens
  }
  if (typeof value.totalTokens === "number") usage.totalTokens = value.totalTokens
  if (typeof value.totalCost === "number") usage.totalCost = value.totalCost
  return Object.keys(usage).length > 0 ? usage : undefined
}

function isHookNoise(message: string): boolean {
  return /hook dispatch failed/i.test(message)
}

export function runClinePrintTurn(opts: RunClinePrintTurnOptions): ClinePrintTurn {
  const startedAt = Date.now()
  let child: ChildProcess | null = null
  let aborted = false
  let settled = false

  let taskId: string | undefined
  let iteration = 0
  let textBlockSeq = 0
  let openTextId: string | null = null
  let turnError: string | undefined
  let doneReason: string | undefined
  let doneText: string | undefined
  let sawRunResult = false
  let resultUsage: ClineUsage | undefined
  let resultDurationMs: number | undefined
  let resultIterations: number | undefined
  const stderrTail: string[] = []

  let resolveDone!: (result: ClinePrintResult) => void
  const done = new Promise<ClinePrintResult>((resolve) => {
    resolveDone = resolve
  })

  const emit = (chunk: any) => {
    try {
      opts.onChunk(chunk)
    } catch {
      // Renderer detached; the turn still settles normally.
    }
  }

  const closeOpenText = () => {
    if (openTextId) {
      emit({ type: "text-end", id: openTextId })
      openTextId = null
    }
  }

  const noteError = (message: string | undefined) => {
    if (typeof message !== "string" || message.length === 0) return
    if (isHookNoise(message)) return
    // Later lines are more specific (done.text -> run_result.text ->
    // top-level echo), so each overwrites the last.
    turnError = message
  }

  const handleAgentEvent = (event: Record<string, unknown>) => {
    const type = event.type
    if (type === "iteration_start") {
      if (typeof event.iteration === "number") iteration = event.iteration
      closeOpenText()
      return
    }
    if (type === "iteration_end") {
      closeOpenText()
      if (typeof event.iteration === "number") {
        resultIterations = Math.max(resultIterations ?? 0, event.iteration)
      }
      return
    }
    if (type === "content_start") {
      if (event.contentType === "text" && typeof event.text === "string") {
        if (!openTextId) {
          textBlockSeq += 1
          openTextId = `cline-text-${iteration}-${textBlockSeq}`
          emit({ type: "text-start", id: openTextId })
        }
        emit({ type: "text-delta", id: openTextId, delta: event.text })
      }
      // contentType "tool" starts carry no input — held silently
      // until content_end delivers ids + output.
      return
    }
    if (type === "content_end") {
      if (event.contentType === "text") {
        closeOpenText()
        return
      }
      if (event.contentType === "tool") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined
        const toolName = typeof event.toolName === "string" ? event.toolName : "unknown"
        if (!toolCallId) return
        emit({
          type: "tool-input-available",
          toolCallId,
          toolName,
          // Genuinely absent from the CLI stream (see header).
          input: {},
        })
        emit({
          type: "tool-output-available",
          toolCallId,
          output: event.output,
        })
        return
      }
      return
    }
    if (type === "usage") {
      const usage = toUsage(event)
      if (usage) resultUsage = { ...usage, ...resultUsage }
      return
    }
    if (type === "done") {
      closeOpenText()
      if (typeof event.reason === "string") doneReason = event.reason
      if (typeof event.text === "string") doneText = event.text
      const usage = toUsage(event.usage)
      if (usage) resultUsage = { ...usage, ...resultUsage }
      if (doneReason === "error" || doneReason === "aborted") {
        noteError(doneText || `Cline run ${doneReason}`)
      }
      return
    }
    if (type === "error") {
      const nested = event.error
      noteError(
        isRecord(nested) && typeof nested.message === "string"
          ? nested.message
          : "Cline run failed",
      )
      return
    }
    // Unknown agent_event subtypes pass silently (forward-compat).
  }

  const feedLine = (rawLine: string, fromStderr: boolean) => {
    const text = rawLine.trim()
    if (text.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      if (fromStderr) {
        stderrTail.push(text.slice(0, 500))
        return
      }
      // Non-JSON stdout (should not happen in --json mode):
      // surface verbatim rather than dropping silently.
      emit({ type: "text-delta", id: `cline-raw-${Date.now()}`, delta: text })
      return
    }
    if (!isRecord(parsed)) return
    if (typeof parsed.taskId === "string") {
      taskId = parsed.taskId
    }
    const lineType = parsed.type
    if (lineType === "hook_event") {
      return
    }
    if (lineType === "agent_event" && isRecord(parsed.event)) {
      handleAgentEvent(parsed.event)
      return
    }
    if (lineType === "run_result") {
      sawRunResult = true
      closeOpenText()
      const usage = toUsage(parsed.usage) ?? toUsage(parsed.aggregateUsage)
      if (usage) resultUsage = { ...resultUsage, ...usage }
      if (typeof parsed.durationMs === "number") {
        resultDurationMs = parsed.durationMs
      }
      if (typeof parsed.iterations === "number") {
        resultIterations = parsed.iterations
      }
      const finishReason = typeof parsed.finishReason === "string" ? parsed.finishReason : undefined
      if (!doneReason && finishReason) doneReason = finishReason
      if (finishReason === "error" || finishReason === "aborted") {
        noteError(
          typeof parsed.text === "string" && parsed.text.length > 0
            ? parsed.text
            : (doneText ?? `Cline run ${finishReason}`),
        )
      }
      return
    }
    if (lineType === "error") {
      noteError(typeof parsed.message === "string" ? parsed.message : undefined)
      return
    }
    // Unknown top-level line types pass silently (forward-compat).
  }

  const settle = (status: ClinePrintResult["status"], errorMessage?: string) => {
    if (settled) return
    settled = true
    closeOpenText()
    resolveDone({
      status,
      ...(taskId ? { taskId } : {}),
      ...(doneReason ? { stopReason: doneReason } : {}),
      ...(resultUsage ? { usage: resultUsage } : {}),
      ...(resultIterations !== undefined ? { numTurns: resultIterations } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      durationMs: resultDurationMs ?? Date.now() - startedAt,
    })
  }

  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      // stdin "ignore": a held-open pipe makes the CLI wait for stdin
      // input that never arrives. Dash-leading prompts travel via the
      // `--` separator (args.ts), never stdin.
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    settle("error", error instanceof Error ? error.message : "Failed to spawn cline CLI")
    return { interrupt: () => {}, done }
  }

  const stdoutDecoder = new StringDecoder("utf8")
  let stdoutBuffer = ""
  child.stdout?.on("data", (data: Buffer) => {
    stdoutBuffer += stdoutDecoder.write(data)
    let newline = stdoutBuffer.indexOf("\n")
    while (newline !== -1) {
      feedLine(stdoutBuffer.slice(0, newline), false)
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      newline = stdoutBuffer.indexOf("\n")
    }
  })

  const stderrDecoder = new StringDecoder("utf8")
  let stderrBuffer = ""
  child.stderr?.on("data", (data: Buffer) => {
    stderrBuffer += stderrDecoder.write(data)
    let newline = stderrBuffer.indexOf("\n")
    while (newline !== -1) {
      feedLine(stderrBuffer.slice(0, newline), true)
      stderrBuffer = stderrBuffer.slice(newline + 1)
      newline = stderrBuffer.indexOf("\n")
    }
  })

  child.on("error", (error) => {
    settle("error", error.message || "Failed to spawn cline CLI")
  })

  child.on("close", (code) => {
    stdoutBuffer += stdoutDecoder.end()
    if (stdoutBuffer.trim().length > 0) {
      feedLine(stdoutBuffer, false)
    }
    stderrBuffer += stderrDecoder.end()
    if (stderrBuffer.trim().length > 0) {
      feedLine(stderrBuffer, true)
    }
    if (aborted) {
      settle("interrupted")
      return
    }
    if (turnError) {
      emit({ type: "error", errorText: turnError })
      settle("error", turnError)
      return
    }
    if (sawRunResult || doneReason === "completed") {
      settle("completed")
      return
    }
    if (typeof code === "number" && code !== 0) {
      const tail = stderrTail.slice(-3).join("\n")
      settle("error", tail || `cline exited with code ${code}`)
      return
    }
    // Exit 0 with no settlement events (e.g. empty output): treat as
    // completed with whatever streamed.
    settle("completed")
  })

  return {
    interrupt: () => {
      aborted = true
      if (!child || child.exitCode !== null) return
      try {
        // The DIRECT binary dies promptly on SIGINT (live-verified);
        // the npm wrapper must be bypassed for this to work
        // (cline-binary.ts resolves bin/.cline).
        child.kill("SIGINT")
      } catch {
        // Already exited.
      }
      setTimeout(() => {
        try {
          if (child && child.exitCode === null) child.kill("SIGKILL")
        } catch {
          // Already exited.
        }
      }, 3000).unref?.()
    },
    done,
  }
}
