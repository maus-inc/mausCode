/**
 * Turns a queued payload into the message parts a direct send would produce
 * (roadmap step 08). Kept free of stores and React so the sender, the tests
 * and any future caller share one implementation.
 */
import type { UIMessage } from "ai"
import type { QueuePayload } from "../../../../shared/queue-item"
import { MENTION_PREFIXES } from "../mentions/mention-prefixes"
import { utf8ToBase64 } from "../utils/base64"
import { createTextPreview } from "./queue-utils"

/** Expand the payload into user-message parts: attachments, mentions, text. */
export function buildQueueMessageParts(item: QueuePayload): UIMessage["parts"] {
  const parts: UIMessage["parts"] = [
    ...(item.images || []).map((img) => ({
      type: "data-image" as const,
      data: {
        url: img.url,
        mediaType: img.mediaType,
        filename: img.filename,
        base64Data: img.base64Data,
      },
    })),
    ...(item.files || []).map((f) => ({
      type: "data-file" as const,
      data: {
        url: f.url,
        mediaType: f.mediaType,
        filename: f.filename,
        size: f.size,
      },
    })),
  ]

  // `createTextPreview` is what the composer's own contexts use for `preview`,
  // so a queued token serializes to the same string a direct send would, and
  // the label the chip shows matches the token the engine reads.
  const mentions: string[] = []
  for (const context of item.textContexts ?? []) {
    const preview = createTextPreview(context.text).replace(/[:[\]]/g, "")
    mentions.push(`@[${MENTION_PREFIXES.QUOTE}${preview}:${utf8ToBase64(context.text)}]`)
  }
  for (const context of item.diffTextContexts ?? []) {
    const preview = createTextPreview(context.text).replace(/[:[\]]/g, "")
    const lineNumber = context.lineNumber || 0
    mentions.push(
      `@[${MENTION_PREFIXES.DIFF}${context.filePath}:${lineNumber}:${preview}:${utf8ToBase64(context.text)}]`,
    )
  }
  for (const pasted of item.pastedTexts ?? []) {
    const preview = pasted.preview.replace(/[:[\]|]/g, "")
    const prefix =
      pasted.kind === "chatHistory" ? MENTION_PREFIXES.CHAT_HISTORY : MENTION_PREFIXES.PASTED
    mentions.push(`@[${prefix}${pasted.size}:${preview}|${pasted.filePath}]`)
  }

  const mentionPrefix = mentions.length > 0 ? `${mentions.join(" ")} ` : ""
  if (item.message || mentionPrefix) {
    parts.push({ type: "text", text: mentionPrefix + item.message })
  }
  return parts
}
