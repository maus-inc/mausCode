/**
 * mausCode roo-print turn runner (ours, NOT verbatim).
 *
 * Spawns one `roo -p --output-format stream-json ... --prompt-file
 * <tmp>` process per turn and projects its NDJSON event stream to
 * UIMessage chunks. Event shapes are source-verified against
 * RooCodeInc/Roo-Code apps/cli at cli-v0.1.17 (repo archived
 * 2026-05-15, CLI frozen): packages/types/src/cli.ts (zod schemas)
 * + agent/json-event-emitter.ts (emission mechanics).
 *
 * Projection notes (each verified in the emitter source):
 * - assistant/followup text: partials carry DELTAS, the final
 *   (done:true) carries the FULL text. The projector dedupes by
 *   prefix: a final whose content starts with the accumulated text
 *   emits only the remainder. Middle deltas may LACK `id`: id-less
 *   text attaches to the currently open text id.
 * - thinking: mirrored on the sibling Thinking tool protocol
 *   (tool-input-start "Thinking" + tool-input-delta JSON fragments +
 *   tool-input-available/tool-output-available at done).
 * - tool_use (subtypes tool/command/mcp, numeric msg.ts ids):
 *   tool-input-available is emitted EXACTLY once per call, at done
 *   (done events carry the full input). Names pass through verbatim
 *   (execute_command, mcp_server, extension tool ids).
 * - tool_result command events carry the call id + output DELTAS +
 *   exitCode at done: output is accumulated and re-emitted
 *   full-to-date; nonzero exitCode (or an `error` field) closes with
 *   tool-output-error instead. mcp tool_results carry NO id: they
 *   attach LIFO to the most recent open mcp call.
 * - Generic ("tool") tool_uses have NO tool_result emission upstream
 *   at all (only command + mcp sites exist in the emitter): outputs
 *   feed the next API request invisibly. Open calls are closed at
 *   turn settle with an output-less tool-output-available so no card
 *   sticks in the "call" state; nothing is synthesized.
 * - result.content duplicates the streamed completion text (the
 *   emitter falls back to lastAssistantText): it is projected as
 *   text ONLY when the turn streamed zero assistant text.
 * - system/control/queue/user events are ignored (handshake bits,
 *   stdin-protocol only, and the prompt echo we persist ourselves).
 * - error events ({type:"error",content}) surface as a held
 *   `{type:"error"}` chunk (never a premature finish).
 *
 * Completion ownership mirrors the sibling runners: this runner
 * never emits message-metadata/finish — the ROUTER owns completion.
 * Usage/cost ride the turn result into the router's single
 * message-metadata emission.
 *
 * Exit contract (source: run.ts + cancellation.ts): 0 ok, 1 error
 * (incl. `[CLI] Error: ...` pre-run validation on stderr);
 * SIGINT->130 / SIGTERM->143 graceful with flush+dispose, so
 * interrupt() leads with SIGINT and escalates to SIGKILL after 5s.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { StringDecoder } from "node:string_decoder"

export type RooUsage = {
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  totalTokens?: number
  /** Per-turn USD cost from the result event (telemetry only). */
  costUsd?: number
}

export type RooPrintResult = {
  status: "completed" | "error" | "interrupted"
  /** Last taskId seen — debugging only (no resume-with-prompt). */
  sessionId?: string
  stopReason?: string
  usage?: RooUsage
  numTurns?: number
  errorMessage?: string
  durationMs: number
}

export type RooPrintTurn = {
  interrupt: () => void
  done: Promise<RooPrintResult>
}

/** Chunks emitted onto the AI-SDK UIMessageStream chunk dialect. */
export interface RooPrintChunk {
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

export type RunRooPrintTurnOptions = {
  command: string
  args: string[]
  cwd: string
  env?: NodeJS.ProcessEnv
  onChunk: (chunk: RooPrintChunk) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readCostUsage(cost: unknown): RooUsage | undefined {
  if (!isRecord(cost)) return undefined
  const usage: RooUsage = {}
  const input = asNumber(cost.inputTokens)
  const output = asNumber(cost.outputTokens)
  const cacheReads = asNumber(cost.cacheReads)
  const cacheWrites = asNumber(cost.cacheWrites)
  const totalCost = asNumber(cost.totalCost)
  if (input !== undefined) usage.inputTokens = input
  if (output !== undefined) usage.outputTokens = output
  if (cacheReads !== undefined) usage.cacheReadInputTokens = cacheReads
  if (cacheWrites !== undefined) usage.cacheCreationInputTokens = cacheWrites
  if (totalCost !== undefined) usage.costUsd = totalCost
  if (input !== undefined && output !== undefined) {
    usage.totalTokens = input + output
  }
  return Object.keys(usage).length > 0 ? usage : undefined
}

const MAX_STDERR_CHARS = 8192
const SIGINT_ESCALATION_MS = 5000

type OpenText = {
  uiId: string
  acc: string
  started: boolean
}

type OpenTool = {
  callId: string
  subtype: string
  /** tool-input-available emitted (exactly-once guard). */
  inputEmitted: boolean
  /** Accumulated command output (full-to-date re-emission). */
  outputAcc: string
}

export function runRooPrintTurn(opts: RunRooPrintTurnOptions): RooPrintTurn {
  const startedAt = Date.now()
  let settled = false
  let interruptRequested = false
  let child: ChildProcess | null = null
  let sessionId: string | undefined
  let sawResult = false
  let resultUsage: RooUsage | undefined
  let turnError: string | null = null
  let streamedAssistantChars = 0
  let fallbackId = 0
  /** Call ids fully closed (dup done-events must not reopen them). */
  const closedCallIds = new Set<string>()

  const openTexts = new Map<string, OpenText>()
  let currentTextKey: string | null = null
  const openThinkings = new Map<string, OpenText>()
  let currentThinkingKey: string | null = null
  const openTools: OpenTool[] = []
  const toolByCallId = new Map<string, OpenTool>()

  let resolveDone!: (result: RooPrintResult) => void
  const done = new Promise<RooPrintResult>((resolve) => {
    resolveDone = resolve
  })

  const stderrDecoder = new StringDecoder("utf8")
  let stderrTail = ""
  const appendStderr = (text: string) => {
    stderrTail = (stderrTail + text).slice(-MAX_STDERR_CHARS)
  }

  const emit = (chunk: RooPrintChunk) => {
    try {
      opts.onChunk(chunk)
    } catch {
      // Renderer detached; the turn still settles normally.
    }
  }

  const closeOpenTools = () => {
    for (const tool of openTools) {
      if (!tool.inputEmitted) continue
      // Output-less close: upstream never emitted a result for this
      // call (generic tools) or the stream died mid-call. The card
      // must not stick in "call" after reload.
      emit({ type: "tool-output-available", toolCallId: tool.callId })
    }
    openTools.length = 0
    toolByCallId.clear()
  }

  const closeOpenTexts = () => {
    for (const text of openTexts.values()) {
      if (text.started) emit({ type: "text-end", id: text.uiId })
    }
    openTexts.clear()
    currentTextKey = null
    for (const thinking of openThinkings.values()) {
      if (!thinking.started) continue
      emit({
        type: "tool-input-available",
        toolCallId: thinking.uiId,
        toolName: "Thinking",
        input: { text: thinking.acc },
      })
      emit({
        type: "tool-output-available",
        toolCallId: thinking.uiId,
        output: { completed: true },
      })
    }
    openThinkings.clear()
    currentThinkingKey = null
  }

  const settle = (result: Omit<RooPrintResult, "durationMs">) => {
    if (settled) return
    settled = true
    if (escalationSigkill) clearTimeout(escalationSigkill)
    closeOpenTexts()
    closeOpenTools()
    resolveDone({ ...result, durationMs: Date.now() - startedAt })
  }

  let escalationSigkill: ReturnType<typeof setTimeout> | null = null
  let escalationArmed = false

  const textKeyFor = (id: unknown): string => {
    if (typeof id === "number" && Number.isFinite(id)) return `n${id}`
    if (typeof id === "string" && id.length > 0) return `s${id}`
    if (currentTextKey && openTexts.has(currentTextKey)) return currentTextKey
    fallbackId += 1
    return `f${fallbackId}`
  }

  const thinkingKeyFor = (id: unknown): string => {
    if (typeof id === "number" && Number.isFinite(id)) return `n${id}`
    if (typeof id === "string" && id.length > 0) return `s${id}`
    if (currentThinkingKey && openThinkings.has(currentThinkingKey)) {
      return currentThinkingKey
    }
    fallbackId += 1
    return `f${fallbackId}`
  }

  /** Final events carry FULL text: emit only the unseen remainder. */
  const deltaForDone = (acc: string, content: string): string => {
    if (acc.length === 0) return content
    if (content.startsWith(acc)) return content.slice(acc.length)
    if (acc.startsWith(content)) return ""
    return content
  }

  const feedAssistant = (event: Record<string, unknown>) => {
    const key = textKeyFor(event.id)
    let open = openTexts.get(key)
    if (!open) {
      fallbackId += 1
      open = { uiId: `roo-text-${fallbackId}`, acc: "", started: false }
      openTexts.set(key, open)
    }
    currentTextKey = key
    if (!open.started) {
      open.started = true
      emit({ type: "text-start", id: open.uiId })
    }
    const content = typeof event.content === "string" ? event.content : ""
    const isDone = event.done === true
    const delta = content.length === 0 ? "" : isDone ? deltaForDone(open.acc, content) : content
    if (delta.length > 0) {
      open.acc += delta
      streamedAssistantChars += delta.length
      emit({ type: "text-delta", id: open.uiId, delta })
    } else if (isDone && content.length > 0) {
      // Fully-duplicate final: still counts as streamed assistant text
      // for the result-content guard.
      streamedAssistantChars += 1
    }
    if (isDone) {
      emit({ type: "text-end", id: open.uiId })
      openTexts.delete(key)
      if (currentTextKey === key) currentTextKey = null
    }
  }

  const feedThinking = (event: Record<string, unknown>) => {
    const key = thinkingKeyFor(event.id)
    let open = openThinkings.get(key)
    if (!open) {
      fallbackId += 1
      const uiId = `roo-thinking-${fallbackId}`
      open = { uiId, acc: "", started: false }
      openThinkings.set(key, open)
    }
    currentThinkingKey = key
    const content = typeof event.content === "string" ? event.content : ""
    const isDone = event.done === true
    if (!open.started) {
      open.started = true
      emit({
        type: "tool-input-start",
        toolCallId: open.uiId,
        toolName: "Thinking",
      })
    }
    const delta = content.length === 0 ? "" : isDone ? deltaForDone(open.acc, content) : content
    if (delta.length > 0) {
      // JSON-fragment protocol (mirrors the claude Thinking path):
      // AI SDK accumulates deltas and repairs partial JSON.
      const escaped = JSON.stringify(delta).slice(1, -1)
      const prefix = open.acc.length === 0 ? '{"text":"' : ""
      open.acc += delta
      emit({
        type: "tool-input-delta",
        toolCallId: open.uiId,
        inputTextDelta: prefix + escaped,
      })
    }
    if (isDone) {
      emit({
        type: "tool-input-available",
        toolCallId: open.uiId,
        toolName: "Thinking",
        input: { text: open.acc },
      })
      emit({
        type: "tool-output-available",
        toolCallId: open.uiId,
        output: { completed: true },
      })
      openThinkings.delete(key)
      if (currentThinkingKey === key) currentThinkingKey = null
    }
  }

  const defaultToolName = (subtype: string): string => {
    if (subtype === "command") return "execute_command"
    if (subtype === "mcp") return "mcp_server"
    return "Tool"
  }

  const feedToolUse = (event: Record<string, unknown>) => {
    const rawId = event.id
    const idPart =
      (typeof rawId === "number" && Number.isFinite(rawId)) || typeof rawId === "string"
        ? String(rawId)
        : `noid-${++fallbackId}`
    const callId = `roo-tool-${idPart}`
    if (closedCallIds.has(callId)) return
    const subtype = typeof event.subtype === "string" ? event.subtype : "tool"
    const info = isRecord(event.tool_use) ? event.tool_use : undefined
    const name = (info && typeof info.name === "string" && info.name) || defaultToolName(subtype)
    const input =
      info && info.input !== undefined
        ? info.input
        : typeof event.content === "string" && event.content.length > 0
          ? { raw: event.content }
          : {}
    let tool = toolByCallId.get(callId)
    if (!tool) {
      tool = { callId, subtype, inputEmitted: false, outputAcc: "" }
      toolByCallId.set(callId, tool)
      openTools.push(tool)
    }
    // Exactly-once input at done (done events carry full input).
    if (event.done === true && !tool.inputEmitted) {
      tool.inputEmitted = true
      emit({
        type: "tool-input-available",
        toolCallId: callId,
        toolName: name,
        input,
      })
      if (subtype === "tool") {
        // No upstream result emission exists for generic tools:
        // close immediately so the card never sticks in "call".
        emit({ type: "tool-output-available", toolCallId: callId })
        toolByCallId.delete(callId)
        const index = openTools.indexOf(tool)
        if (index !== -1) openTools.splice(index, 1)
      }
    }
  }

  const findToolForResult = (
    event: Record<string, unknown>,
    subtype: string,
  ): OpenTool | undefined => {
    const rawId = event.id
    if (
      (typeof rawId === "number" && Number.isFinite(rawId)) ||
      (typeof rawId === "string" && rawId.length > 0)
    ) {
      const direct = toolByCallId.get(`roo-tool-${String(rawId)}`)
      if (direct) return direct
    }
    // Id-less results (mcp): LIFO attach to the most recent open
    // call of the same subtype.
    for (let i = openTools.length - 1; i >= 0; i--) {
      if (openTools[i].subtype === subtype) return openTools[i]
    }
    return undefined
  }

  const feedToolResult = (event: Record<string, unknown>) => {
    const subtype = typeof event.subtype === "string" ? event.subtype : ""
    const info = isRecord(event.tool_result) ? event.tool_result : undefined
    const tool = findToolForResult(event, subtype)
    if (!tool) return
    // A result for a call whose input never emitted (stream started
    // mid-turn): emit the input first so the output has a card.
    if (!tool.inputEmitted) {
      tool.inputEmitted = true
      emit({
        type: "tool-input-available",
        toolCallId: tool.callId,
        toolName:
          (info && typeof info.name === "string" && info.name) || defaultToolName(tool.subtype),
        input: {},
      })
    }
    const outputDelta = info && typeof info.output === "string" ? info.output : ""
    if (outputDelta.length > 0) {
      tool.outputAcc += outputDelta
      if (event.done !== true) {
        emit({
          type: "tool-output-available",
          toolCallId: tool.callId,
          output: tool.outputAcc,
        })
      }
    }
    if (event.done === true) {
      const errorText = info && typeof info.error === "string" ? info.error : ""
      const exitCode = info ? asNumber(info.exitCode) : undefined
      if (errorText.length > 0 || (exitCode !== undefined && exitCode !== 0)) {
        emit({
          type: "tool-output-error",
          toolCallId: tool.callId,
          errorText:
            errorText.length > 0
              ? errorText
              : `Command exited with code ${exitCode}${tool.outputAcc.length > 0 ? `\n${tool.outputAcc}` : ""}`,
        })
      } else {
        emit({
          type: "tool-output-available",
          toolCallId: tool.callId,
          output: tool.outputAcc,
        })
      }
      toolByCallId.delete(tool.callId)
      closedCallIds.add(tool.callId)
      const index = openTools.indexOf(tool)
      if (index !== -1) openTools.splice(index, 1)
    }
  }

  const feedResult = (event: Record<string, unknown>) => {
    sawResult = true
    const usage = readCostUsage(event.cost)
    if (usage) resultUsage = { ...resultUsage, ...usage }
    if (event.success === false) {
      const message =
        typeof event.content === "string" && event.content.length > 0
          ? event.content
          : "Roo task failed."
      turnError = message
      emit({ type: "error", errorText: message })
      return
    }
    const content = typeof event.content === "string" ? event.content : ""
    // result.content duplicates the streamed completion text: project
    // it only when the turn streamed zero assistant text.
    if (content.length > 0 && streamedAssistantChars === 0) {
      fallbackId += 1
      const id = `roo-result-${fallbackId}`
      emit({ type: "text-start", id })
      emit({ type: "text-delta", id, delta: content })
      emit({ type: "text-end", id })
      streamedAssistantChars += content.length
    }
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
      fallbackId += 1
      emit({ type: "text-delta", id: `roo-raw-${fallbackId}`, delta: text })
      return
    }
    if (!isRecord(parsed)) return
    if (typeof parsed.taskId === "string" && parsed.taskId.length > 0) {
      sessionId = parsed.taskId
    }
    switch (parsed.type) {
      case "assistant":
        feedAssistant(parsed)
        break
      case "thinking":
        feedThinking(parsed)
        break
      case "tool_use":
        feedToolUse(parsed)
        break
      case "tool_result":
        feedToolResult(parsed)
        break
      case "error": {
        const message =
          typeof parsed.content === "string" && parsed.content.length > 0
            ? parsed.content
            : "Roo run failed."
        turnError = message
        emit({ type: "error", errorText: message })
        break
      }
      case "result":
        feedResult(parsed)
        break
      default:
        // system/control/queue/user: handshake, stdin-protocol, echo.
        break
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
    const message = error instanceof Error ? error.message : "Failed to spawn roo CLI"
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
      errorMessage: `Failed to run roo CLI: ${error.message}`,
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
      settle(
        interruptRequested
          ? { status: "interrupted", sessionId, usage: resultUsage }
          : {
              status: "error",
              errorMessage:
                stderrText.length > 0 ? stderrText : "Roo CLI was terminated (SIGTERM).",
              sessionId,
            },
      )
      return
    }
    if (turnError) {
      settle({
        status: "error",
        errorMessage: turnError,
        sessionId,
        usage: resultUsage,
      })
      return
    }
    if (!sawResult) {
      settle({
        status: "error",
        errorMessage:
          stderrText.length > 0
            ? stderrText
            : `Roo CLI exited (code ${code ?? "unknown"}) with no result.`,
        sessionId,
      })
      return
    }
    settle({
      status: "completed",
      sessionId,
      stopReason: "result",
      usage: resultUsage,
    })
  })

  const interrupt = () => {
    interruptRequested = true
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    if (escalationArmed) return
    escalationArmed = true
    // SIGINT first: the CLI flushes + disposes gracefully (exit 130).
    // Escalate only if it ignores us.
    try {
      child.kill("SIGINT")
    } catch {
      // Already gone; close handler settles.
    }
    escalationSigkill = setTimeout(() => {
      if (!child || child.exitCode !== null || child.signalCode !== null) {
        return
      }
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
    }, SIGINT_ESCALATION_MS)
    escalationSigkill.unref?.()
  }

  return { interrupt, done }
}
