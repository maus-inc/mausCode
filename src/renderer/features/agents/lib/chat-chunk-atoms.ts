/**
 * Shared stream-chunk -> atom helpers for chat transports.
 *
 * Extracted from the Claude IPC transport so the native runtime transport
 * reuses identical question/compacting/prompt-extraction behavior. Chunk
 * handling that is provider-specific (session-init, auth modals, error
 * toasts) stays in each transport.
 */
import type { ChatTransport, UIMessageChunk as SDKUIMessageChunk, UIMessage } from "ai"
import type { UIMessageChunk as WireUIMessageChunk } from "../../../../main/lib/claude/types"
import type { SessionInfo } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import {
  askUserQuestionResultsAtom,
  compactingSubChatsAtom,
  expiredUserQuestionsAtom,
  type PendingUserQuestion,
  pendingUserQuestionsAtom,
} from "../atoms"

/**
 * Wire chunks the backends emit beyond their declared types (sent via
 * `as unknown as UIMessageChunk` on the main side): the question-result
 * lifecycle chunk, plus `debugInfo`-carrying errors. Read `debugInfo` via
 * `"debugInfo" in chunk` since the other `error` members lack it.
 */
export type CustomStreamChunk =
  | { type: "ask-user-question-result"; toolUseId: string; result: unknown }
  | { type: "error"; errorText?: string; debugInfo?: { category?: string } }

/**
 * Chunks seen by transports on wire-format subscription backends (Claude and
 * native runtime emit the `main/lib/claude/types` wire type; Gemini and
 * OpenRouter emit AI SDK chunks; all may carry the custom chunks above).
 */
export type SubscriptionChunk = WireUIMessageChunk | SDKUIMessageChunk | CustomStreamChunk

/**
 * Chunks seen by transports on print-CLI backends (CursorPrintChunk and
 * siblings: `{ type: string; ...all-optional; [key]: unknown }`). Consumed
 * fields are declared; everything else stays behind the index signature.
 */
export type PrintChunk = {
  type: string
  errorText?: string
  message?: string
  tools?: SessionInfo["tools"]
  mcpServers?: SessionInfo["mcpServers"]
  plugins?: SessionInfo["plugins"]
  skills?: SessionInfo["skills"]
  toolUseId?: string
  toolName?: string
  toolCallId?: string
  questions?: PendingUserQuestion["questions"]
  result?: unknown
  debugInfo?: { category?: string }
  [key: string]: unknown
}

/**
 * Loose view of a UIMessage part for prompt extraction. Covers the SDK
 * members plus the app's custom `file-content` parts and `data-image` parts.
 */
export type LooseUIPart = {
  type?: string
  text?: string
  filePath?: string
  content?: string
  data?: { base64Data?: string; mediaType?: string; filename?: string }
}

export interface ChatChunkContext {
  subChatId: string
  chatId: string
}

/** Track AskUserQuestion lifecycle (pending -> expired/result) in atoms. */
export function applyQuestionChunks(chunk: SubscriptionChunk, ctx: ChatChunkContext): void {
  // Handle AskUserQuestion - show question UI
  if (chunk.type === "ask-user-question") {
    const currentMap = appStore.get(pendingUserQuestionsAtom)
    const newMap = new Map(currentMap)
    newMap.set(ctx.subChatId, {
      subChatId: ctx.subChatId,
      parentChatId: ctx.chatId,
      toolUseId: chunk.toolUseId,
      questions: chunk.questions,
    })
    appStore.set(pendingUserQuestionsAtom, newMap)

    // Clear any expired question (new question replaces it)
    const currentExpired = appStore.get(expiredUserQuestionsAtom)
    if (currentExpired.has(ctx.subChatId)) {
      const newExpiredMap = new Map(currentExpired)
      newExpiredMap.delete(ctx.subChatId)
      appStore.set(expiredUserQuestionsAtom, newExpiredMap)
    }
  }

  // Handle AskUserQuestion timeout - move to expired (keep UI visible)
  if (chunk.type === "ask-user-question-timeout") {
    const currentMap = appStore.get(pendingUserQuestionsAtom)
    const pending = currentMap.get(ctx.subChatId)
    if (pending && pending.toolUseId === chunk.toolUseId) {
      // Remove from pending
      const newPendingMap = new Map(currentMap)
      newPendingMap.delete(ctx.subChatId)
      appStore.set(pendingUserQuestionsAtom, newPendingMap)

      // Move to expired (so UI keeps showing the question)
      const currentExpired = appStore.get(expiredUserQuestionsAtom)
      const newExpiredMap = new Map(currentExpired)
      newExpiredMap.set(ctx.subChatId, pending)
      appStore.set(expiredUserQuestionsAtom, newExpiredMap)
    }
  }

  // Handle AskUserQuestion result - store for real-time updates
  if (chunk.type === "ask-user-question-result") {
    const currentResults = appStore.get(askUserQuestionResultsAtom)
    const newResults = new Map(currentResults)
    newResults.set(chunk.toolUseId, chunk.result)
    appStore.set(askUserQuestionResultsAtom, newResults)
  }
}

/** Track Compact pseudo-tool progress for the compacting indicator. */
export function applyCompactingChunks(chunk: SubscriptionChunk, subChatId: string): void {
  if (
    (chunk.type === "tool-input-start" && chunk.toolName === "Compact") ||
    (chunk.type === "tool-input-available" && chunk.toolName === "Compact")
  ) {
    const compacting = appStore.get(compactingSubChatsAtom)
    const newCompacting = new Set(compacting)
    // Compacting started
    newCompacting.add(subChatId)
    appStore.set(compactingSubChatsAtom, newCompacting)
  }
  if (
    (chunk.type === "tool-output-available" && chunk.toolCallId?.startsWith("compact-")) ||
    (chunk.type === "tool-output-error" && chunk.toolCallId?.startsWith("compact-"))
  ) {
    const compacting = appStore.get(compactingSubChatsAtom)
    const newCompacting = new Set(compacting)
    // Compacting finished
    newCompacting.delete(subChatId)
    appStore.set(compactingSubChatsAtom, newCompacting)
  }
}

/**
 * Clear pending questions ONLY when agent has moved on. Don't clear on
 * tool-input-* chunks (still building the question input). Clear when we get
 * tool-output-* (answer received) or text-delta (agent moved on).
 */
export function clearStalePendingQuestion(chunk: SubscriptionChunk, subChatId: string): void {
  const shouldClearOnChunk =
    chunk.type !== "ask-user-question" &&
    chunk.type !== "ask-user-question-timeout" &&
    chunk.type !== "ask-user-question-result" &&
    !chunk.type.startsWith("tool-input") && // Don't clear while input is being built
    chunk.type !== "start" &&
    chunk.type !== "start-step"

  if (shouldClearOnChunk) {
    const currentMap = appStore.get(pendingUserQuestionsAtom)
    if (currentMap.has(subChatId)) {
      const newMap = new Map(currentMap)
      newMap.delete(subChatId)
      appStore.set(pendingUserQuestionsAtom, newMap)
    }
    // NOTE: Do NOT clear expired questions here. After a timeout,
    // the agent continues and emits new chunks — that's expected.
    // Expired questions should persist until the user answers,
    // dismisses, or sends a new message.
  }
}

// Image attachment type matching the tRPC schema
export type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

/** Extract the text prompt (plus hidden file contents) from a user message. */
export function extractPromptText(msg: UIMessage | undefined): string {
  if (!msg) return ""
  if (msg.parts) {
    const textParts: string[] = []
    const fileContents: string[] = []

    for (const p of msg.parts) {
      const part = p as LooseUIPart
      if (part.type === "text" && part.text) {
        textParts.push(part.text)
      } else if (part.type === "file-content") {
        // Hidden file content - add to prompt but not displayed in UI
        const fileName = part.filePath?.split("/").pop() || part.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${part.content}`)
      }
    }

    // Combine text and file contents
    return textParts.join("\n") + fileContents.join("")
  }
  return ""
}

/**
 * Extract images from message parts.
 * Looks for parts with type "data-image" that have base64Data.
 */
export function extractPromptImages(msg: UIMessage | undefined): ImageAttachment[] {
  if (!msg?.parts) return []

  const images: ImageAttachment[] = []

  for (const part of msg.parts) {
    // Check for data-image parts with base64 data
    const data = (part as LooseUIPart).data
    if (part.type === "data-image" && data) {
      if (data.base64Data && data.mediaType) {
        images.push({
          base64Data: data.base64Data,
          mediaType: data.mediaType,
          filename: data.filename,
        })
      }
    }
  }

  return images
}

/**
 * What the AI SDK hands a transport on send. Derived from the library's own
 * `ChatTransport` contract rather than restated per transport, so both engines
 * accept the same options and neither narrows them by hand: when the SDK adds a
 * field, both see it without an edit here.
 */
export type SendMessagesOptions = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]

/**
 * The newest user turn's prompt text and image attachments. Both engines read
 * the last user message the same way, so the reading lives here; a missing
 * message yields an empty prompt and no images, which each engine then rejects
 * on its own terms.
 */
export function lastUserPrompt(messages: readonly UIMessage[]): {
  prompt: string
  images: ImageAttachment[]
} {
  const lastUser = [...messages].reverse().find((message) => message.role === "user")
  return {
    prompt: extractPromptText(lastUser),
    images: extractPromptImages(lastUser),
  }
}
