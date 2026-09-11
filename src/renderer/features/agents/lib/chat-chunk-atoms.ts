/**
 * Shared stream-chunk -> atom helpers for chat transports.
 *
 * Extracted from the Claude IPC transport so the native runtime transport
 * reuses identical question/compacting/prompt-extraction behavior. Chunk
 * handling that is provider-specific (session-init, auth modals, error
 * toasts) stays in each transport.
 */
import type { UIMessage } from "ai"
import { appStore } from "../../../lib/jotai-store"
import {
  askUserQuestionResultsAtom,
  compactingSubChatsAtom,
  expiredUserQuestionsAtom,
  pendingUserQuestionsAtom,
} from "../atoms"

type UIMessageChunk = any // Inferred from subscription

export interface ChatChunkContext {
  subChatId: string
  chatId: string
}

/** Track AskUserQuestion lifecycle (pending -> expired/result) in atoms. */
export function applyQuestionChunks(chunk: UIMessageChunk, ctx: ChatChunkContext): void {
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
export function applyCompactingChunks(chunk: UIMessageChunk, subChatId: string): void {
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
export function clearStalePendingQuestion(chunk: UIMessageChunk, subChatId: string): void {
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
      const partType = (p as any).type as string
      if (partType === "text" && (p as any).text) {
        textParts.push((p as any).text)
      } else if (partType === "file-content") {
        // Hidden file content - add to prompt but not displayed in UI
        const fc = p as any
        const fileName = fc.filePath?.split("/").pop() || fc.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${fc.content}`)
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
  if (!msg || !msg.parts) return []

  const images: ImageAttachment[] = []

  for (const part of msg.parts) {
    // Check for data-image parts with base64 data
    if (part.type === "data-image" && (part as any).data) {
      const data = (part as any).data
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
