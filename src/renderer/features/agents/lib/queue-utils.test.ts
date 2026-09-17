/**
 * Composer-side conversion tests (roadmap step 08). The composer builds a
 * payload out of what the user attached and main parses it with
 * `queuePayloadSchema` at the process boundary. Nothing else checks the two
 * against each other, and a field the composer writes that the boundary does
 * not accept costs the user the whole queued message, so the real conversions
 * are what this file feeds the real schema.
 */
import { describe, expect, it } from "vitest"
import {
  QUEUE_BASE64_CAP,
  QUEUE_ITEM_BASE64_CAP,
  queuePayloadSchema,
} from "../../../../shared/queue-item"
import {
  createTextPreview,
  toQueuedDiffTextContext,
  toQueuedFile,
  toQueuedImage,
  toQueuedPastedText,
  toQueuedTextContext,
} from "./queue-utils"

describe("the composer's queue payload", () => {
  it("is what the main-process boundary accepts, attachments and all", () => {
    const payload = {
      message: "look at these",
      images: [
        toQueuedImage({
          id: "i1",
          url: "blob:file:///image-1",
          mediaType: "image/png",
          filename: "shot.png",
          base64Data: "aGVsbG8=",
          isLoading: false,
        }),
      ],
      files: [
        toQueuedFile({
          id: "f1",
          url: "blob:file:///file-1",
          filename: "notes.md",
          type: "text/markdown",
          size: 12,
          isLoading: false,
        }),
      ],
      textContexts: [
        toQueuedTextContext({
          id: "t1",
          text: "quoted",
          sourceMessageId: "m1",
          preview: "quoted",
          createdAt: new Date(),
        }),
      ],
      diffTextContexts: [
        toQueuedDiffTextContext({
          id: "d1",
          text: "const a = 1",
          filePath: "src/a.ts",
          lineNumber: 4,
          lineType: "new",
          preview: "const a = 1",
          createdAt: new Date(),
        }),
      ],
      pastedTexts: [
        toQueuedPastedText({
          id: "p1",
          filePath: "/tmp/pasted.md",
          filename: "pasted.md",
          size: 2048,
          preview: "a paste",
          createdAt: new Date(),
          kind: "chatHistory",
        }),
      ],
    }

    expect(() => queuePayloadSchema.parse(payload)).not.toThrow()
  })

  it("carries an image at the per-image cap and refuses one past the item's total", () => {
    const atCap = toQueuedImage({
      id: "i1",
      filename: "shot.png",
      url: "blob:file:///image-1",
      mediaType: "image/png",
      base64Data: "a".repeat(QUEUE_BASE64_CAP),
      isLoading: false,
    })
    expect(() => queuePayloadSchema.parse({ message: "", images: [atCap] })).not.toThrow()

    // Three images the per-image cap allows whose total is past the item's. A
    // pair at half the item total would already exceed the wider per-image cap,
    // so it would be refused by that one and this rule would go untested.
    const third = "a".repeat(Math.floor(QUEUE_ITEM_BASE64_CAP / 3))
    expect(() =>
      queuePayloadSchema.parse({
        message: "",
        images: [
          { ...atCap, id: "i1", base64Data: third },
          { ...atCap, id: "i2", base64Data: third },
          { ...atCap, id: "i3", base64Data: `${third}a` },
        ],
      }),
    ).toThrow()
  })

  it("carries every composer field the boundary keeps, including the image default", () => {
    // An upload whose type the browser did not report falls back to PNG. The
    // boundary requires a media type, so a dropped default costs the whole
    // queued message rather than a label.
    const image = toQueuedImage({
      id: "i1",
      url: "blob:file:///image-1",
      filename: "shot.png",
      base64Data: "aGVsbG8=",
      isLoading: false,
    })
    expect(image.mediaType).toBe("image/png")
    expect(() => queuePayloadSchema.parse({ message: "", images: [image] })).not.toThrow()

    expect(
      toQueuedFile({
        id: "f1",
        url: "blob:file:///file-1",
        filename: "notes.md",
        type: "text/markdown",
        size: 12,
        isLoading: false,
      }),
    ).toEqual({
      id: "f1",
      url: "blob:file:///file-1",
      filename: "notes.md",
      mediaType: "text/markdown",
      size: 12,
    })

    expect(
      toQueuedDiffTextContext({
        id: "d1",
        text: "const a = 1",
        filePath: "src/a.ts",
        lineNumber: 4,
        lineType: "new",
        preview: "const a = 1",
        createdAt: new Date(),
      }),
    ).toEqual({
      id: "d1",
      text: "const a = 1",
      filePath: "src/a.ts",
      lineNumber: 4,
      lineType: "new",
    })

    // A paste the user took from chat history has to arrive as one: the token
    // the engine reads is `@[chatHistory:...]` rather than `@[pasted:...]`.
    expect(
      toQueuedPastedText({
        id: "p1",
        filePath: "/tmp/pasted.md",
        filename: "pasted.md",
        size: 2048,
        preview: "old chat",
        createdAt: new Date(),
        kind: "chatHistory",
      }),
    ).toEqual({
      id: "p1",
      filePath: "/tmp/pasted.md",
      filename: "pasted.md",
      size: 2048,
      preview: "old chat",
      kind: "chatHistory",
    })
  })

  it("collapses whitespace, keeps the head and leaves a short preview alone", () => {
    // The preview is serialized inside a single-line `@[...]` token, so a
    // newline or a run of spaces would break the mention the engine parses.
    expect(createTextPreview("  first\n\n   second  ")).toBe("first second")
    // The head is what the chip shows, and the same text a direct send shows.
    expect(createTextPreview(`HEAD${"x".repeat(80)}`)).toBe(`HEAD${"x".repeat(46)}...`)
    // A text that fits is shown as it is: an ellipsis would claim it was cut.
    expect(createTextPreview("short")).toBe("short")
  })

  it("keeps the preview the chip shows the same length a direct send uses", () => {
    expect(createTextPreview("a".repeat(80))).toBe(`${"a".repeat(50)}...`)
  })
})
