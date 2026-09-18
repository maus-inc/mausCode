import type {
  SDKAuthStatusMessage,
  SDKCompactBoundaryMessage,
  SDKFilesPersistedEvent,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKHookStartedMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKTaskNotificationMessage,
  SDKTaskStartedMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
} from "@anthropic-ai/claude-agent-sdk"

// AI SDK UIMessageChunk format
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
  | {
      type: "ask-user-question"
      toolUseId: string
      questions: Array<{
        question: string
        header: string
        options: Array<{ label: string; description: string }>
        multiSelect: boolean
      }>
    }
  | { type: "ask-user-question-timeout"; toolUseId: string }
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
 * locally (roadmap step 09).
 *
 * Provenance: the pinned `@anthropic-ai/claude-agent-sdk` 0.2.45 cannot type
 * this boundary itself. Its `sdk.d.ts` builds `SDKMessage` from 18 members but
 * never declares `SDKRateLimitEvent`, and the assistant/user/stream-event
 * payload types import `BetaMessage`, `BetaRawMessageStreamEvent` and
 * `MessageParam` from `@anthropic-ai/sdk`, which is not in the dependency
 * tree. Under `skipLibCheck` the top-level union therefore collapses to an
 * `any`-like type and those payload fields resolve to `any`. The local shapes
 * below mirror what the CLI actually emits; 13 member types that ARE sound in
 * the SDK are imported directly, and this file is the one place to revisit on
 * an SDK pin bump (roadmap step 12 owns that step).
 */

/** Anthropic content blocks as the CLI streams or persists them. */
export type ClaudeTextBlock = { type: "text"; text: string }
export type ClaudeThinkingBlock = { type: "thinking"; thinking: string; signature?: string }
export type ClaudeToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown }
export type ClaudeToolResultContentBlock = { type: "text"; text: string } | { type: "image" }
export type ClaudeToolResultBlock = {
  type: "tool_result"
  tool_use_id: string
  content: string | ClaudeToolResultContentBlock[]
  is_error?: boolean
}
export type ClaudeContentBlock = ClaudeTextBlock | ClaudeThinkingBlock | ClaudeToolUseBlock
export type ClaudeUserContentBlock = ClaudeContentBlock | ClaudeToolResultBlock

/** Usage fields the translator reads for per-turn context metrics. */
export type ClaudeUsage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens?: number
}

/**
 * Raw Anthropic streaming events the translator reads, as forwarded inside
 * `stream_event` messages. Members the translator never reads (for example
 * `message_delta`) are deliberately omitted.
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
    }
  | { type: "content_block_stop" }

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
 * The translator's message union: local shapes where the SDK resolves to
 * `any`, direct SDK imports where the SDK types are sound. Widened with the
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
  | SDKResultMessage
  | SDKStatusMessage
  | SDKCompactBoundaryMessage
  | SDKHookStartedMessage
  | SDKHookProgressMessage
  | SDKHookResponseMessage
  | SDKToolProgressMessage
  | SDKAuthStatusMessage
  | SDKTaskNotificationMessage
  | SDKTaskStartedMessage
  | SDKFilesPersistedEvent
  | SDKToolUseSummaryMessage
) & { readonly parent_tool_use_id?: string | null }
