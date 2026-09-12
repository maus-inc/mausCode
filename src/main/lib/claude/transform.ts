import type { MCPServer, MCPServerStatus, MessageMetadata, UIMessageChunk } from "./types"

/**
 * NOTE (transplant): `ChunkCoalescer`/`createChunkCoalescer` below, the
 * `providerMetadata` spread-casts, and the `?? "unknown"` tool-name guard were
 * transplanted from erenbertr/1code (Apache-2.0, © the 1Code contributors).
 */

export interface ClaudeContentBlock {
  type: "text" | "tool_use" | "thinking" | "tool_result" | string
  id?: string
  tool_use_id?: string
  name?: string
  text?: string
  thinking?: string
  input?: unknown
  content?: unknown
  is_error?: boolean
}

export interface ClaudeStreamMessage {
  type?: "stream_event" | "assistant" | "user" | "system" | "result" | string
  subtype?: "init" | "status" | "compact_boundary" | string
  parent_tool_use_id?: string | null
  session_id?: string
  total_cost_usd?: number
  status?: string
  tools?: unknown[]
  plugins?: unknown[]
  skills?: unknown[]
  mcp_servers?: {
    name: string
    status: string
    serverInfo?: {
      name: string
      version: string
      icons?: {
        src: string
        mimeType?: string
        sizes?: string[]
        theme?: "light" | "dark"
      }[]
    }
    error?: string
  }[]
  event?: {
    type?: string
    content_block?: ClaudeContentBlock
    delta?: {
      type?: string
      text?: string
      partial_json?: string
      thinking?: string
    }
  }
  message?: {
    usage?: {
      input_tokens?: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      output_tokens?: number
    }
    content?: ClaudeContentBlock[] | string
  }
  tool_use_result?: unknown
  usage?: {
    input_tokens?: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
    output_tokens?: number
  }
}

/**
 * Coalesces high-frequency consecutive `text-delta` chunks into fewer, larger
 * emits so the renderer receives far fewer IPC messages per second, without
 * changing the final rendered content.
 */
export interface ChunkCoalescer<TChunk = UIMessageChunk> {
  push: (chunk: TChunk) => boolean
  flush: () => boolean
  dispose: () => void
}

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
  let textId: string | null = null
  let textStarted = false
  let started = false
  let startTime: number | null = null

  let currentToolCallId: string | null = null
  let currentToolName: string | null = null
  let accumulatedToolInput = ""

  const emittedToolIds = new Set<string>()
  let lastTextId: string | null = null
  let currentParentToolUseId: string | null = null
  const toolIdMapping = new Map<string, string>()

  let lastCompactId: string | null = null
  let compactCounter = 0

  let currentThinkingId: string | null = null
  let accumulatedThinking = ""
  let inThinkingBlock = false
  let thinkingJsonStarted = false

  let lastMainAssistantUsage: {
    input_tokens: number
    cache_read_input_tokens: number
    cache_creation_input_tokens: number
    output_tokens: number
  } | null = null

  const makeCompositeId = (originalId: string, parentId: string | null): string => {
    if (parentId) return `${parentId}:${originalId}`
    return originalId
  }

  const genId = () => `text-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

  function* endTextBlock(): Generator<UIMessageChunk> {
    if (textStarted && textId) {
      yield { type: "text-end", id: textId }
      lastTextId = textId
      textStarted = false
      textId = null
    }
  }

  function* endToolInput(): Generator<UIMessageChunk> {
    if (currentToolCallId) {
      emittedToolIds.add(currentToolCallId)

      let parsedInput = {}
      if (accumulatedToolInput) {
        try {
          parsedInput = JSON.parse(accumulatedToolInput)
        } catch (e) {
          console.error(
            "[transform] Failed to parse tool input JSON:",
            (e as Error).message,
            "partial:",
            accumulatedToolInput.slice(0, 120),
          )
          parsedInput = { _raw: accumulatedToolInput, _parseError: true }
        }
      }

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

  return function* transform(msg: ClaudeStreamMessage): Generator<UIMessageChunk> {
    if (msg.parent_tool_use_id !== undefined) {
      currentParentToolUseId = msg.parent_tool_use_id
    }

    if (!started) {
      started = true
      startTime = Date.now()
      yield { type: "start" }
      yield { type: "start-step" }
    }

    if (msg.type === "stream_event" && msg.event?.type === "message_start") {
      currentThinkingId = null
      accumulatedThinking = ""
      inThinkingBlock = false
    }

    if (msg.type === "stream_event") {
      const event = msg.event
      if (!event) return

      if (event.type === "content_block_start" && event.content_block?.type === "text") {
        yield* endTextBlock()
        yield* endToolInput()
        textId = genId()
        yield { type: "text-start", id: textId }
        textStarted = true
      }

      if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
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

      if (event.type === "content_block_stop") {
        if (textStarted) {
          yield* endTextBlock()
        }
        if (currentToolCallId) {
          yield* endToolInput()
        }
      }

      if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
        yield* endTextBlock()
        yield* endToolInput()

        const originalId = event.content_block.id || genId()
        currentToolCallId = makeCompositeId(originalId, currentParentToolUseId)
        currentToolName = event.content_block.name || "unknown"
        accumulatedToolInput = ""

        toolIdMapping.set(originalId, currentToolCallId)

        yield {
          type: "tool-input-start",
          toolCallId: currentToolCallId,
          toolName: currentToolName ?? "unknown",
        }
      }

      if (event.delta?.type === "input_json_delta" && currentToolCallId) {
        const partialJson = event.delta.partial_json || ""
        accumulatedToolInput += partialJson

        yield {
          type: "tool-input-delta",
          toolCallId: currentToolCallId,
          inputTextDelta: partialJson,
        }
      }

      if (event.type === "content_block_start" && event.content_block?.type === "thinking") {
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

      if (event.delta?.type === "thinking_delta" && currentThinkingId && inThinkingBlock) {
        const thinkingText = String(event.delta.thinking || "")
        accumulatedThinking += thinkingText

        const escaped = JSON.stringify(thinkingText).slice(1, -1)
        const prefix = !thinkingJsonStarted ? '{"text":"' : ""
        thinkingJsonStarted = true

        yield {
          type: "tool-input-delta",
          toolCallId: currentThinkingId,
          inputTextDelta: prefix + escaped,
        }
      }

      if (event.type === "content_block_stop" && inThinkingBlock && currentThinkingId) {
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
        emittedToolIds.add(currentThinkingId)
        emittedToolIds.add("thinking-streamed")
        currentThinkingId = null
        accumulatedThinking = ""
        inThinkingBlock = false
      }
    }

    if (msg.type === "assistant" && msg.message?.usage && msg.parent_tool_use_id == null) {
      lastMainAssistantUsage = {
        input_tokens: msg.message.usage.input_tokens ?? 0,
        cache_read_input_tokens: msg.message.usage.cache_read_input_tokens ?? 0,
        cache_creation_input_tokens: msg.message.usage.cache_creation_input_tokens ?? 0,
        output_tokens: msg.message.usage.output_tokens ?? 0,
      }
    }

    if (msg.type === "assistant" && msg.message?.content) {
      const blocks = Array.isArray(msg.message.content) ? msg.message.content : []
      for (const block of blocks) {
        if (block.type === "thinking" && block.thinking) {
          const wasStreamed = emittedToolIds.has("thinking-streamed")
          const isCurrentlyStreaming = inThinkingBlock

          if (wasStreamed || isCurrentlyStreaming) {
            continue
          }

          const thinkingId = genId()
          yield {
            type: "tool-input-available",
            toolCallId: thinkingId,
            toolName: "Thinking",
            input: { text: block.thinking },
          }
          yield {
            type: "tool-output-available",
            toolCallId: thinkingId,
            output: { completed: true },
          }
        }

        if (block.type === "text" && block.text) {
          yield* endToolInput()

          if (!textStarted) {
            textId = genId()
            yield { type: "text-start", id: textId }
            yield { type: "text-delta", id: textId, delta: block.text }
            yield { type: "text-end", id: textId }
            lastTextId = textId
            textId = null
          }
        }

        if (block.type === "tool_use" && block.id) {
          yield* endTextBlock()
          yield* endToolInput()

          if (emittedToolIds.has(block.id)) {
            continue
          }

          emittedToolIds.add(block.id)

          const compositeId = makeCompositeId(block.id, currentParentToolUseId)

          toolIdMapping.set(block.id, compositeId)

          yield {
            type: "tool-input-available",
            toolCallId: compositeId,
            toolName: block.name || "unknown",
            input: block.input,
            ...{ providerMetadata: { custom: { startedAt: Date.now() } } },
          }
        }
      }
    }

    if (msg.type === "user" && msg.message?.content && Array.isArray(msg.message.content)) {
      for (const block of msg.message.content) {
        if (block.type === "tool_result" && block.tool_use_id) {
          const compositeId = toolIdMapping.get(block.tool_use_id) || block.tool_use_id

          if (block.is_error) {
            yield {
              type: "tool-output-error",
              toolCallId: compositeId,
              errorText: String(block.content),
            }
          } else {
            let output = msg.tool_use_result
            if (!output && typeof block.content === "string") {
              try {
                const parsed = JSON.parse(block.content)
                if (parsed && typeof parsed === "object") {
                  output = parsed
                }
              } catch {
                // Not JSON, use raw content
              }
            }
            output = output || block.content

            yield {
              type: "tool-output-available",
              toolCallId: compositeId,
              output,
            }
          }
        }
      }
    }

    if (msg.type === "system") {
      if (msg.subtype === "init") {
        const mcpServers: MCPServer[] = (msg.mcp_servers || []).map((s) => ({
          name: s.name,
          status: (["connected", "failed", "pending", "needs-auth"].includes(s.status)
            ? s.status
            : "pending") as MCPServerStatus,
          ...(s.serverInfo && { serverInfo: s.serverInfo }),
          ...(s.error && { error: s.error }),
        }))
        yield {
          type: "session-init",
          tools: (msg.tools as never) || [],
          mcpServers,
          plugins: (msg.plugins as never) || [],
          skills: (msg.skills as never) || [],
        }
      }

      if (msg.subtype === "status" && msg.status === "compacting") {
        lastCompactId = `compact-${Date.now()}-${compactCounter++}`
        yield {
          type: "tool-input-available",
          toolCallId: lastCompactId,
          toolName: "Compact",
          input: { status: "compacting" },
        }
      }

      if (msg.subtype === "compact_boundary") {
        let compactId = lastCompactId
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
        lastCompactId = null
      }
    }

    if (msg.type === "result") {
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
        finalTextId: lastTextId || undefined,
      }
      yield { type: "message-metadata", messageMetadata: metadata }
      yield { type: "finish-step" }
      yield { type: "finish", messageMetadata: metadata }
    }
  }
}
