/**
 * Queued-message vocabulary shared by the main-process queue store (roadmap
 * step 08) and the renderer that renders and sends the items. The main process
 * owns the rows, their order and the hand-off; the renderer builds the payload
 * from what the user typed and turns a claimed payload into message parts.
 */
import { z } from "zod"

export const QUEUE_ITEM_STATUSES = ["pending", "paused", "sending"] as const

export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number]

/**
 * Caps on what one queued item may carry. The renderer is a separate process,
 * so every field it hands over is bounded here, at the boundary the main
 * process owns. The text caps count JavaScript characters (`z.string().max`),
 * which are UTF-16 code units, so a non-ASCII message takes more bytes in the
 * database than the number below.
 */
export const QUEUE_TEXT_CAP = 200_000
export const QUEUE_LONG_TEXT_CAP = 400_000
export const QUEUE_BASE64_CAP = 24_000_000
export const QUEUE_ATTACHMENT_CAP = 20
/**
 * Inline base64 one item may carry across all of its attachments. The caps
 * above bound each attachment and each array; without this total, twenty
 * attachments at the per-attachment cap would put half a gigabyte into one
 * row. Two attachments at the cap fit, a third max-size one does not.
 */
export const QUEUE_ITEM_BASE64_CAP = 48_000_000

const queuedImageSchema = z.object({
  id: z.string().max(200),
  url: z.string().max(QUEUE_TEXT_CAP),
  mediaType: z.string().max(200),
  filename: z.string().max(500).optional(),
  base64Data: z.string().max(QUEUE_BASE64_CAP).optional(),
})

const queuedFileSchema = z.object({
  id: z.string().max(200),
  url: z.string().max(QUEUE_TEXT_CAP),
  filename: z.string().max(500),
  mediaType: z.string().max(200).optional(),
  size: z.number().nonnegative().optional(),
})

const queuedTextContextSchema = z.object({
  id: z.string().max(200),
  text: z.string().max(QUEUE_LONG_TEXT_CAP),
  sourceMessageId: z.string().max(200),
})

const queuedDiffTextContextSchema = z.object({
  id: z.string().max(200),
  text: z.string().max(QUEUE_LONG_TEXT_CAP),
  filePath: z.string().max(QUEUE_TEXT_CAP),
  lineNumber: z.number().int().nonnegative().optional(),
  lineType: z.enum(["old", "new"]).optional(),
})

const queuedPastedTextSchema = z.object({
  id: z.string().max(200),
  filePath: z.string().max(QUEUE_TEXT_CAP),
  filename: z.string().max(500),
  size: z.number().nonnegative(),
  preview: z.string().max(QUEUE_TEXT_CAP),
  kind: z.enum(["pasted", "chatHistory"]).optional(),
})

export const queuePayloadSchema = z
  .object({
    message: z.string().max(QUEUE_LONG_TEXT_CAP),
    images: z.array(queuedImageSchema).max(QUEUE_ATTACHMENT_CAP).optional(),
    files: z.array(queuedFileSchema).max(QUEUE_ATTACHMENT_CAP).optional(),
    textContexts: z.array(queuedTextContextSchema).max(QUEUE_ATTACHMENT_CAP).optional(),
    diffTextContexts: z.array(queuedDiffTextContextSchema).max(QUEUE_ATTACHMENT_CAP).optional(),
    pastedTexts: z.array(queuedPastedTextSchema).max(QUEUE_ATTACHMENT_CAP).optional(),
  })
  .superRefine((payload, ctx) => {
    const inline = (payload.images ?? []).reduce(
      (total, image) => total + (image.base64Data?.length ?? 0),
      0,
    )
    if (inline > QUEUE_ITEM_BASE64_CAP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `An item may carry at most ${QUEUE_ITEM_BASE64_CAP} base64 characters across its attachments`,
      })
    }
    // An item with no text and no attachment expands into no message parts at
    // all, so the send would leave with nothing in it: the turn reports no
    // start, and the row ends up parked with an outcome nobody can explain.
    // The composer refuses this itself — it needs trimmed text or an
    // attachment — and the boundary is where that rule holds for every caller.
    const carriesText = payload.message.trim().length > 0
    const carriesAttachment =
      (payload.images?.length ?? 0) > 0 ||
      (payload.files?.length ?? 0) > 0 ||
      (payload.textContexts?.length ?? 0) > 0 ||
      (payload.diffTextContexts?.length ?? 0) > 0 ||
      (payload.pastedTexts?.length ?? 0) > 0
    if (!carriesText && !carriesAttachment) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An item must carry a message or at least one attachment",
      })
    }
  })

export type QueuePayload = z.infer<typeof queuePayloadSchema>
export type QueuedImage = z.infer<typeof queuedImageSchema>
export type QueuedFile = z.infer<typeof queuedFileSchema>
export type QueuedTextContext = z.infer<typeof queuedTextContextSchema>
export type QueuedDiffTextContext = z.infer<typeof queuedDiffTextContextSchema>
export type QueuedPastedText = z.infer<typeof queuedPastedTextSchema>

/** One queue row as both processes see it. */
export interface QueueItem {
  id: string
  subChatId: string
  position: number
  status: QueueItemStatus
  payload: QueuePayload
  createdAt: Date
  dispatchedAt: Date | null
}

/** The payload flattened with its row id, which is what the card renders. */
export interface QueueItemView extends QueuePayload {
  id: string
  status: QueueItemStatus
}

export function toQueueItemView(item: QueueItem): QueueItemView {
  return { ...item.payload, id: item.id, status: item.status }
}
