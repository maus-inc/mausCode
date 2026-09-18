/**
 * Boundary tests for the shared queue vocabulary. Both
 * processes build these payloads — the composer fills them, main stores them —
 * and the caps are what keep one queued message from becoming an unbounded row,
 * so the exact edges are asserted here rather than through a caller.
 */
import { describe, expect, it } from "vitest"
import {
  QUEUE_ATTACHMENT_CAP,
  QUEUE_ITEM_BASE64_CAP,
  type QueueItem,
  queuePayloadSchema,
  toQueueItemView,
} from "./queue-item"

const image = (id: string, base64Data?: string) => ({
  id,
  url: `blob:${id}`,
  mediaType: "image/png",
  filename: `${id}.png`,
  ...(base64Data === undefined ? {} : { base64Data }),
})

describe("the queue payload boundary", () => {
  it("counts attachments, not only their bytes", () => {
    const atCap = Array.from({ length: QUEUE_ATTACHMENT_CAP }, (_, index) => image(`i${index}`))
    expect(() => queuePayloadSchema.parse({ message: "", images: atCap })).not.toThrow()
    expect(() =>
      queuePayloadSchema.parse({ message: "", images: [...atCap, image("extra")] }),
    ).toThrow()

    const file = (id: string) => ({
      id,
      url: `blob:${id}`,
      filename: `${id}.ts`,
      mediaType: "text/plain",
      size: 1,
    })
    const filesPastCap = Array.from({ length: QUEUE_ATTACHMENT_CAP + 1 }, (_, index) =>
      file(`f${index}`),
    )
    expect(() => queuePayloadSchema.parse({ message: "", files: filesPastCap })).toThrow()
  })

  it("allows an item exactly at the base64 cap and refuses one image's worth more", () => {
    const atImageCap = "a".repeat(QUEUE_ITEM_BASE64_CAP / 2)

    expect(() =>
      queuePayloadSchema.parse({
        message: "",
        images: [image("i1", atImageCap), image("i2", atImageCap)],
      }),
    ).not.toThrow()
    expect(() =>
      queuePayloadSchema.parse({
        message: "",
        images: [image("i1", atImageCap), image("i2", atImageCap), image("i3", atImageCap)],
      }),
    ).toThrow()
  })

  it("refuses an item that would carry nothing at all", () => {
    expect(() => queuePayloadSchema.parse({ message: "" })).toThrow()
    expect(() => queuePayloadSchema.parse({ message: "   " })).toThrow()
    expect(() => queuePayloadSchema.parse({ message: "", images: [] })).toThrow()

    expect(() => queuePayloadSchema.parse({ message: "", images: [image("i1")] })).not.toThrow()
    expect(() => queuePayloadSchema.parse({ message: "   ", textContexts: [] })).toThrow()
    expect(() =>
      queuePayloadSchema.parse({
        message: "",
        textContexts: [{ id: "t1", text: "quoted", sourceMessageId: "m1" }],
      }),
    ).not.toThrow()
  })

  it("keeps the pasted-text kind to the two the token builder knows", () => {
    const paste = (kind: unknown) => ({
      id: "p1",
      filePath: "/tmp/p.md",
      filename: "p.md",
      size: 1,
      preview: "x",
      kind,
    })

    expect(() =>
      queuePayloadSchema.parse({ message: "", pastedTexts: [paste("chatHistory")] }),
    ).not.toThrow()
    expect(() => queuePayloadSchema.parse({ message: "", pastedTexts: [paste("other")] })).toThrow()
  })
})

describe("toQueueItemView", () => {
  it("flattens the row's payload and keeps the identity the card keys on", () => {
    const item: QueueItem = {
      id: "q1",
      subChatId: "sub-a",
      position: 0,
      status: "paused",
      payload: { message: "hello" },
      createdAt: new Date(),
      dispatchedAt: null,
    }

    expect(toQueueItemView(item)).toEqual({ message: "hello", id: "q1", status: "paused" })
  })
})
