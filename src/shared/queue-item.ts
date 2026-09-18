/**
 * Queued-message vocabulary shared by the main-process queue store (roadmap
 * step 08) and the renderer that renders and sends the items. The main process
 * owns the rows, their order and the hand-off; the renderer builds the payload
 * from what the user typed and turns a claimed payload into message parts.
 */
import { z } from "zod"

export const QUEUE_ITEM_STATUSES = ["pending", "paused", "sending"] as const

export type QueueItemStatus = (typeof QUEUE_ITEM_STATUSES)[number]

export const QUEUE_TEXT_CAP = 200_000
export const QUEUE_LONG_TEXT_CAP = 400_000
export const QUEUE_BASE64_CAP = 24_000_000
export const QUEUE_ATTACHMENT_CAP = 20
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
    const hasContent =
      payload.message.trim() !== "" ||
      (payload.images?.length ?? 0) > 0 ||
      (payload.files?.length ?? 0) > 0 ||
      (payload.textContexts?.length ?? 0) > 0 ||
      (payload.diffTextContexts?.length ?? 0) > 0 ||
      (payload.pastedTexts?.length ?? 0) > 0

    if (!hasContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Queue item must carry at least one message part",
        path: [],
      })
    }
  })

export type QueuePayload = z.infer<typeof queuePayloadSchema>

export interface QueueItem {
  id: string
  subChatId: string
  position: number
  status: QueueItemStatus
  payload: QueuePayload
  createdAt: Date
  dispatchedAt: Date | null
}

export function toQueueItemView(item: QueueItem) {
  return {
    message: item.payload.message,
    id: item.id,
    status: item.status,
  }
}
