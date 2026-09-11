/**
 * mausCode opencode backend adapter (ours, NOT a port).
 *
 * Spawns `opencode serve` on a loopback free port per chat, drives it via
 * the official `@opencode-ai/sdk` client, and translates opencode bus events
 * (SSE) onto the AI-SDK UIMessageStream chunk dialect the renderer consumes.
 *
 * Turn lifecycle: `promptAsync` -> `message.part.updated` deltas ->
 * `session.idle` settles the turn; `session.error` settles failures
 * (`MessageAbortedError` = user interrupt, silent); `session.status: retry`
 * is transient (log only). Usage (tokens + cost) arrives natively on
 * `step-finish` parts — no polling.
 *
 * Permissions auto-reply `{response:"always"}` (session-wide parity with the
 * codex adapter). `opencode.json` can tighten per-tool policy; the capability
 * manifest reports the effective posture.
 */
import { type ChildProcess, spawn } from "node:child_process"
import { createServer } from "node:net"
import { pathToFileURL } from "node:url"
import {
  createOpencodeClient,
  type Event,
  type OpencodeClient,
  type Part,
  type ReasoningPart,
  type TextPart,
  type ToolPart,
} from "@opencode-ai/sdk"

export type OpencodeSessionChunk = any

export type OpencodeTurnInput =
  | { type: "text"; text: string }
  | { type: "file"; path: string; mime: string; filename?: string }

export type OpencodeTurnUsage = {
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUsd: number
}

export type OpencodeTurnResult =
  | { status: "completed"; usage: OpencodeTurnUsage }
  | { status: "interrupted"; usage: OpencodeTurnUsage }
  | { status: "error"; errorMessage: string; usage: OpencodeTurnUsage }

export type OpencodeSession = {
  sessionId: string
  /**
   * Rebind the chunk sink (a session outlives a single streamed run; exactly
   * one run is in flight at a time).
   */
  setOnChunk: (onChunk: (chunk: OpencodeSessionChunk) => void) => void
  startTurn: (input: OpencodeTurnInput[], opts?: { model?: string }) => Promise<OpencodeTurnResult>
  interrupt: () => Promise<void>
  dispose: () => Promise<void>
}

async function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now()
  let exited = false
  let exitCode: number | null = null
  child.on("exit", (code) => {
    exited = true
    exitCode = code
  })
  for (;;) {
    if (exited) {
      throw new Error(`opencode server exited before becoming healthy (code ${exitCode})`)
    }
    try {
      const response = await fetch(`${baseUrl}/global/health`)
      if (response.ok) return
    } catch {
      // Not up yet.
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`opencode server did not become healthy: ${baseUrl}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

/** Cross-backend tool naming (codex parity); unknown tools pass through. */
function normalizeToolName(tool: string): string {
  const aliases: Record<string, string> = {
    bash: "Bash",
    edit: "Edit",
    write: "Edit",
    read: "Read",
    websearch: "WebSearch",
    webfetch: "WebFetch",
    task: "Task",
    todowrite: "TodoWrite",
    todoread: "TodoRead",
  }
  return aliases[tool.toLowerCase()] ?? tool
}

function parseModel(model?: string): { providerID: string; modelID: string } | undefined {
  if (!model) return undefined
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) return undefined
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  }
}

function mustData<T>(result: { data?: T }, what: string): T {
  if (result.data === undefined) {
    throw new Error(`opencode: missing ${what} in response`)
  }
  return result.data
}

function emptyUsage(): OpencodeTurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  }
}

export async function createOpencodeSession(opts: {
  /** Binary for `opencode serve`. Ignored when `serverUrl` is set. */
  binaryPath?: string
  cwd: string
  env: Record<string, string>
  /** Test seam: connect to an existing server instead of spawning. */
  serverUrl?: string
  existingSessionId?: string
  model?: string
  title?: string
  onChunk: (chunk: OpencodeSessionChunk) => void
  onUsage?: (usage: OpencodeTurnUsage) => void
}): Promise<OpencodeSession> {
  let emit = opts.onChunk
  const emitUsage = opts.onUsage ?? (() => {})

  let child: ChildProcess | null = null
  let baseUrl = opts.serverUrl ?? ""
  if (!baseUrl) {
    if (!opts.binaryPath) {
      throw new Error("opencode: binaryPath or serverUrl is required")
    }
    let lastError: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const port = await pickFreePort()
      baseUrl = `http://127.0.0.1:${port}`
      const spawned = spawn(
        opts.binaryPath,
        ["serve", "--port", String(port), "--hostname", "127.0.0.1"],
        {
          cwd: opts.cwd,
          env: opts.env,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      // Drain both pipes; an unread pipe buffer (>64KB) would block the child.
      spawned.stdout?.on("data", () => {})
      spawned.stderr?.on("data", () => {
        // Drain stderr; surfaced via health/exit errors only.
      })
      try {
        await waitForHealth(baseUrl, spawned, 15000)
        child = spawned
        lastError = null
        break
      } catch (error) {
        lastError = error
        try {
          spawned.kill("SIGKILL")
        } catch {
          // Best effort.
        }
      }
    }
    if (!child) {
      throw lastError instanceof Error ? lastError : new Error("opencode: failed to start server")
    }
  }

  const client: OpencodeClient = createOpencodeClient({
    baseUrl,
    throwOnError: true,
  })

  // Per-turn mutable state (single in-flight turn per session).
  let turnDone: ((result: OpencodeTurnResult) => void) | null = null
  let turnSettled = false
  let turnUsage = emptyUsage()
  const openTextIds = new Set<string>()
  const seenToolCalls = new Set<string>()
  const finishedToolCalls = new Set<string>()
  const reasoningText: Record<string, string> = {}
  // Chars already emitted per text part; snapshots emit only the fresh suffix
  // (the bus may mix full snapshots with deltas, in any order).
  const textEmitted: Record<string, number> = {}

  const settleTurn = (result: OpencodeTurnResult) => {
    if (turnSettled) return
    turnSettled = true
    turnDone?.(result)
  }
  const resetTurnState = () => {
    turnSettled = false
    turnDone = null
    turnUsage = emptyUsage()
    openTextIds.clear()
    seenToolCalls.clear()
    finishedToolCalls.clear()
    for (const key of Object.keys(reasoningText)) delete reasoningText[key]
    for (const key of Object.keys(textEmitted)) delete textEmitted[key]
  }
  const closeText = (id: string) => {
    if (!openTextIds.has(id)) return
    openTextIds.delete(id)
    emit({ type: "text-end", id })
  }
  const closeAllText = () => {
    for (const id of [...openTextIds]) closeText(id)
  }
  const finishReasoning = (part: ReasoningPart) => {
    const text = reasoningText[part.id] ?? part.text ?? ""
    delete reasoningText[part.id]
    if (text.length === 0) return
    emit({ type: "tool-input-start", toolCallId: part.id, toolName: "Thinking" })
    emit({
      type: "tool-input-available",
      toolCallId: part.id,
      toolName: "Thinking",
      input: { text },
    })
    emit({ type: "tool-output-available", toolCallId: part.id, output: { text } })
  }

  const handlePartUpdated = (part: Part, delta?: string) => {
    if (part.sessionID !== sessionId) return
    switch (part.type) {
      case "text": {
        const text = part as TextPart
        const emitted = textEmitted[text.id] ?? 0
        let fresh = ""
        if (delta !== undefined && delta.length > 0) {
          fresh = delta
        } else if (text.text.length > emitted) {
          // Snapshot-only (or snapshot-first) update: emit the fresh suffix.
          fresh = text.text.slice(emitted)
        }
        if (fresh.length > 0) {
          if (!openTextIds.has(text.id)) {
            openTextIds.add(text.id)
            emit({ type: "text-start", id: text.id })
          }
          textEmitted[text.id] = emitted + fresh.length
          emit({ type: "text-delta", id: text.id, delta: fresh })
        }
        if (text.time?.end !== undefined) closeText(text.id)
        break
      }
      case "reasoning": {
        const reasoning = part as ReasoningPart
        if (delta !== undefined && delta.length > 0) {
          reasoningText[reasoning.id] = (reasoningText[reasoning.id] ?? "") + delta
        } else {
          const snapshot = reasoning.text ?? ""
          // Snapshots are authoritative full text; deltas only append when
          // they extend what we already hold.
          if (snapshot.length >= (reasoningText[reasoning.id]?.length ?? 0)) {
            reasoningText[reasoning.id] = snapshot
          }
        }
        if (reasoning.time?.end !== undefined) finishReasoning(reasoning)
        break
      }
      case "tool": {
        const tool = part as ToolPart
        const toolName = normalizeToolName(tool.tool)
        if (!seenToolCalls.has(tool.callID)) {
          seenToolCalls.add(tool.callID)
          emit({ type: "tool-input-start", toolCallId: tool.callID, toolName })
          emit({
            type: "tool-input-available",
            toolCallId: tool.callID,
            toolName,
            input: tool.state.input ?? {},
          })
        }
        // Terminal states emit once; duplicate bus deliveries are ignored.
        if (tool.state.status === "completed" && !finishedToolCalls.has(tool.callID)) {
          finishedToolCalls.add(tool.callID)
          emit({
            type: "tool-output-available",
            toolCallId: tool.callID,
            output: tool.state.output ?? "",
          })
        } else if (tool.state.status === "error" && !finishedToolCalls.has(tool.callID)) {
          // Per-tool failure: the turn continues; report as tool output.
          finishedToolCalls.add(tool.callID)
          emit({
            type: "tool-output-available",
            toolCallId: tool.callID,
            output: { error: tool.state.error ?? "tool failed" },
          })
        }
        break
      }
      case "step-finish": {
        const tokens = part.tokens
        turnUsage = {
          inputTokens: turnUsage.inputTokens + (tokens?.input ?? 0),
          outputTokens: turnUsage.outputTokens + (tokens?.output ?? 0),
          reasoningTokens: turnUsage.reasoningTokens + (tokens?.reasoning ?? 0),
          cacheReadTokens: turnUsage.cacheReadTokens + (tokens?.cache?.read ?? 0),
          cacheWriteTokens: turnUsage.cacheWriteTokens + (tokens?.cache?.write ?? 0),
          costUsd: turnUsage.costUsd + (part.cost ?? 0),
        }
        emitUsage({ ...turnUsage })
        break
      }
      default: {
        // file/patch/snapshot/subtask/agent/retry/compaction/step-start and
        // message scaffolding: no chunk mapping; the opencode session keeps
        // the full record.
        break
      }
    }
  }

  const handleEvent = (event: Event) => {
    switch (event.type) {
      case "message.part.updated": {
        handlePartUpdated(event.properties.part, event.properties.delta)
        break
      }
      case "permission.updated": {
        const permission = event.properties
        if (permission.sessionID !== sessionId) break
        void client
          .postSessionIdPermissionsPermissionId({
            path: { id: sessionId, permissionID: permission.id },
            body: { response: "always" },
          })
          .catch((error: unknown) => {
            console.warn("[opencode] permission auto-reply failed:", error)
          })
        break
      }
      case "session.idle": {
        if (event.properties.sessionID !== sessionId) break
        closeAllText()
        for (const id of Object.keys(reasoningText)) {
          finishReasoning({ id, text: reasoningText[id] } as ReasoningPart)
        }
        settleTurn({ status: "completed", usage: { ...turnUsage } })
        break
      }
      case "session.error": {
        const sessionID = event.properties.sessionID
        if (sessionID !== undefined && sessionID !== sessionId) break
        const error = event.properties.error as
          | { name?: string; data?: { message?: string } }
          | undefined
        if (error?.name === "MessageAbortedError") {
          closeAllText()
          settleTurn({ status: "interrupted", usage: { ...turnUsage } })
        } else {
          const message = error?.data?.message ?? error?.name ?? "opencode session error"
          closeAllText()
          emit({ type: "error", errorText: message })
          settleTurn({
            status: "error",
            errorMessage: message,
            usage: { ...turnUsage },
          })
        }
        break
      }
      case "session.status": {
        // Transient retry state: log and wait for the terminal outcome.
        if (event.properties.sessionID !== sessionId) break
        if (event.properties.status.type === "retry") {
          console.warn(`[opencode] session retry: ${event.properties.status.message}`)
        }
        break
      }
      default: {
        break
      }
    }
  }

  // Declared before the SSE consumer starts: early bus events must compare
  // against "" (ignored), never hit the temporal dead zone.
  let sessionId = ""
  let sseDead = false
  const consumeEvents = async () => {
    try {
      const { stream } = await client.global.event()
      for await (const envelope of stream) {
        try {
          handleEvent(envelope.payload)
        } catch (error) {
          console.warn("[opencode] event handling failed:", error)
        }
      }
    } catch (error) {
      sseDead = true
      if (!turnSettled && turnDone) {
        const message = error instanceof Error ? error.message : String(error)
        closeAllText()
        emit({ type: "error", errorText: message })
        settleTurn({
          status: "error",
          errorMessage: message,
          usage: { ...turnUsage },
        })
      }
    }
  }
  // Never awaited: the SSE stream only ends when the server dies or the
  // connection closes (dispose kills the child / tests close the mock).
  // The noop catch prevents unhandled rejections after dispose.
  const sseTask = consumeEvents()
  sseTask.catch(() => {})

  // Session: resume when the id still resolves, else create.
  if (opts.existingSessionId) {
    try {
      const existing = await client.session.get({
        path: { id: opts.existingSessionId },
      })
      sessionId = mustData(existing, "session").id
    } catch (error) {
      console.warn(
        `[opencode] session resume failed for ${opts.existingSessionId}, creating:`,
        error,
      )
      const created = await client.session.create({
        body: { title: opts.title },
      })
      sessionId = mustData(created, "session").id
    }
  } else {
    const created = await client.session.create({ body: { title: opts.title } })
    sessionId = mustData(created, "session").id
  }

  let disposed = false
  return {
    // Getter: the id can change mid-life (recreate-on-404 retry).
    get sessionId() {
      return sessionId
    },
    setOnChunk: (onChunk) => {
      emit = onChunk
    },
    startTurn: async (input, turnOpts) => {
      resetTurnState()
      if (sseDead) {
        throw new Error("opencode: event stream is dead")
      }
      const done = new Promise<OpencodeTurnResult>((resolve) => {
        turnDone = resolve
      })
      const parts = input.map((item) =>
        item.type === "text"
          ? { type: "text" as const, text: item.text }
          : {
              type: "file" as const,
              mime: item.mime,
              filename: item.filename,
              // file:// URL (matches the TUI uploader); plain paths fail.
              url: pathToFileURL(item.path).href,
            },
      )
      const model = parseModel(turnOpts?.model ?? opts.model)
      try {
        await client.session.promptAsync({
          path: { id: sessionId },
          body: { parts, ...(model ? { model } : {}) },
        })
      } catch (error) {
        // The session may have been deleted server-side; recreate once.
        const created = await client.session.create({
          body: { title: opts.title },
        })
        sessionId = mustData(created, "session").id
        await client.session.promptAsync({
          path: { id: sessionId },
          body: { parts, ...(model ? { model } : {}) },
        })
        void error
      }
      return done
    },
    interrupt: async () => {
      try {
        await client.session.abort({ path: { id: sessionId } })
      } catch {
        // Best effort: session may already be idle or gone.
      }
      settleTurn({ status: "interrupted", usage: { ...turnUsage } })
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      settleTurn({ status: "interrupted", usage: { ...turnUsage } })
      try {
        await client.session.abort({ path: { id: sessionId } })
      } catch {
        // Best effort.
      }
      if (child) {
        try {
          child.kill("SIGTERM")
          // Escalate if the server ignores SIGTERM; never hold the loop open.
          const killer = setTimeout(() => {
            try {
              child.kill("SIGKILL")
            } catch {
              // Already gone.
            }
          }, 3000)
          killer.unref?.()
        } catch {
          // Best effort.
        }
      }
      // The SSE consumer exits on its own once the connection drops; late
      // events are harmless (settle/emit guards).
      void sseTask
    },
  }
}
