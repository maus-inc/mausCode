/**
 * mausCode openclaw-print turn runner (ours, NOT verbatim).
 *
 * Spawns one `openclaw agent exec --json ... --message-file -` process
 * per turn (prompt on stdin) and projects its single JSON envelope to
 * UIMessage chunks. Shapes captured live against openclaw CLI
 * 2026.9.2 (success shape additionally per the stable-envelope docs —
 * sandbox TLS interception blocked a live authenticated turn):
 *
 * - Success: `{ok:true,status:"ok",final,payloads:[{text}],usage:
 *   {input,output,total},costUsd,assistantTurns,toolSummary,model,
 *   provider,sessionId}` (exit 0). `final` is projected as one
 *   text-start/delta/end triple at settle time — exec does NOT
 *   stream, so long turns emit nothing until the envelope lands.
 * - Failure: `{ok:false,status:"error"|"timeout",final:"",payloads:
 *   [],model:null,provider:null,sessionId,error:{message,kind}}`
 *   (exit 1 error, exit 2 timeout — both live-verified).
 * - `toolSummary` carries counts + tool names only (no per-call
 *   inputs/outputs), so no tool cards are synthesized from it —
 *   fabricated tool parts would mislead. Counts surface on the
 *   result for future telemetry.
 * - `sessionId` is recorded for debugging only: exec accepts no
 *   resume flag, so it can never continue a turn.
 * - stderr carries `[diagnostic]` / `[model-fallback/decision]` /
 *   `[agent/embedded]` progress lines plus a trailing echo of the
 *   failure message. Only the tail is kept, for error context.
 *
 * Cancellation: SIGINT is slow/ignored by the CLI (live: a
 * network-blocked turn survived SIGINT and needed SIGKILL), so
 * `interrupt()` sends SIGINT, then escalates to SIGKILL after 3s.
 * Cancellation is detected via our own abort flag.
 *
 * Completion ownership mirrors the sibling runners: this runner
 * never emits message-metadata/finish — the ROUTER owns completion
 * (retry + persistence ordering). Error turns surface as a held
 * `{type:"error"}` chunk (never a premature finish).
 */

import { type ChildProcess, spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

export type OpenclawUsage = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
}

export type OpenclawPrintResult = {
  status: "completed" | "error" | "interrupted"
  /** Exec session id — NOT resumable, debugging only. */
  sessionId?: string
  stopReason?: string
  usage?: OpenclawUsage
  /** Per-call USD sum from the envelope (telemetry only). */
  costUsd?: number
  numTurns?: number
  toolCallCount?: number
  toolNames?: string[]
  model?: string
  provider?: string
  errorMessage?: string
  durationMs: number
}

export type OpenclawPrintTurn = {
  interrupt: () => void
  done: Promise<OpenclawPrintResult>
}

export type RunOpenclawPrintTurnOptions = {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
  /** Prompt text written to the child's stdin. */
  prompt: string
  onChunk: (chunk: any) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toUsage(value: unknown): OpenclawUsage | undefined {
  if (!isRecord(value)) return undefined
  const usage: OpenclawUsage = {}
  if (typeof value.input === "number") usage.inputTokens = value.input
  if (typeof value.output === "number") usage.outputTokens = value.output
  if (typeof value.total === "number") usage.totalTokens = value.total
  return Object.keys(usage).length > 0 ? usage : undefined
}

export function runOpenclawPrintTurn(opts: RunOpenclawPrintTurnOptions): OpenclawPrintTurn {
  const startedAt = Date.now()
  let child: ChildProcess | null = null
  let aborted = false
  let settled = false
  const stderrTail: string[] = []

  let resolveDone!: (result: OpenclawPrintResult) => void
  const done = new Promise<OpenclawPrintResult>((resolve) => {
    resolveDone = resolve
  })

  const emit = (chunk: any) => {
    try {
      opts.onChunk(chunk)
    } catch {
      // Renderer detached; the turn still settles normally.
    }
  }

  const settle = (result: Omit<OpenclawPrintResult, "durationMs">) => {
    if (settled) return
    settled = true
    resolveDone({ ...result, durationMs: Date.now() - startedAt })
  }

  const settleFromEnvelope = (stdoutText: string, exitCode: number | null) => {
    if (aborted) {
      settle({ status: "interrupted" })
      return
    }
    const trimmed = stdoutText.trim()
    if (trimmed.length === 0) {
      // No streamed content exists to fall back on (non-streaming
      // CLI), so empty output is an error, never a completion.
      const tail = stderrTail.slice(-3).join("\n")
      const message = tail || `openclaw produced no output (exit ${exitCode ?? "unknown"})`
      emit({ type: "error", errorText: message })
      settle({ status: "error", errorMessage: message })
      return
    }
    let envelope: unknown
    try {
      envelope = JSON.parse(trimmed)
    } catch {
      const tail = stderrTail.slice(-3).join("\n")
      const message =
        tail || `openclaw produced an unparseable response (exit ${exitCode ?? "unknown"})`
      emit({ type: "error", errorText: message })
      settle({ status: "error", errorMessage: message })
      return
    }
    if (!isRecord(envelope)) {
      const message = "openclaw produced an unexpected response shape"
      emit({ type: "error", errorText: message })
      settle({ status: "error", errorMessage: message })
      return
    }

    const sessionId = typeof envelope.sessionId === "string" ? envelope.sessionId : undefined
    const status = typeof envelope.status === "string" ? envelope.status : undefined
    const usage = toUsage(envelope.usage)
    const costUsd = typeof envelope.costUsd === "number" ? envelope.costUsd : undefined
    const numTurns =
      typeof envelope.assistantTurns === "number" ? envelope.assistantTurns : undefined
    const toolSummary = isRecord(envelope.toolSummary) ? envelope.toolSummary : undefined
    const toolCallCount =
      toolSummary && typeof toolSummary.calls === "number" ? toolSummary.calls : undefined
    const toolNames =
      toolSummary && Array.isArray(toolSummary.tools)
        ? toolSummary.tools.filter((t): t is string => typeof t === "string")
        : undefined
    const model = typeof envelope.model === "string" ? envelope.model : undefined
    const provider = typeof envelope.provider === "string" ? envelope.provider : undefined

    if (envelope.ok === true && status !== "error" && status !== "timeout") {
      const finalText = typeof envelope.final === "string" ? envelope.final : ""
      if (finalText.length > 0) {
        const textId = `openclaw-text-${Date.now()}`
        emit({ type: "text-start", id: textId })
        emit({ type: "text-delta", id: textId, delta: finalText })
        emit({ type: "text-end", id: textId })
      }
      settle({
        status: "completed",
        ...(sessionId ? { sessionId } : {}),
        ...(status ? { stopReason: status } : {}),
        ...(usage ? { usage } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(numTurns !== undefined ? { numTurns } : {}),
        ...(toolCallCount !== undefined ? { toolCallCount } : {}),
        ...(toolNames ? { toolNames } : {}),
        ...(model ? { model } : {}),
        ...(provider ? { provider } : {}),
      })
      return
    }

    const nested = envelope.error
    const message =
      (isRecord(nested) && typeof nested.message === "string" ? nested.message : undefined) ||
      stderrTail.slice(-1)[0] ||
      `openclaw run failed${status ? ` (${status})` : ""}`
    emit({ type: "error", errorText: message })
    settle({
      status: "error",
      ...(sessionId ? { sessionId } : {}),
      ...(status ? { stopReason: status } : {}),
      ...(usage ? { usage } : {}),
      ...(model ? { model } : {}),
      ...(provider ? { provider } : {}),
      errorMessage: message,
    })
  }

  try {
    child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
  } catch (error) {
    settle({
      status: "error",
      errorMessage: error instanceof Error ? error.message : "Failed to spawn openclaw CLI",
    })
    return { interrupt: () => {}, done }
  }

  // Prompt carriage: the full prompt on stdin (`--message-file -`).
  // EPIPE (early child death) settles via the close handler below.
  try {
    child.stdin?.write(opts.prompt)
    child.stdin?.end()
  } catch {
    // Child already gone; close settles the turn.
  }
  child.stdin?.on("error", () => {
    // EPIPE: the close handler settles the turn.
  })

  const stdoutDecoder = new StringDecoder("utf8")
  let stdoutText = ""
  child.stdout?.on("data", (data: Buffer) => {
    stdoutText += stdoutDecoder.write(data)
  })

  const stderrDecoder = new StringDecoder("utf8")
  let stderrBuffer = ""
  child.stderr?.on("data", (data: Buffer) => {
    stderrBuffer += stderrDecoder.write(data)
    let newline = stderrBuffer.indexOf("\n")
    while (newline !== -1) {
      const line = stderrBuffer.slice(0, newline).trim()
      if (line.length > 0) {
        stderrTail.push(line.slice(0, 500))
        if (stderrTail.length > 20) stderrTail.shift()
      }
      stderrBuffer = stderrBuffer.slice(newline + 1)
      newline = stderrBuffer.indexOf("\n")
    }
  })

  child.on("error", (error) => {
    settle({
      status: aborted ? "interrupted" : "error",
      errorMessage: error.message || "Failed to spawn openclaw CLI",
    })
  })

  child.on("close", (code) => {
    stdoutText += stdoutDecoder.end()
    stderrBuffer += stderrDecoder.end()
    const tailLine = stderrBuffer.trim()
    if (tailLine.length > 0) {
      stderrTail.push(tailLine.slice(0, 500))
    }
    settleFromEnvelope(stdoutText, code)
  })

  return {
    interrupt: () => {
      aborted = true
      if (!child || child.exitCode !== null) return
      try {
        // SIGINT first (lets the CLI clean its temp state dir when it
        // honors the signal); live-verified slow/ignored, so SIGKILL
        // follows promptly.
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
