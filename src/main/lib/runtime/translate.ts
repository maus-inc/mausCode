/**
 * Native runtime event translation: harness `ApiEvent` -> `UIMessageChunk`
 * and/or `HarnessRunEvent`.
 *
 * Pure module: no Electron, no I/O, no singletons. One `NativeTranslator`
 * instance serves one chat subscription (one user turn). Unknown event kinds
 * stay chunk-silent per protocol v1 forward-compatibility rules, but are
 * logged once per kind so an unmapped event never disappears without a trace
 * (roadmap step 09).
 *
 * Text-block framing: the harness emits bare `text_delta`s with no block ids,
 * so the translator synthesizes one text block per contiguous text run
 * (`txt-<turn>-<n>`), closing it on tool activity or turn end.
 */
import { type AnyApiEvent, isKnownEvent } from "@maus-inc/runtime-client"
import type { HarnessRunEvent } from "../../../shared/run-state.ts"
import {
  NATIVE_ERROR_PREFIX,
  NATIVE_QUESTION_PREFIX,
  // Explicit extension: this module also runs under raw node --test.
} from "../../../shared/runtime-protocol.ts"
import type { UIMessageChunk } from "../claude/types"

export { NATIVE_ERROR_PREFIX, NATIVE_QUESTION_PREFIX }

/** Distinct unmapped kinds one translator remembers; warns stay once per kind. */
const MAX_UNMAPPED_KINDS = 50

/** What one harness event turns into: chat chunks and/or run-record events. */
export interface NativeTurnTranslation {
  chunks: UIMessageChunk[]
  runEvents: HarnessRunEvent[]
}

function emptyTranslation(): NativeTurnTranslation {
  return { chunks: [], runEvents: [] }
}

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
  private readonly unmappedKinds = new Set<string>()

  /** Reset per-turn state. Called when a new user message starts streaming. */
  beginTurn(): UIMessageChunk[] {
    this.turn += 1
    this.textBlock = 0
    this.textOpen = false
    this.textId = null
    this.toolInputs.clear()
    return [{ type: "start" }, { type: "start-step" }]
  }

  translate(event: AnyApiEvent): NativeTurnTranslation {
    const kind = event.ev
    if (!isKnownEvent(event)) {
      this.warnUnmapped(kind)
      return emptyTranslation()
    }
    switch (event.ev) {
      case "text_delta":
        return { chunks: this.translateTextDelta(event.text), runEvents: [] }
      case "reasoning_delta":
        return {
          chunks: [{ type: "reasoning-delta", id: `reas-${this.turn}`, delta: event.text }],
          runEvents: [],
        }
      case "reasoning_done":
        return emptyTranslation()
      case "tool_start": {
        const out = this.closeText()
        this.toolInputs.set(event.call_id, "")
        out.push({
          type: "tool-input-start",
          toolCallId: event.call_id,
          toolName: event.name,
        })
        return { chunks: out, runEvents: [] }
      }
      case "tool_input_delta": {
        const prev = this.toolInputs.get(event.call_id) ?? ""
        this.toolInputs.set(event.call_id, prev + event.delta)
        return {
          chunks: [
            {
              type: "tool-input-delta",
              toolCallId: event.call_id,
              inputTextDelta: event.delta,
            },
          ],
          runEvents: [],
        }
      }
      case "tool_exec":
        return {
          chunks: [
            {
              type: "tool-input-available",
              toolCallId: event.call_id,
              toolName: event.name,
              input: tryParseJson(this.toolInputs.get(event.call_id) ?? ""),
            },
          ],
          runEvents: [],
        }
      case "tool_done": {
        if (event.error) {
          return {
            chunks: [
              { type: "tool-output-error", toolCallId: event.call_id, errorText: event.error },
            ],
            runEvents: [],
          }
        }
        return {
          chunks: [
            { type: "tool-output-available", toolCallId: event.call_id, output: event.output },
          ],
          runEvents: [],
        }
      }
      case "token_usage":
        return {
          chunks: [
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
          ],
          runEvents: [],
        }
      case "permission_request":
        return {
          chunks: [
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
          ],
          runEvents: [],
        }
      case "compacted": {
        // Reuse the legacy compacting indicator: it keys on toolName "Compact"
        // plus a `compact-` toolCallId prefix. The chunk observer turns that
        // tool round-trip into the `compacted` run event, so both engines
        // record compaction through one code path.
        const id = `compact-${Date.now()}`
        return {
          chunks: [
            { type: "tool-input-start", toolCallId: id, toolName: "Compact" },
            { type: "tool-output-available", toolCallId: id, output: event.message },
          ],
          runEvents: [],
        }
      }
      case "turn_done": {
        const out = this.closeText()
        out.push({ type: "finish-step" })
        out.push({ type: "finish" })
        return { chunks: out, runEvents: [] }
      }
      case "error":
        return {
          chunks: [
            {
              type: "error",
              errorText: `${NATIVE_ERROR_PREFIX}${event.code.toUpperCase()}: ${event.message}`,
            },
          ],
          runEvents: [],
        }
      case "session_status":
        return {
          chunks: [],
          runEvents: [
            {
              kind: "session_status",
              payload: { session_id: event.session_id, status: event.status },
            },
          ],
        }
      case "background_progress":
        return {
          chunks: [],
          runEvents: [
            {
              kind: "background_progress",
              payload: {
                session_id: event.session_id,
                task_id: event.task_id,
                label: event.label,
                percent: event.percent,
                summary: event.summary,
                done: event.done,
              },
            },
          ],
        }
      case "wake_requested":
        return {
          chunks: [],
          runEvents: [
            {
              kind: "wake_requested",
              payload: {
                session_id: event.session_id,
                reason: event.reason,
                notification: event.notification,
              },
            },
          ],
        }
      // Session/meta/file events carry no chat-stream content and no named
      // run-record consumer (see .dump/app/research/2026-09-13-event-mapping.md).
      case "message_accepted":
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
      case "hello_ok":
      case "ok":
      case "pong":
        return emptyTranslation()
      default:
        // A kind the client knows but this mapper does not (a protocol minor
        // newer than this build): same warn-once contract, never fatal.
        this.warnUnmapped(kind)
        return emptyTranslation()
    }
  }

  private warnUnmapped(kind: string): void {
    // Bounded memory: past the cap, extra unknown kinds stay silent instead
    // of growing the set for the rest of the turn.
    if (this.unmappedKinds.has(kind) || this.unmappedKinds.size >= MAX_UNMAPPED_KINDS) return
    this.unmappedKinds.add(kind)
    console.warn(`[runtime] unmapped harness event kind: ${JSON.stringify(kind).slice(0, 80)}`)
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
