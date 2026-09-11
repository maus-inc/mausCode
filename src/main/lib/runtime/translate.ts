/**
 * Native runtime event translation: harness `ApiEvent` -> `UIMessageChunk`.
 *
 * Pure module: no Electron, no I/O, no singletons. One `NativeTranslator`
 * instance serves one chat subscription (one user turn). Unknown event kinds
 * are ignored per protocol v1 forward-compatibility rules.
 *
 * Text-block framing: the harness emits bare `text_delta`s with no block ids,
 * so the translator synthesizes one text block per contiguous text run
 * (`txt-<turn>-<n>`), closing it on tool activity or turn end.
 */
import type { ApiEvent } from "@maus-inc/runtime-client"
import {
  NATIVE_ERROR_PREFIX,
  NATIVE_QUESTION_PREFIX,
  // Explicit extension: this module also runs under raw node --test.
} from "../../../shared/runtime-protocol.ts"
import type { UIMessageChunk } from "../claude/types"

export { NATIVE_ERROR_PREFIX, NATIVE_QUESTION_PREFIX }

function tryParseJson(raw: string): unknown {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

export class NativeTranslator {
  private turn = 0
  private textBlock = 0
  private textOpen = false
  private textId: string | null = null
  private readonly toolInputs = new Map<string, string>()

  /** Reset per-turn state. Called when a new user message starts streaming. */
  beginTurn(): UIMessageChunk[] {
    this.turn += 1
    this.textBlock = 0
    this.textOpen = false
    this.textId = null
    this.toolInputs.clear()
    return [{ type: "start" }, { type: "start-step" }]
  }

  translate(event: ApiEvent): UIMessageChunk[] {
    switch (event.ev) {
      case "text_delta":
        return this.translateTextDelta(event.text)
      case "reasoning_delta":
        return [
          { type: "reasoning-delta", id: `reas-${this.turn}`, delta: event.text },
        ]
      case "reasoning_done":
        return []
      case "tool_start": {
        const out = this.closeText()
        this.toolInputs.set(event.call_id, "")
        out.push({
          type: "tool-input-start",
          toolCallId: event.call_id,
          toolName: event.name,
        })
        return out
      }
      case "tool_input_delta": {
        const prev = this.toolInputs.get(event.call_id) ?? ""
        this.toolInputs.set(event.call_id, prev + event.delta)
        return [
          {
            type: "tool-input-delta",
            toolCallId: event.call_id,
            inputTextDelta: event.delta,
          },
        ]
      }
      case "tool_exec":
        return [
          {
            type: "tool-input-available",
            toolCallId: event.call_id,
            toolName: event.name,
            input: tryParseJson(this.toolInputs.get(event.call_id) ?? ""),
          },
        ]
      case "tool_done": {
        if (event.error) {
          return [
            { type: "tool-output-error", toolCallId: event.call_id, errorText: event.error },
          ]
        }
        return [
          { type: "tool-output-available", toolCallId: event.call_id, output: event.output },
        ]
      }
      case "token_usage":
        return [
          {
            type: "message-metadata",
            messageMetadata: {
              inputTokens: event.input,
              outputTokens: event.output,
              ...(event.cache_read_input !== undefined && {
                cacheReadInputTokens: event.cache_read_input,
              }),
            },
          },
        ]
      case "permission_request":
        return [
          {
            type: "ask-user-question",
            toolUseId: `${NATIVE_QUESTION_PREFIX}${event.request_id}`,
            questions: [
              {
                question: event.description,
                header: event.tool_name,
                options: [
                  { label: "Allow", description: `Allow ${event.tool_name} this time` },
                  { label: "Deny", description: `Deny ${event.tool_name}` },
                ],
                multiSelect: false,
              },
            ],
          },
        ]
      case "compacted": {
        // Reuse the legacy compacting indicator: it keys on toolName "Compact"
        // plus a `compact-` toolCallId prefix.
        const id = `compact-${Date.now()}`
        return [
          { type: "tool-input-start", toolCallId: id, toolName: "Compact" },
          { type: "tool-output-available", toolCallId: id, output: event.message },
        ]
      }
      case "turn_done": {
        const out = this.closeText()
        out.push({ type: "finish-step" })
        out.push({ type: "finish" })
        return out
      }
      case "error":
        return [
          {
            type: "error",
            errorText: `${NATIVE_ERROR_PREFIX}${event.code.toUpperCase()}: ${event.message}`,
          },
        ]
      // Session/meta/file events carry no chat-stream content in P1.
      case "message_accepted":
      case "session_status":
      case "connection_phase":
      case "session_renamed":
      case "credential_updated":
      case "model_info":
      case "models":
      case "runtime_info":
      case "history":
      case "attached":
      case "session_forked":
      case "sessions":
      case "file_content":
      case "files":
      case "text_matches":
      case "file_status":
      case "side_pane_images":
      case "wake_requested":
      case "background_progress":
      case "hello_ok":
      case "ok":
      case "pong":
        return []
      default:
        // Unknown kinds (protocol-minor additions) must never break the stream.
        return []
    }
  }

  private translateTextDelta(text: string): UIMessageChunk[] {
    if (!this.textOpen) {
      this.textBlock += 1
      this.textId = `txt-${this.turn}-${this.textBlock}`
      this.textOpen = true
      return [
        { type: "text-start", id: this.textId },
        { type: "text-delta", id: this.textId, delta: text },
      ]
    }
    return [{ type: "text-delta", id: this.textId as string, delta: text }]
  }

  private closeText(): UIMessageChunk[] {
    if (!this.textOpen || !this.textId) return []
    const id = this.textId
    this.textOpen = false
    this.textId = null
    return [{ type: "text-end", id }]
  }
}
