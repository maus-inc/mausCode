import type {
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk"

// AI SDK UIMessageChunk format
/**
 * One question on an in-chat approval card.
 *
 * The permission gate's ask tier and the AskUserQuestion tool both produce
 * these, so the shape lives here rather than being spelled out twice in the
 * router and once in the renderer.
 */
export interface ToolApprovalQuestion {
  question: string
  header: string
  options: Array<{ label: string; description: string }>
  multiSelect: boolean
}

export type UIMessageChunk =
  // Message lifecycle
  | { type: "start"; messageId?: string }
  | { type: "finish"; messageMetadata?: MessageMetadata }
  | { type: "start-step" }
  | { type: "finish-step" }
  // Text streaming
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  // Reasoning (Extended Thinking)
  | { type: "reasoning"; id: string; text: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  // Tool calls
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; inputTextDelta: string }
  | {
      type: "tool-input-available"
      toolCallId: string
      toolName: string
      input: unknown
      providerMetadata?: unknown
    }
  | { type: "tool-output-available"; toolCallId: string; output: unknown }
  | { type: "tool-output-error"; toolCallId: string; errorText: string }
  // Error & metadata
  | { type: "error"; errorText: string }
  | { type: "auth-error"; errorText: string }
  | { type: "retry-notification"; message: string }
  | { type: "prompt-suggestion"; suggestion: string; sessionId: string }
  | { type: "ask-user-question"; toolUseId: string; questions: ToolApprovalQuestion[] }
  | { type: "ask-user-question-timeout"; toolUseId: string }
  | { type: "ask-user-question-result"; toolUseId: string; result: unknown }
  | { type: "message-metadata"; messageMetadata: MessageMetadata }
  // Session initialization (MCP servers, plugins, tools)
  | {
      type: "session-init"
      tools: string[]
      mcpServers: MCPServer[]
      plugins: { name: string; path: string }[]
      skills: string[]
      /**
       * Native engine only: the v1 harness exposes no tool list, so `tools`
       * carries only cached `mcp__server__tool` names and the full list is
       * unknown. Absent/false on legacy (complete list).
       */
      toolsUnknown?: boolean
      /** Native engine only: unparseable MCP config files (daemon ignores them). */
      mcpConfigErrors?: { file: string; error: string }[]
    }

export type MCPServerStatus = "connected" | "failed" | "pending" | "needs-auth"

export type MCPServerIcon = {
  src: string
  mimeType?: string
  sizes?: string[]
  theme?: "light" | "dark"
}

export type MCPServer = {
  name: string
  status: MCPServerStatus
  serverInfo?: {
    name: string
    version: string
    icons?: MCPServerIcon[]
  }
  error?: string
}

export type MessageMetadata = {
  sessionId?: string
  sdkMessageUuid?: string // SDK's message UUID for resumeSessionAt (rollback support)
  inputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  outputTokens?: number
  totalTokens?: number
  totalCostUsd?: number
  durationMs?: number
  resultSubtype?: string
  finalTextId?: string
}

/**
 * The stream messages and content blocks the translator consumes, declared
 * locally (roadmap step 09) and reconciled with the pinned SDK (step 12).
 *
 * Provenance: at 0.2.45 the SDK could not type this boundary itself. Its
 * `sdk.d.ts` built `SDKMessage` from 18 members but never declared
 * `SDKRateLimitEvent`, and the assistant, user and stream-event payload types
 * imported `BetaMessage`, `BetaRawMessageStreamEvent` and `MessageParam` from
 * `@anthropic-ai/sdk`, which was not in the dependency tree, so under
 * `skipLibCheck` those fields resolved to `any` and the local shapes below were
 * the only real contract.
 *
 * At 0.3.270 `@anthropic-ai/sdk` is a dependency, all 39 members are declared,
 * and those payload types resolve. The local shapes stay, because they are what
 * a fixture has to spell and what the translator is allowed to read, but they
 * are no longer guesses: each one is derived from the SDK type it mirrors and
 * kept a supertype of it, so a payload the SDK types still satisfies the read
 * contract and a field the translator reads but the SDK stopped declaring is a
 * compile error rather than an `undefined` in the transcript.
 * `SDKSystemMessage` is still mirrored field by field, because its
 * `mcp_servers` entry stops at `{name, status}` while the CLI also sends
 * `serverInfo` and `error`, and the translator renders both.
 */

/**
 * The block names the translator reads. Every other block the pinned SDK can
 * send stays in the unions below unread, which is what keeps a local shape
 * narrow enough for a fixture and wide enough for the wire.
 */
type ReadBlockType = "text" | "thinking" | "tool_use" | "tool_result"

/** Anthropic's own block unions, reached through the SDK types that carry them
 * so this file does not import a package the app does not depend on directly. */
type SdkAssistantBlock = SDKAssistantMessage["message"]["content"][number]
type SdkUserBlock = Extract<SDKUserMessage["message"]["content"], readonly unknown[]>[number]
type SdkStreamEvent = SDKPartialAssistantMessage["event"]
type SdkStreamBlock = Extract<SdkStreamEvent, { type: "content_block_start" }>["content_block"]
type SdkStreamDelta = Extract<SdkStreamEvent, { type: "content_block_delta" }>["delta"]

/** Anthropic content blocks as the CLI streams or persists them. */
export type ClaudeTextBlock = { type: "text"; text: string }
export type ClaudeThinkingBlock = { type: "thinking"; thinking: string; signature?: string }
export type ClaudeToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown }
/**
 * What a tool result's content array can hold. The translator renders the text
 * parts and names the rest, so the two read shapes stay explicit and the blocks
 * it does not read (a document, a search result, a browser state) stay in the
 * union through the SDK's own type.
 */
type SdkToolResultBlock = Extract<SdkUserBlock | SdkAssistantBlock, { type: "tool_result" }>
type SdkToolResultContentBlock = Extract<
  NonNullable<SdkToolResultBlock["content"]>,
  readonly unknown[]
>[number]
export type ClaudeToolResultContentBlock =
  | { type: "text"; text: string }
  | { type: "image" }
  | Exclude<SdkToolResultContentBlock, { type: "text" | "image" }>
export type ClaudeToolResultBlock = {
  type: "tool_result"
  tool_use_id: string
  /** Optional, because the SDK's own tool result block allows it to be absent. */
  content?: string | ClaudeToolResultContentBlock[]
  is_error?: boolean
}
export type ClaudeContentBlock =
  | ClaudeTextBlock
  | ClaudeThinkingBlock
  | ClaudeToolUseBlock
  | Exclude<SdkAssistantBlock | SdkStreamBlock, { type: ReadBlockType }>
export type ClaudeUserContentBlock =
  | ClaudeContentBlock
  | ClaudeToolResultBlock
  | Exclude<SdkUserBlock, { type: ReadBlockType }>

/**
 * Usage fields the translator reads for per-turn context metrics. Nullable
 * because the pinned SDK reports `null` for a cache tier that did not apply,
 * and a null that lands in an arithmetic expression is a NaN in the context
 * indicator rather than a missing number.
 */
export type ClaudeUsage = {
  input_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  output_tokens?: number | null
}

/**
 * Raw Anthropic streaming events the translator reads, as forwarded inside
 * `stream_event` messages. Members the translator never reads (for example
 * `message_delta`) stay in the union through the SDK's own event type, so the
 * discriminated switch in the translator keeps exactly one member per name.
 */
export type ClaudeStreamApiEvent =
  | { type: "message_start" }
  | { type: "content_block_start"; content_block?: ClaudeContentBlock }
  | {
      type: "content_block_delta"
      delta?:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: "thinking_delta"; thinking: string }
        | Exclude<SdkStreamDelta, { type: "text_delta" | "input_json_delta" | "thinking_delta" }>
    }
  | { type: "content_block_stop" }
  | Exclude<
      SdkStreamEvent,
      {
        type: "message_start" | "content_block_start" | "content_block_delta" | "content_block_stop"
      }
    >

export type ClaudeAssistantStreamMessage = {
  type: "assistant"
  message: { content: ClaudeContentBlock[]; usage?: ClaudeUsage }
  parent_tool_use_id?: string | null
}

export type ClaudeUserStreamMessage = {
  type: "user"
  message: { content: string | ClaudeUserContentBlock[] }
  parent_tool_use_id?: string | null
  tool_use_result?: unknown
}

export type ClaudeStreamEventMessage = {
  type: "stream_event"
  event?: ClaudeStreamApiEvent
  parent_tool_use_id?: string | null
}

/**
 * The CLI's system/init payload. `SDKSystemMessage` is sound in the SDK, but
 * its `mcp_servers` entry stops at `{name, status}` while the CLI also sends
 * `serverInfo` and `error`, and the translator renders both.
 */
export type ClaudeSystemInitMessage = {
  type: "system"
  subtype: "init"
  tools: string[]
  mcp_servers: Array<{
    name: string
    status: string
    serverInfo?: { name: string; version: string; icons?: MCPServerIcon[] }
    error?: string
  }>
  plugins: { name: string; path: string }[]
  skills: string[]
  parent_tool_use_id?: string | null
}

/**
 * The translator's message union: local read contracts for the four shapes the
 * translator pulls fields out of, and the rest of the SDK's members by
 * exclusion. Widened with the
 * nested-tool marker (`parent_tool_use_id`) on every member, because the
 * translator reads it before narrowing. Typing the translator against this
 * makes a CLI/SDK message-shape change a compile error at the read site
 * rather than an `undefined` in the transcript.
 */
export type ClaudeStreamMessage = (
  | ClaudeAssistantStreamMessage
  | ClaudeUserStreamMessage
  | ClaudeStreamEventMessage
  | ClaudeSystemInitMessage
  // Every other member the pinned SDK declares, by exclusion rather than by
  // hand: a release that adds one joins this union on the bump and fails the
  // classification guards in `transform.ts` until someone decides what it means.
  | Exclude<
      SDKMessage,
      | { type: "assistant" }
      | { type: "user" }
      | { type: "stream_event" }
      | { type: "system"; subtype: "init" }
    >
) & { readonly parent_tool_use_id?: string | null }
