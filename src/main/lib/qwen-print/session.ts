/**
 * mausCode qwen-print turn runner (ours, NOT verbatim).
 *
 * Spawns one `qwen --output-format stream-json` process per turn and
 * projects its JSONL envelope through the shared claude-vocabulary
 * transformer (`createTransformer`: system/assistant/user stream_event +
 * result). Qwen's headless envelope IS that vocabulary (verified live
 * against qwen-code v0.23.3), so only qwen divergences are pre-mapped:
 *
 * - assistant tool_use names are snake_case registry ids (read_file,
 *   run_shell_command, ...): renamed to canonical UI names below, in
 *   both the streamed `content_block_start` and the `assistant`
 *   message (dedupe is id-based, so the rename is display-only).
 * - assistant `usage` snapshots are zeroed (`{input:0, output:0}`):
 *   stripped so the transformer falls back to the real `result.usage`.
 * - `mcp_servers[].status` uses connected/disconnected: disconnected
 *   maps to failed (steady-state attention, matches `mcp list` ✗).
 * - `result.permission_denials[]` (headless auto-decline) surface as a
 *   visible text block: policy violations must never be silent.
 * - `stream_event` goal_state events pass through untouched (the
 *   transformer ignores unknown stream event types).
 *
 * Completion ownership: the transformer yields message-metadata +
 * finish-step + finish on `result`, but the ROUTER owns completion
 * (retry downgrades + persistence ordering, same as the cursor/grok
 * backends). This runner therefore withholds those three chunk types:
 * usage/finalTextId are stashed on the turn result for the router's
 * single message-metadata emission, and error results surface as a
 * held `{type:"error"}` chunk (never a premature finish).
 *
 * Exit contract (live-verified): exit 0 even for in-envelope errors;
 * pre-run failures (unknown args, stale resume) print to STDERR with
 * EMPTY stdout; 130 = SIGINT ("Operation cancelled."), 143 = SIGTERM,
 * 53 = --max-session-turns overrun, 55 = budget abort.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { createTransformer, toClaudeStreamMessage } from "../claude/transform"

export type QwenUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalTokens?: number
}

export type QwenPrintResult = {
  status: "completed" | "error" | "interrupted"
  sessionId?: string
  stopReason?: string
  usage?: QwenUsage
  numTurns?: number
  finalTextId?: string
  errorMessage?: string
  durationMs: number
}

export type QwenPrintTurn = {
  interrupt: () => void
  done: Promise<QwenPrintResult>
}

/** Qwen registry ids -> canonical UI tool names. */
const TOOL_NAME_MAP: Record<string, string> = {
  read_file: "Read",
  write_file: "Write",
  edit: "Edit",
  notebook_edit: "NotebookEdit",
  list_directory: "LS",
  glob: "Glob",
  grep_search: "Grep",
  run_shell_command: "Bash",
  web_fetch: "WebFetch",
  web_search: "WebSearch",
  todo_write: "TodoWrite",
  task: "Task",
  agent: "Task",
  skill: "Skill",
  save_memory: "Memory",
}

function canonicalToolName(raw: unknown): string {
  if (typeof raw !== "string" || raw.length === 0) return "Tool"
  // mcp__<server>__<tool> + goal/cron/loop/worktree internals pass
  // through to the generic renderer fallback.
  return TOOL_NAME_MAP[raw] ?? raw
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/**
 * Pre-map one parsed stream-json line for the shared transformer.
 * Mutates the (freshly parsed, unshared) line in place.
 */
export function premapQwenLine(line: unknown): unknown {
  if (!isRecord(line)) return line
  if (line.type === "assistant") {
    const message = line.message
    if (isRecord(message)) {
      for (const block of asRecordArray(message.content)) {
        if (block.type === "tool_use") {
          block.name = canonicalToolName(block.name)
        }
      }
      // Zeroed snapshots would beat the real result usage (the
      // transformer prefers the last main assistant usage): strip them.
      if (isRecord(message.usage)) {
        const values = Object.values(message.usage)
        if (values.length > 0 && values.every((v) => typeof v === "number" && v === 0)) {
          delete message.usage
        }
      }
    }
  } else if (line.type === "stream_event") {
    const event = line.event
    if (isRecord(event) && isRecord(event.content_block)) {
      if (event.content_block.type === "tool_use") {
        event.content_block.name = canonicalToolName(event.content_block.name)
      }
    }
  } else if (line.type === "system" && line.subtype === "init") {
    for (const server of asRecordArray(line.mcp_servers)) {
      if (server.status === "disconnected") {
        server.status = "failed"
      }
    }
  }
  return line
}

function denialNames(result: Record<string, unknown>): string[] {
  const names: string[] = []
  for (const denial of asRecordArray(result.permission_denials)) {
    if (typeof denial.tool_name === "string" && denial.tool_name.length > 0) {
      names.push(denial.tool_name)
    }
  }
  return names
}

function resultErrorMessage(result: Record<string, unknown>): string | null {
  if (result.is_error !== true) return null
  const error = result.error
  if (isRecord(error) && typeof error.message === "string") {
    return error.message
  }
  if (typeof result.result === "string" && result.result.length > 0) {
    return result.result
  }
  return `Qwen run failed (${String(result.subtype ?? "error")})`
}

function readUsage(result: Record<string, unknown>): QwenUsage | undefined {
  if (!isRecord(result.usage)) return undefined
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined
  const usage: QwenUsage = {
    inputTokens: num(result.usage.input_tokens),
    outputTokens: num(result.usage.output_tokens),
    cacheReadInputTokens: num(result.usage.cache_read_input_tokens),
    totalTokens: num(result.usage.total_tokens),
  }
  if (Object.values(usage).every((v) => v === undefined)) return undefined
  return usage
}

const MAX_STDERR_CHARS = 8192
const SIGINT_ESCALATION_MS = 5000
const SIGTERM_ESCALATION_MS = 5000

/** Chunks emitted onto the AI-SDK UIMessageStream chunk dialect. */
export interface QwenPrintChunk {
  type: string
  id?: string
  delta?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  errorText?: string
  messageMetadata?: unknown
  [key: string]: unknown
}

export type RunQwenPrintTurnOptions = {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  onChunk: (chunk: QwenPrintChunk) => void
  onSessionId?: (sessionId: string) => void
}

export function runQwenPrintTurn(opts: RunQwenPrintTurnOptions): QwenPrintTurn {
  const startedAt = Date.now()
  let settled = false
  let interruptRequested = false
  let child: ChildProcess | null = null
  let sessionId: string | undefined
  let sawResult = false
  let resultUsage: QwenUsage | undefined
  let resultNumTurns: number | undefined
  let resultStopReason: string | undefined
  let finalTextId: string | undefined
  let turnError: string | null = null
  let denialTextId = 0

  let resolveDone!: (result: QwenPrintResult) => void
  const done = new Promise<QwenPrintResult>((resolve) => {
    resolveDone = resolve
  })

  const stderrDecoder = new StringDecoder("utf8")
  let stderrTail = ""
  const appendStderr = (text: string) => {
    stderrTail = (stderrTail + text).slice(-MAX_STDERR_CHARS)
  }

  const settle = (result: Omit<QwenPrintResult, "durationMs">) => {
    if (settled) return
    settled = true
    if (escalationSigterm) clearTimeout(escalationSigterm)
    if (escalationSigkill) clearTimeout(escalationSigkill)
    resolveDone({ ...result, durationMs: Date.now() - startedAt })
  }

  let escalationSigterm: ReturnType<typeof setTimeout> | null = null
  let escalationSigkill: ReturnType<typeof setTimeout> | null = null
  let escalationArmed = false

  const transform = createTransformer()

  const emit = (chunk: QwenPrintChunk) => {
    try {
      opts.onChunk(chunk)
    } catch {
      // Renderer detached; the turn still settles normally.
    }
  }

  // The router owns turn completion, so a result line's metadata and finish
  // chunks are withheld and only their usage/finalTextId facts merge into
  // the turn result the router emits once.
  const mergeResultMetadata = (chunk: QwenPrintChunk) => {
    const meta = (chunk as { messageMetadata?: Record<string, unknown> }).messageMetadata
    if (!isRecord(meta)) return
    if (typeof meta.finalTextId === "string") {
      finalTextId = meta.finalTextId
    }
    const tUsage = readUsage({
      usage: {
        input_tokens: meta.inputTokens,
        output_tokens: meta.outputTokens,
        cache_read_input_tokens: meta.cacheReadInputTokens,
        total_tokens: meta.totalTokens,
      },
    })
    if (tUsage) resultUsage = { ...tUsage, ...resultUsage }
  }

  const emitResultChunks = (chunks: Iterable<QwenPrintChunk>) => {
    for (const chunk of chunks) {
      if (
        chunk.type === "message-metadata" ||
        chunk.type === "finish-step" ||
        chunk.type === "finish"
      ) {
        if (chunk.type === "message-metadata") mergeResultMetadata(chunk)
        continue
      }
      emit(chunk)
    }
  }

  const emitDenialNotice = (denied: string[]) => {
    // Policy violations are visible + persisted (never silent).
    denialTextId += 1
    const id = `qwen-denial-${denialTextId}`
    emit({ type: "text-start", id })
    emit({
      type: "text-delta",
      id,
      delta: `Permission denied by the qwen approval gate: ${denied.join(", ")}. Re-run in a more permissive mode to allow these tools.`,
    })
    emit({ type: "text-end", id })
  }

  const handleResultLine = (parsed: Record<string, unknown>) => {
    sawResult = true
    resultUsage = readUsage(parsed) ?? resultUsage
    if (typeof parsed.num_turns === "number") {
      resultNumTurns = parsed.num_turns
    }
    if (typeof parsed.subtype === "string") {
      resultStopReason = parsed.subtype
    }
    const errorMessage = resultErrorMessage(parsed)
    if (errorMessage) {
      // Error results bypass the transformer (no metadata/finish):
      // the router holds this chunk for retry routing and owns
      // completion, mirroring the cursor/grok backends.
      turnError = errorMessage
      emit({ type: "error", errorText: errorMessage })
      return
    }
    const message = toClaudeStreamMessage(parsed)
    if (!message) return
    emitResultChunks(transform(message))
    const denied = denialNames(parsed)
    if (denied.length > 0) emitDenialNotice(denied)
  }

  const feedLine = (rawLine: string) => {
    const text = rawLine.trim()
    if (text.length === 0) return
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      // Non-JSON stdout (should not happen in stream-json mode):
      // surface verbatim rather than dropping silently.
      emit({ type: "text-delta", id: `qwen-raw-${Date.now()}`, delta: text })
      return
    }
    if (isRecord(parsed) && typeof parsed.session_id === "string") {
      sessionId = parsed.session_id
      opts.onSessionId?.(parsed.session_id)
    }
    try {
      premapQwenLine(parsed)
      if (isRecord(parsed) && parsed.type === "result") {
        handleResultLine(parsed)
        return
      }
      const message = toClaudeStreamMessage(parsed)
      if (!message) return
      for (const chunk of transform(message)) {
        emit(chunk)
      }
    } catch (error) {
      // The child's stdout is an untrusted boundary. A line the transform
      // cannot read must settle the turn with that line's failure rather
      // than throw out of the `data` callback and take the main process
      // with it; `settle` is idempotent, so a later result line cannot
      // resurrect a turn that already ended.
      const detail = error instanceof Error ? error.message : String(error)
      const errorMessage = `Malformed provider message: ${detail}`
      emit({ type: "error", errorText: errorMessage })
      settle({ status: "error", errorMessage, sessionId })
    }
  }

  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn qwen CLI"
    settle({ status: "error", errorMessage: message, sessionId })
    return { interrupt: () => {}, done }
  }

  const stdoutDecoder = new StringDecoder("utf8")
  let lineBuffer = ""
  child.stdout?.on("data", (data: Buffer) => {
    lineBuffer += stdoutDecoder.write(data)
    let index = lineBuffer.indexOf("\n")
    while (index !== -1) {
      const line = lineBuffer.slice(0, index)
      lineBuffer = lineBuffer.slice(index + 1)
      feedLine(line)
      index = lineBuffer.indexOf("\n")
    }
  })
  child.stderr?.on("data", (data: Buffer) => {
    appendStderr(stderrDecoder.write(data))
  })
  child.on("error", (error) => {
    appendStderr(error.message)
    settle({
      status: "error",
      errorMessage: `Failed to run qwen CLI: ${error.message}`,
      sessionId,
    })
  })
  child.on("close", (code, signal) => {
    lineBuffer += stdoutDecoder.end()
    appendStderr(stderrDecoder.end())
    if (lineBuffer.trim().length > 0) {
      feedLine(lineBuffer)
      lineBuffer = ""
    }
    if (settled) return
    const stderrText = stderrTail.trim()
    if (interruptRequested || code === 130 || signal === "SIGINT") {
      settle({ status: "interrupted", sessionId, usage: resultUsage })
      return
    }
    if (code === 143 || signal === "SIGTERM") {
      // Only a requested escalation lands here gracefully; anything
      // else killed the CLI from outside (surfaced, not hidden).
      settle(
        interruptRequested
          ? { status: "interrupted", sessionId, usage: resultUsage }
          : {
              status: "error",
              errorMessage:
                stderrText.length > 0 ? stderrText : "Qwen CLI was terminated (SIGTERM).",
              sessionId,
            },
      )
      return
    }
    if (code === 53) {
      settle({
        status: "error",
        errorMessage:
          "Qwen turn limit reached (--max-session-turns overrun, exit 53). Resume with a higher cap or a narrower task.",
        sessionId,
        usage: resultUsage,
        numTurns: resultNumTurns,
      })
      return
    }
    if (code === 55) {
      settle({
        status: "error",
        errorMessage:
          "Qwen run budget exceeded (exit 55). Resume with a higher budget or a narrower task.",
        sessionId,
        usage: resultUsage,
        numTurns: resultNumTurns,
      })
      return
    }
    if (turnError) {
      settle({
        status: "error",
        errorMessage: turnError,
        sessionId,
        usage: resultUsage,
        numTurns: resultNumTurns,
        stopReason: resultStopReason,
      })
      return
    }
    if (!sawResult) {
      settle({
        status: "error",
        errorMessage:
          stderrText.length > 0
            ? stderrText
            : `Qwen CLI exited (code ${code ?? "unknown"}) with no result.`,
        sessionId,
      })
      return
    }
    settle({
      status: "completed",
      sessionId,
      stopReason: resultStopReason,
      usage: resultUsage,
      numTurns: resultNumTurns,
      finalTextId,
    })
  })

  const interrupt = () => {
    interruptRequested = true
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    if (escalationArmed) return
    escalationArmed = true
    // SIGINT first: the CLI exits 130 with "Operation cancelled."
    // (graceful, session file kept). Escalate only if it ignores us.
    try {
      child.kill("SIGINT")
    } catch {
      // Already gone; close handler settles.
    }
    escalationSigterm = setTimeout(() => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        return
      }
      try {
        child.kill("SIGTERM")
      } catch {
        // Already gone.
      }
    }, SIGINT_ESCALATION_MS)
    escalationSigkill = setTimeout(() => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        return
      }
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    }, SIGINT_ESCALATION_MS + SIGTERM_ESCALATION_MS)
    escalationSigterm.unref?.()
    escalationSigkill.unref?.()
  }

  return { interrupt, done }
}
