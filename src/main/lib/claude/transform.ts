import type { SDKResultMessage } from "@anthropic-ai/claude-agent-sdk"
import type {
  ClaudeAssistantStreamMessage,
  ClaudeStreamApiEvent,
  ClaudeStreamEventMessage,
  ClaudeStreamMessage,
  ClaudeTextBlock,
  ClaudeThinkingBlock,
  ClaudeToolResultBlock,
  ClaudeToolUseBlock,
  ClaudeUserStreamMessage,
  MCPServer,
  MCPServerStatus,
  MessageMetadata,
  UIMessageChunk,
} from "./types"

/**
 * Message classification (roadmap step 09). Every member of
 * `ClaudeStreamMessage` is either translated (`HANDLED`) or deliberately
 * internal with a named reason (`INTERNAL`); the compile guards below fail
 * typecheck when the SDK grows a member that is neither.
 *
 * Internal members, by `msg.type`:
 * - `tool_progress`: per-tool streaming progress; the transcript already shows
 *   the tool round-trip, and no renderer surface consumes a second live feed.
 * - `auth_status`: auth state changes mid-turn; no consumer owns them yet.
 * - `tool_use_summary`: batch summaries of past tool use; the individual tool
 *   parts are already in the transcript.
 *
 * Internal `system` subtypes: `hook_started`, `hook_progress`,
 * `hook_response`, `task_notification`, `task_started`, `files_persisted`.
 * Each is harness bookkeeping with no chat-stream content and no named
 * consumer; the full table lives in
 * `.dump/app/research/2026-09-13-event-mapping.md`.
 */
export const HANDLED_STREAM_MESSAGE_TYPES = [
  "stream_event",
  "assistant",
  "user",
  "system",
  "result",
] as const satisfies readonly ClaudeStreamMessage["type"][]

export const INTERNAL_STREAM_MESSAGE_TYPES = [
  "tool_progress",
  "auth_status",
  "tool_use_summary",
] as const satisfies readonly ClaudeStreamMessage["type"][]

export const HANDLED_SYSTEM_SUBTYPES = [
  "init",
  "status",
  "compact_boundary",
] as const satisfies readonly Extract<ClaudeStreamMessage, { type: "system" }>["subtype"][]

export const INTERNAL_SYSTEM_SUBTYPES = [
  "hook_started",
  "hook_progress",
  "hook_response",
  "task_notification",
  "task_started",
  "files_persisted",
] as const satisfies readonly Extract<ClaudeStreamMessage, { type: "system" }>["subtype"][]

type AssertNever<T> = [T] extends [never] ? true : never

type UnhandledStreamMessageType = Exclude<
  ClaudeStreamMessage["type"],
  (typeof HANDLED_STREAM_MESSAGE_TYPES)[number] | (typeof INTERNAL_STREAM_MESSAGE_TYPES)[number]
>

/** Compile guard: every SDK message type is mapped or classified internal. */
export const streamMessageTypesAreClassified: AssertNever<UnhandledStreamMessageType> = true

type UnhandledSystemSubtype = Exclude<
  Extract<ClaudeStreamMessage, { type: "system" }>["subtype"],
  (typeof HANDLED_SYSTEM_SUBTYPES)[number] | (typeof INTERNAL_SYSTEM_SUBTYPES)[number]
>

/** Compile guard: every system subtype is mapped or classified internal. */
export const systemSubtypesAreClassified: AssertNever<UnhandledSystemSubtype> = true

const knownMessageTypes: ReadonlySet<string> = new Set([
  ...HANDLED_STREAM_MESSAGE_TYPES,
  ...INTERNAL_STREAM_MESSAGE_TYPES,
])

const knownSystemSubtypes: ReadonlySet<string> = new Set([
  ...HANDLED_SYSTEM_SUBTYPES,
  ...INTERNAL_SYSTEM_SUBTYPES,
])

function warnOnce(warned: Set<string>, key: string, label: string): void {
  if (warned.has(key)) return
  warned.add(key)
  // JSON-encoding bounds and escapes a provider-controlled string so a
  // hostile line cannot forge or pad log output.
  console.warn(`[transform] unmapped ${label}: ${JSON.stringify(key).slice(0, 80)}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Boundary read for provider stdout lines that reuse the Claude stream
 * dialect (the qwen print adapter). JSON arrives untyped, so the only honest
 * pre-check is the `type` discriminant; unknown types flow through and hit
 * the transformer's warn-once instead of being dropped here.
 */
export function toClaudeStreamMessage(raw: unknown): ClaudeStreamMessage | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null
  return raw as ClaudeStreamMessage
}

/** A failed tool result's text: structured content renders its text parts. */
function toolResultErrorText(content: ClaudeToolResultBlock["content"]): string {
  if (typeof content === "string") return content
  return content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n")
}

/** Resolve a tool result's output payload, preferring the CLI's own result. */
function resolveToolResultOutput(
  block: ClaudeToolResultBlock,
  msg: ClaudeUserStreamMessage,
): unknown {
  // An explicitly present tool_use_result wins even when falsy (false, 0, "");
  // only null/undefined fall through to the block content.
  if (msg.tool_use_result != null) return msg.tool_use_result
  if (typeof block.content === "string") {
    try {
      // Some tool results may have JSON embedded in the string
      const parsed = JSON.parse(block.content)
      if (parsed && typeof parsed === "object") {
        return parsed
      }
    } catch {
      // Not JSON, use raw content
    }
  }
  return block.content
}

/**
 * NOTE (transplant): `ChunkCoalescer`/`createChunkCoalescer` below, the
 * `providerMetadata` spread-casts, and the `?? "unknown"` tool-name guard were
 * transplanted from erenbertr/1code (Apache-2.0, © the 1Code contributors).
 */

/**
 * Coalesces high-frequency consecutive `text-delta` chunks into fewer, larger
 * emits so the renderer receives far fewer IPC messages per second, without
 * changing the final rendered content.
 *
 * Behavior:
 * - Consecutive `text-delta` chunks sharing the same `id` are buffered and
 *   concatenated, then flushed either after `flushIntervalMs` (a short time
 *   window) or as soon as a non-text-delta chunk (tool call, text-end, message
 *   boundary, etc.) arrives.
 * - Any non-text-delta chunk flushes the buffer FIRST to preserve ordering.
 * - A text-delta with a different `id`, or one carrying extra fields such as
 *   `providerMetadata`, flushes the buffer first and is emitted on its own so
 *   nothing is lost or reordered.
 * - `flush()` / `dispose()` drain the buffer immediately (stream end / abort)
 *   so the final content is never dropped.
 *
 * The merged emit is still a valid `text-delta` UIMessageChunk, so the chunk
 * schema consumed by the renderer is unchanged.
 */
export interface ChunkCoalescer<TChunk = UIMessageChunk> {
  /** Buffer or emit a chunk. Returns the underlying emit result (false = closed). */
  push: (chunk: TChunk) => boolean
  /** Emit any buffered text immediately. Returns the underlying emit result. */
  flush: () => boolean
  /** Flush and clear the pending timer (call on stream end / abort / unsubscribe). */
  dispose: () => void
}

// Generic over the chunk type so it works with both the local UIMessageChunk
// union (Claude) and the wider AI SDK chunk union (Codex). It only inspects the
// `type`/`id`/`delta`/`providerMetadata` fields and synthesizes a plain
// `text-delta`, so any chunk type carrying those fields is supported.
export function createChunkCoalescer<TChunk = UIMessageChunk>(
  rawEmit: (chunk: TChunk) => boolean,
  options?: { flushIntervalMs?: number },
): ChunkCoalescer<TChunk> {
  const flushIntervalMs = options?.flushIntervalMs ?? 40
  let bufferedId: string | null = null
  let bufferedText = ""
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastEmitOk = true

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const flush = (): boolean => {
    clearTimer()
    if (bufferedId !== null) {
      const id = bufferedId
      const delta = bufferedText
      bufferedId = null
      bufferedText = ""
      if (delta.length > 0) {
        lastEmitOk = rawEmit({ type: "text-delta", id, delta } as unknown as TChunk)
      }
    }
    return lastEmitOk
  }

  // Only coalesce "plain" text deltas. A delta carrying providerMetadata (or any
  // non-standard shape) is passed through untouched to avoid dropping metadata.
  const isPlainTextDelta = (chunk: unknown): boolean => {
    if (typeof chunk !== "object" || chunk === null) return false
    const view = chunk as { type?: unknown; id?: unknown; providerMetadata?: unknown }
    return (
      view.type === "text-delta" &&
      typeof view.id === "string" &&
      view.providerMetadata === undefined
    )
  }

  const push = (chunk: TChunk): boolean => {
    if (isPlainTextDelta(chunk)) {
      const { id, delta } = chunk as { id: string; delta: string }
      // Switching to a different text block: flush the previous one first so
      // ids and ordering stay correct.
      if (bufferedId !== null && bufferedId !== id) {
        flush()
      }
      bufferedId = id
      bufferedText += delta || ""
      if (timer === null) {
        timer = setTimeout(() => {
          timer = null
          flush()
        }, flushIntervalMs)
      }
      return lastEmitOk
    }

    // Any other chunk: flush buffered text first to preserve ordering, then emit.
    flush()
    lastEmitOk = rawEmit(chunk)
    return lastEmitOk
  }

  const dispose = () => {
    flush()
    clearTimer()
  }

  return { push, flush, dispose }
}

export function createTransformer(options?: { isUsingOllama?: boolean }) {
  const _isUsingOllama = options?.isUsingOllama === true
  // Unknown msg.type values (a newer CLI against this build) are logged once
  // per type per transformer instead of disappearing silently.
  const warnedMessageTypes = new Set<string>()
  let textId: string | null = null
  let textStarted = false
  let started = false
  let startTime: number | null = null

  // Track streaming tool calls
  let currentToolCallId: string | null = null
  let currentToolName: string | null = null
  let accumulatedToolInput = ""

  // Track already emitted tool IDs to avoid duplicates
  // (tools can come via streaming AND in the final assistant message)
  const emittedToolIds = new Set<string>()

  // Track the last text block ID for final response marking
  // This is used to identify when there's a "final text" response after tools
  let lastTextId: string | null = null

  // Track parent tool context for nested tools (e.g., Explore agent)
  let currentParentToolUseId: string | null = null

  // Map original toolCallId -> composite toolCallId (for tool-result matching)
  const toolIdMapping = new Map<string, string>()

  // Track compacting system tool for matching status->boundary events
  let lastCompactId: string | null = null
  let compactCounter = 0

  // Track streaming thinking for Extended Thinking
  let currentThinkingId: string | null = null
  let accumulatedThinking = ""
  let inThinkingBlock = false // Track if we're currently in a thinking block
  let thinkingJsonStarted = false // Track if we've sent the JSON prefix for thinking deltas

  // Track usage from the last main assistant message (exclude sidechain/subagents).
  // This is used for accurate context window display in final metadata.
  let lastMainAssistantUsage: {
    input_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
    output_tokens: number
  } | null = null

  // Helper to create composite toolCallId: "parentId:childId" or just "childId"
  const makeCompositeId = (originalId: string, parentId: string | null): string => {
    if (parentId) return `${parentId}:${originalId}`
    return originalId
  }

  const genId = () => `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  // Helper to end current text block
  function* endTextBlock(): Generator<UIMessageChunk> {
    if (textStarted && textId) {
      yield { type: "text-end", id: textId }
      // Track the last text ID for final response marking
      lastTextId = textId
      textStarted = false
      textId = null
    }
  }

  // Helper to end current tool input
  function* endToolInput(): Generator<UIMessageChunk> {
    if (currentToolCallId) {
      // Track this tool ID to avoid duplicates from assistant message
      emittedToolIds.add(currentToolCallId)

      let parsedInput = {}
      if (accumulatedToolInput) {
        try {
          parsedInput = JSON.parse(accumulatedToolInput)
        } catch (e) {
          // Stream may have been interrupted mid-JSON (e.g. network error, abort)
          // resulting in incomplete JSON like '{"prompt":"write co'
          console.error(
            "[transform] Failed to parse tool input JSON:",
            (e as Error).message,
            "partial:",
            accumulatedToolInput.slice(0, 120),
          )
          parsedInput = { _raw: accumulatedToolInput, _parseError: true }
        }
      }

      // Emit complete tool call with accumulated input
      // Cast needed: providerMetadata is used by the renderer for timing
      // but isn't part of the base UIMessageChunk type
      yield {
        type: "tool-input-available",
        toolCallId: currentToolCallId,
        toolName: currentToolName || "unknown",
        input: parsedInput,
        ...{ providerMetadata: { custom: { startedAt: Date.now() } } },
      }
      currentToolCallId = null
      currentToolName = null
      accumulatedToolInput = ""
    }
  }

  // ===== Per-message-type handlers (roadmap step 09 decomposition) =====
  // One generator per member of `ClaudeStreamMessage`, all sharing the
  // closure state above, so the dispatch below stays flat and each handler
  // owns one message shape.

  function trackAssistantUsage(msg: ClaudeAssistantStreamMessage): void {
    // Track per-turn usage from main assistant messages only.
    // Sidechain/subagent assistant messages have parent_tool_use_id set.
    if (msg.message?.usage && msg.parent_tool_use_id == null) {
      lastMainAssistantUsage = {
        input_tokens: msg.message.usage.input_tokens ?? 0,
        cache_read_input_tokens: msg.message.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: msg.message.usage.cache_creation_input_tokens ?? 0,
        output_tokens: msg.message.usage.output_tokens ?? 0,
      }
    }
  }

  function* handleStreamEvent(msg: ClaudeStreamEventMessage): Generator<UIMessageChunk> {
    const event = msg.event
    if (!event) return

    // Reset thinking state on new message start to prevent memory leaks
    if (event.type === "message_start") {
      currentThinkingId = null
      accumulatedThinking = ""
      inThinkingBlock = false
    }

    if (event.type === "content_block_start") yield* handleBlockStart(event)
    if (event.type === "content_block_delta") yield* handleBlockDelta(event)
    if (event.type === "content_block_stop") yield* handleBlockStop(event)
  }

  function* handleBlockStart(
    event: Extract<ClaudeStreamApiEvent, { type: "content_block_start" }>,
  ): Generator<UIMessageChunk> {
    // Text block start
    if (event.content_block?.type === "text") {
      yield* endTextBlock()
      yield* endToolInput()
      textId = genId()
      yield { type: "text-start", id: textId }
      textStarted = true
    }

    // Tool use start (streaming)
    if (event.content_block?.type === "tool_use") {
      yield* endTextBlock()
      yield* endToolInput()

      const originalId = event.content_block.id || genId()
      currentToolCallId = makeCompositeId(originalId, currentParentToolUseId)
      currentToolName = event.content_block.name || "unknown"
      accumulatedToolInput = ""

      // Store mapping for tool-result lookup
      toolIdMapping.set(originalId, currentToolCallId)

      // Emit tool-input-start for progressive UI
      yield {
        type: "tool-input-start",
        toolCallId: currentToolCallId,
        toolName: currentToolName ?? "unknown",
      }
    }

    // Thinking content block start (Extended Thinking)
    if (event.content_block?.type === "thinking") {
      currentThinkingId = `thinking-${Date.now()}`
      accumulatedThinking = ""
      inThinkingBlock = true
      thinkingJsonStarted = false
      yield {
        type: "tool-input-start",
        toolCallId: currentThinkingId,
        toolName: "Thinking",
      }
    }
  }

  function* handleBlockDelta(
    event: Extract<ClaudeStreamApiEvent, { type: "content_block_delta" }>,
  ): Generator<UIMessageChunk> {
    // Text delta
    if (event.delta?.type === "text_delta") {
      if (!textStarted) {
        yield* endToolInput()
        textId = genId()
        yield { type: "text-start", id: textId }
        textStarted = true
      }
      if (textId !== null) {
        yield { type: "text-delta", id: textId, delta: event.delta.text || "" }
      }
    }

    // Tool input delta
    if (event.delta?.type === "input_json_delta" && currentToolCallId) {
      const partialJson = event.delta.partial_json || ""
      accumulatedToolInput += partialJson

      // Emit tool-input-delta for progressive UI
      yield {
        type: "tool-input-delta",
        toolCallId: currentToolCallId,
        inputTextDelta: partialJson,
      }
    }

    // Thinking/reasoning streaming - emit as tool-like chunks for UI
    if (event.delta?.type === "thinking_delta" && currentThinkingId && inThinkingBlock) {
      const thinkingText = String(event.delta.thinking || "")
      accumulatedThinking += thinkingText

      // Emit as JSON fragment so AI SDK's parsePartialJson can parse it incrementally.
      // AI SDK accumulates all deltas and runs fixJson() to repair incomplete JSON,
      // so we start with '{"text":"' and send JSON-escaped text chunks.
      const escaped = JSON.stringify(thinkingText).slice(1, -1)
      const prefix = !thinkingJsonStarted ? '{"text":"' : ""
      thinkingJsonStarted = true

      yield {
        type: "tool-input-delta",
        toolCallId: currentThinkingId,
        inputTextDelta: prefix + escaped,
      }
    }
  }

  function* handleBlockStop(
    _event: Extract<ClaudeStreamApiEvent, { type: "content_block_stop" }>,
  ): Generator<UIMessageChunk> {
    if (textStarted) {
      yield* endTextBlock()
    }
    if (currentToolCallId) {
      yield* endToolInput()
    }

    // Thinking complete (content_block_stop while in thinking block)
    if (inThinkingBlock && currentThinkingId) {
      yield {
        type: "tool-input-available",
        toolCallId: currentThinkingId,
        toolName: "Thinking",
        input: { text: accumulatedThinking },
      }
      yield {
        type: "tool-output-available",
        toolCallId: currentThinkingId,
        output: { completed: true },
      }
      // Track as emitted to skip duplicate from assistant message
      emittedToolIds.add(currentThinkingId)
      emittedToolIds.add("thinking-streamed")
      currentThinkingId = null
      accumulatedThinking = ""
      inThinkingBlock = false
    }
  }

  function* emitAssistantThinking(block: ClaudeThinkingBlock): Generator<UIMessageChunk> {
    // Check if we already streamed OR are currently streaming this thinking block.
    // The assistant message can arrive BEFORE content_block_stop, so we also
    // check inThinkingBlock.
    if (emittedToolIds.has("thinking-streamed") || inThinkingBlock) return

    const thinkingId = genId()
    yield {
      type: "tool-input-available",
      toolCallId: thinkingId,
      toolName: "Thinking",
      input: { text: block.thinking },
    }
    // Immediately mark as complete
    yield {
      type: "tool-output-available",
      toolCallId: thinkingId,
      output: { completed: true },
    }
  }

  function* emitAssistantText(block: ClaudeTextBlock): Generator<UIMessageChunk> {
    yield* endToolInput()

    // Only emit text if we're NOT already streaming (textStarted = false)
    // When includePartialMessages is true, text comes via stream_event
    if (!textStarted) {
      textId = genId()
      yield { type: "text-start", id: textId }
      yield { type: "text-delta", id: textId, delta: block.text }
      yield { type: "text-end", id: textId }
      lastTextId = textId
      textId = null
    }
  }

  function* emitAssistantToolUse(block: ClaudeToolUseBlock): Generator<UIMessageChunk> {
    yield* endTextBlock()
    yield* endToolInput()

    const compositeId = makeCompositeId(block.id, currentParentToolUseId)

    // Skip if already emitted via streaming. Streamed tools are deduped
    // under their composite id (endToolInput records that one), so both
    // forms must be checked or a nested tool repeated in the final
    // assistant message emits twice.
    if (emittedToolIds.has(block.id) || emittedToolIds.has(compositeId)) return

    emittedToolIds.add(block.id)
    emittedToolIds.add(compositeId)

    // Store mapping for tool-result lookup
    toolIdMapping.set(block.id, compositeId)

    // providerMetadata carries renderer timing (startedAt) outside the base chunk shape.
    yield {
      type: "tool-input-available",
      toolCallId: compositeId,
      toolName: block.name,
      input: block.input,
      ...{ providerMetadata: { custom: { startedAt: Date.now() } } },
    }
  }

  function* handleAssistantMessage(msg: ClaudeAssistantStreamMessage): Generator<UIMessageChunk> {
    // ===== ASSISTANT MESSAGE (complete, often with tool_use) =====
    // When streaming is enabled, text arrives via stream_event, not here
    const content = msg.message?.content
    if (!content) return
    for (const block of content) {
      // Handle thinking blocks from Extended Thinking
      // Skip if already emitted via streaming (thinking_delta)
      if (block.type === "thinking") {
        yield* emitAssistantThinking(block)
      }

      if (block.type === "text") {
        yield* emitAssistantText(block)
      }

      if (block.type === "tool_use") {
        yield* emitAssistantToolUse(block)
      }
    }
  }

  function* handleUserMessage(msg: ClaudeUserStreamMessage): Generator<UIMessageChunk> {
    // ===== USER MESSAGE (tool results) =====
    const content = msg.message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (block.type === "tool_result") {
        // Lookup composite ID from mapping, fallback to original
        const compositeId = toolIdMapping.get(block.tool_use_id) || block.tool_use_id

        if (block.is_error) {
          yield {
            type: "tool-output-error",
            toolCallId: compositeId,
            errorText: toolResultErrorText(block.content),
          }
        } else {
          yield {
            type: "tool-output-available",
            toolCallId: compositeId,
            output: resolveToolResultOutput(block, msg),
          }
        }
      }
    }
  }

  function* handleSystemMessage(
    msg: Extract<ClaudeStreamMessage, { type: "system" }>,
  ): Generator<UIMessageChunk> {
    // ===== SYSTEM STATUS (compacting, etc.) =====
    // Session init - extract MCP servers, plugins, tools
    if (msg.subtype === "init") {
      // Map MCP servers with validated status type and additional info
      const mcpServers: MCPServer[] = (msg.mcp_servers || []).map(
        (s): MCPServer => ({
          name: s.name,
          status: (["connected", "failed", "pending", "needs-auth"].includes(s.status)
            ? s.status
            : "pending") as MCPServerStatus,
          ...(s.serverInfo && { serverInfo: s.serverInfo }),
          ...(s.error && { error: s.error }),
        }),
      )
      yield {
        type: "session-init",
        tools: msg.tools || [],
        mcpServers,
        plugins: msg.plugins || [],
        skills: msg.skills || [],
      }
    }

    // Compacting status - expose as a tool so it becomes a UI message part
    if (msg.subtype === "status" && msg.status === "compacting") {
      // Create unique ID and save for matching with boundary event
      lastCompactId = `compact-${Date.now()}-${compactCounter++}`
      yield {
        type: "tool-input-available",
        toolCallId: lastCompactId,
        toolName: "Compact",
        input: { status: "compacting" },
      }
    }

    // Compact boundary - mark the compacting tool as complete
    if (msg.subtype === "compact_boundary") {
      let compactId = lastCompactId
      // If we didn't receive a compacting status, create a tool invocation now
      if (!compactId) {
        compactId = `compact-${Date.now()}-${compactCounter++}`
        yield {
          type: "tool-input-available",
          toolCallId: compactId,
          toolName: "Compact",
          input: { status: "compacting" },
        }
      }
      yield {
        type: "tool-output-available",
        toolCallId: compactId,
        output: { status: "compacted" },
      }
      lastCompactId = null // Clear for next compacting cycle
    }
  }

  function* handleResultMessage(msg: SDKResultMessage): Generator<UIMessageChunk> {
    // ===== RESULT (final) =====
    currentParentToolUseId = null
    yield* endTextBlock()
    yield* endToolInput()

    const resultOutputTokens = msg.usage?.output_tokens
    const fallbackUsage = {
      input_tokens: msg.usage?.input_tokens ?? 0,
      cache_read_input_tokens: msg.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: msg.usage?.cache_creation_input_tokens ?? 0,
      output_tokens: resultOutputTokens ?? 0,
    }

    // Prefer the last main assistant usage snapshot for context metrics.
    // Fallback to result usage when assistant usage is unavailable.
    const usage = lastMainAssistantUsage ?? fallbackUsage

    const resolvedInputTokens = usage.input_tokens
    const resolvedOutputTokens = resultOutputTokens ?? usage.output_tokens
    const metadata: MessageMetadata = {
      sessionId: msg.session_id,
      inputTokens: resolvedInputTokens,
      cacheReadInputTokens: usage.cache_read_input_tokens,
      cacheCreationInputTokens: usage.cache_creation_input_tokens,
      outputTokens: resolvedOutputTokens,
      totalTokens:
        resolvedInputTokens != null && resolvedOutputTokens != null
          ? resolvedInputTokens + resolvedOutputTokens
          : undefined,
      totalCostUsd: msg.total_cost_usd,
      durationMs: startTime ? Date.now() - startTime : undefined,
      resultSubtype: msg.subtype || "success",
      // Include finalTextId for collapsing tools when there's a final response
      finalTextId: lastTextId || undefined,
    }
    yield { type: "message-metadata", messageMetadata: metadata }
    yield { type: "finish-step" }
    yield { type: "finish", messageMetadata: metadata }
  }

  return function* transform(msg: ClaudeStreamMessage): Generator<UIMessageChunk> {
    // Track parent_tool_use_id for nested tools. Every envelope member of the
    // Claude dialect carries the field (null at top level), so an omitted
    // value resets to top-level rather than retaining a stale parent;
    // producers that always send it are unaffected.
    currentParentToolUseId = msg.parent_tool_use_id ?? null

    // Emit start once
    if (!started) {
      started = true
      startTime = Date.now()
      yield { type: "start" }
      yield { type: "start-step" }
    }

    switch (msg.type) {
      case "stream_event":
        yield* handleStreamEvent(msg)
        break
      case "assistant":
        trackAssistantUsage(msg)
        yield* handleAssistantMessage(msg)
        break
      case "user":
        yield* handleUserMessage(msg)
        break
      case "system":
        yield* handleSystemMessage(msg)
        break
      case "result":
        yield* handleResultMessage(msg)
        break
      default:
        break
    }

    // A type or subtype outside the classified sets means the CLI is newer
    // than this build's types. Never fatal, never silent; the composite key
    // keeps each system subtype's warning to once.
    if (!knownMessageTypes.has(msg.type)) {
      warnOnce(warnedMessageTypes, msg.type, "SDK message type")
    }
    if (msg.type === "system" && !knownSystemSubtypes.has(msg.subtype)) {
      warnOnce(warnedMessageTypes, `system:${msg.subtype}`, "SDK system subtype")
    }
  }
}
