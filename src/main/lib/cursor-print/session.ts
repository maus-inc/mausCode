/**
 * mausCode cursor native-print adapter (ours, NOT a port).
 *
 * Runs one `agent -p --output-format stream-json --stream-partial-output`
 * process per turn and translates the NDJSON events onto the AI-SDK
 * UIMessageStream chunk dialect. Resume passes the previous thread id via
 * `--resume`; cancel kills the child (print mode has no abort API).
 *
 * Protocol (cursor.com/docs/cli/reference/output-format, 2026-09-11):
 * - assistant events come in two shapes: streaming deltas (`timestamp_ms`
 *   WITHOUT `model_call_id`, only with `--stream-partial-output`) and
 *   complete-message snapshots (no `timestamp_ms`). Buffered flushes
 *   flushes (pre-tool-call, end-of-turn) repeat text and must be skipped.
 * - tool_call started/completed correlate by `call_id`; tool shape is
 *   `{readToolCall|writeToolCall|...: {args, result?}}` or `{function:
 *   {name, arguments}}`.
 * - terminal `result` carries session_id + duration; failures exit non-zero
 *   with a stderr message and may end the stream early without `result`.
 * - no usage/token fields exist anywhere in the protocol.
 */
import { spawn, type ChildProcess } from "node:child_process"
import { randomUUID } from "node:crypto"

export type CursorPrintChunk = any

export type CursorPrintResult =
  | {
      status: "completed"
      sessionId?: string
      durationMs: number
    }
  | { status: "interrupted"; sessionId?: string; durationMs: number }
  | {
      status: "error"
      errorMessage: string
      sessionId?: string
      durationMs: number
    }

export type CursorPrintTurn = {
  interrupt: () => void
  done: Promise<CursorPrintResult>
}

const MAX_STDERR_CHARS = 8192

const CURSOR_TOOL_ALIASES: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  shell: "Bash",
  grep: "Grep",
  search: "Grep",
  glob: "Glob",
  list: "Glob",
  ls: "LS",
  todo: "TodoWrite",
  updatetodos: "TodoWrite",
  task: "Task",
  websearch: "WebSearch",
  webfetch: "WebFetch",
  fetch: "WebFetch",
  delete: "Delete",
}

function canonicalCursorToolName(raw: string): string {
  if (raw.length === 0) return "tool"
  return CURSOR_TOOL_ALIASES[raw.toLowerCase()] ?? raw
}

function toolNameFromCall(toolCall: Record<string, unknown>): {
  name: string
  input: unknown
} {
  const functionCall = toolCall.function as { name?: unknown; arguments?: unknown } | undefined
  if (functionCall && typeof functionCall === "object") {
    let input: unknown = functionCall.arguments
    if (typeof input === "string") {
      try {
        input = JSON.parse(input)
      } catch {
        // Keep the raw string.
      }
    }
    const rawName =
      typeof functionCall.name === "string" && functionCall.name.length > 0
        ? functionCall.name
        : "function"
    return { name: canonicalCursorToolName(rawName), input: input ?? {} }
  }
  const key = Object.keys(toolCall).find((candidate) => candidate !== "function")
  const entry = (key ? toolCall[key] : undefined) as { args?: unknown } | undefined
  const raw = typeof key === "string" ? key.replace(/ToolCall$/, "") : ""
  return { name: canonicalCursorToolName(raw), input: entry?.args ?? {} }
}

function toolOutputFromCall(toolCall: Record<string, unknown>): unknown {
  const functionCall = toolCall.function as { result?: unknown } | undefined
  // Cursor tool results come in three shapes: `{success}`, `{error}`,
  // and `{rejected: {reason}}` (policy/approval rejections, e.g. delete).
  const unwrap = (result: unknown): unknown => {
    if (result && typeof result === "object") {
      const record = result as {
        success?: unknown
        error?: unknown
        rejected?: unknown
      }
      if ("success" in record) return record.success ?? ""
      if ("error" in record) return { error: record.error ?? "tool failed" }
      if ("rejected" in record) {
        const rejected = record.rejected as { reason?: unknown } | null
        const reason = rejected && typeof rejected === "object" ? rejected.reason : undefined
        return {
          error:
            typeof reason === "string" && reason.length > 0
              ? `rejected: ${reason}`
              : "rejected by policy",
        }
      }
      return result
    }
    return result ?? ""
  }
  if (functionCall && typeof functionCall === "object" && "result" in functionCall) {
    return unwrap((functionCall as { result?: unknown }).result)
  }
  const key = Object.keys(toolCall).find((candidate) => candidate !== "function")
  const entry = (key ? toolCall[key] : undefined) as { result?: unknown } | undefined
  return unwrap(entry?.result)
}

function textFromContent(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (block): block is { type: string; text: string } =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("")
}

export function runCursorPrintTurn(opts: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  onChunk: (chunk: CursorPrintChunk) => void
  onSessionId?: (sessionId: string) => void
  /**
   * Prompt text delivered on stdin instead of argv. `agent -p` reads a
   * piped prompt from stdin; used for very long prompts that would
   * overflow OS command-line limits (notably Windows' ~32KB cap).
   */
  stdinText?: string
}): CursorPrintTurn {
  const startedAt = Date.now()
  const textId = `cursor-${randomUUID()}`
  let textOpen = false
  let sessionId: string | undefined
  let interrupted = false
  let settled = false
  // FIFO of started tool-call ids. Events that carry `call_id`
  // correlate exactly; when it is missing, completions are matched
  // oldest-open-first (best effort; tools usually run sequentially).
  const openToolCallIds: string[] = []

  let resolveDone!: (result: CursorPrintResult) => void
  const done = new Promise<CursorPrintResult>((resolve) => {
    resolveDone = resolve
  })

  const emit = (chunk: CursorPrintChunk) => {
    if (!settled) opts.onChunk(chunk)
  }
  const reportSessionId = (id: unknown) => {
    if (typeof id === "string" && id.length > 0) {
      sessionId = id
      opts.onSessionId?.(id)
    }
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
  const settle = (result: CursorPrintResult) => {
    if (settled) return
    closeText() // Emits while still unsettled; post-settle emits stop.
    settled = true
    resolveDone(result)
  }

  const child: ChildProcess = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: [opts.stdinText !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true,
  })
  if (opts.stdinText !== undefined && child.stdin) {
    // Best effort: the turn still runs if stdin is already closed.
    child.stdin.on("error", () => {})
    child.stdin.write(opts.stdinText, () => {
      try {
        child.stdin?.end()
      } catch {
        // Already closed.
      }
    })
  }

  let stdoutBuffer = ""
  let stderrText = ""
  let assistantDeltaMode: boolean | null = null
  let lastAssistantFull = ""

  const handleEvent = (event: any) => {
    if (!event || typeof event !== "object") return
    if (typeof event.session_id === "string") reportSessionId(event.session_id)
    switch (event.type) {
      case "assistant": {
        const hasTimestamp = event.timestamp_ms !== undefined
        const hasModelCallId = event.model_call_id !== undefined
        const text = textFromContent(event.message)
        const isDelta = hasTimestamp && !hasModelCallId
        if (assistantDeltaMode === null && text.length > 0) {
          // The CLI never mixes shapes mid-run: lock the mode on first text.
          assistantDeltaMode = isDelta
        }
        if (isDelta && assistantDeltaMode === true) {
          emitDelta(text)
        } else if (!isDelta && assistantDeltaMode === false && text.length > 0) {
          // Complete-message snapshots: repeat flushes are common (before
          // tool calls, at end of turn). Dedupe against the last snapshot.
          if (text === lastAssistantFull) break
          if (lastAssistantFull.length > 0 && text.startsWith(lastAssistantFull)) {
            emitDelta(text.slice(lastAssistantFull.length))
          } else {
            // Fresh message after a tool call (no shared prefix): append.
            emitDelta(text)
          }
          lastAssistantFull = text
        }
        // Buffered flushes in delta mode are duplicates of deltas: skip.
        break
      }
      case "tool_call": {
        const hasCallId = typeof event.call_id === "string"
        const toolCall =
          event.tool_call && typeof event.tool_call === "object"
            ? (event.tool_call as Record<string, unknown>)
            : {}
        // Documented subtypes are started/completed; treat any other
        // defined subtype (failed/error/...) as completion so a failed
        // tool never fabricates a phantom tool-input event.
        const isCompletion = event.subtype !== undefined && event.subtype !== "started"
        if (isCompletion) {
          const callId = hasCallId
            ? (event.call_id as string)
            : (openToolCallIds.shift() ?? randomUUID())
          if (hasCallId) {
            const index = openToolCallIds.indexOf(event.call_id as string)
            if (index >= 0) openToolCallIds.splice(index, 1)
          }
          emit({
            type: "tool-output-available",
            toolCallId: callId,
            output: toolOutputFromCall(toolCall),
          })
        } else {
          const callId = hasCallId ? (event.call_id as string) : randomUUID()
          if (!hasCallId) openToolCallIds.push(callId)
          const { name, input } = toolNameFromCall(toolCall)
          emit({ type: "tool-input-start", toolCallId: callId, toolName: name })
          emit({
            type: "tool-input-available",
            toolCallId: callId,
            toolName: name,
            input,
          })
        }
        break
      }
      case "result": {
        const ok =
          event.is_error !== true &&
          (event.subtype === undefined ||
            event.subtype === "success" ||
            event.subtype === "completed")
        // Prefer the CLI-reported run duration; fall back to wall clock.
        const durationMs =
          typeof event.duration_ms === "number" && event.duration_ms >= 0
            ? event.duration_ms
            : Date.now() - startedAt
        if (ok) {
          settle({ status: "completed", sessionId, durationMs })
        } else {
          const message =
            typeof event.result === "string" && event.result.length > 0
              ? event.result
              : typeof event.error === "string" && event.error.length > 0
                ? event.error
                : "cursor run failed"
          emit({ type: "error", errorText: message })
          settle({ status: "error", errorMessage: message, sessionId, durationMs })
        }
        break
      }
      default: {
        // system/init (session captured above), user echo, thinking
        // (suppressed in print mode), and future fields: ignored.
        break
      }
    }
  }

  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8")
    let newline = stdoutBuffer.indexOf("\n")
    while (newline >= 0) {
      const line = stdoutBuffer.slice(0, newline).trim()
      stdoutBuffer = stdoutBuffer.slice(newline + 1)
      if (line.length > 0) {
        try {
          handleEvent(JSON.parse(line))
        } catch {
          // Non-JSON stdout (progress noise): ignore.
        }
      }
      newline = stdoutBuffer.indexOf("\n")
    }
  })
  child.stderr?.on("data", (chunk) => {
    stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-MAX_STDERR_CHARS)
  })
  child.on("error", (error) => {
    if (settled) return
    const message = `cursor: failed to start: ${error.message}`
    emit({ type: "error", errorText: message })
    settle({
      status: "error",
      errorMessage: message,
      sessionId,
      durationMs: Date.now() - startedAt,
    })
  })
  child.on("close", (code) => {
    // Flush a final line that arrived without a trailing newline
    // (e.g. a `result` event at the very end of stdout).
    const tail = stdoutBuffer.trim()
    stdoutBuffer = ""
    if (tail.length > 0) {
      try {
        handleEvent(JSON.parse(tail))
      } catch {
        // Non-JSON stdout (progress noise): ignore.
      }
    }
    if (settled) return
    if (interrupted) {
      settle({ status: "interrupted", sessionId, durationMs: Date.now() - startedAt })
      return
    }
    if (code === 0) {
      // Defensive: well-behaved runs settle on `result`; a clean exit
      // without one still completes with whatever streamed.
      settle({ status: "completed", sessionId, durationMs: Date.now() - startedAt })
      return
    }
    const message =
      stderrText.trim().length > 0 ? stderrText.trim() : `cursor exited with code ${code}`
    emit({ type: "error", errorText: message })
    settle({
      status: "error",
      errorMessage: message,
      sessionId,
      durationMs: Date.now() - startedAt,
    })
  })

  return {
    interrupt: () => {
      if (settled) return
      interrupted = true
      try {
        child.kill("SIGTERM")
        const killer = setTimeout(() => {
          try {
            child.kill("SIGKILL")
          } catch {
            // Already gone.
          }
        }, 2000)
        killer.unref?.()
      } catch {
        // Already gone; close handler settles.
      }
    },
    done,
  }
}
