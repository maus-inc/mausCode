/**
 * Part builder tests (roadmap step 08). The queued payload must expand into the
 * same parts a direct send produces, so the engine sees one message shape
 * whichever path sent it.
 */
import { describe, expect, it } from "vitest"
import { utf8ToBase64 } from "../utils/base64"
import { buildQueueMessageParts } from "./queue-parts"
import { createTextPreview } from "./queue-utils"

describe("buildQueueMessageParts", () => {
  it("builds a plain text part", () => {
    expect(buildQueueMessageParts({ message: "hello" })).toEqual([{ type: "text", text: "hello" }])
  })

  it("puts images and files before the text, like the composer does", () => {
    const parts = buildQueueMessageParts({
      message: "look",
      images: [{ id: "i1", url: "blob:1", mediaType: "image/png", filename: "a.png" }],
      files: [{ id: "f1", url: "blob:2", filename: "b.ts", mediaType: "text/plain", size: 12 }],
    })

    expect(parts.map((part) => part.type)).toEqual(["data-image", "data-file", "text"])
    expect(parts[2]).toEqual({ type: "text", text: "look" })
  })

  it("expands text, diff and pasted contexts as mention tokens", () => {
    const parts = buildQueueMessageParts({
      message: "explain",
      textContexts: [{ id: "t1", text: "quoted text", sourceMessageId: "m1" }],
      diffTextContexts: [{ id: "d1", text: "const a = 1", filePath: "src/a.ts", lineNumber: 4 }],
      pastedTexts: [
        {
          id: "p1",
          filePath: "/tmp/pasted.md",
          filename: "pasted.md",
          size: 1024,
          preview: "a long paste",
        },
        {
          id: "p2",
          filePath: "/tmp/history.md",
          filename: "history.md",
          size: 2048,
          preview: "old chat",
          kind: "chatHistory",
        },
      ],
    })

    expect(parts).toHaveLength(1)
    const text = parts[0].type === "text" ? parts[0].text : ""
    expect(text).toContain(`@[quote:quoted text:${utf8ToBase64("quoted text")}]`)
    expect(text).toContain(`@[diff:src/a.ts:4:const a = 1:${utf8ToBase64("const a = 1")}]`)
    expect(text).toContain("@[pasted:1024:a long paste|/tmp/pasted.md]")
    expect(text).toContain("@[chatHistory:2048:old chat|/tmp/history.md]")
    expect(text.endsWith("explain")).toBe(true)
  })

  it("previews a context the way the composer's own preview does", () => {
    // The composer sets `preview: createTextPreview(text)`, and a direct send
    // serializes that preview into the token. The queued token must not
    // truncate the raw text instead, or the same selection reads differently
    // depending on which path sent it.
    const filler = "x".repeat(60)
    const text = `  first   line\nsecond line ${filler}`
    const parts = buildQueueMessageParts({
      message: "summarize",
      textContexts: [{ id: "t1", text, sourceMessageId: "m1" }],
    })

    const serialized = parts[0].type === "text" ? parts[0].text : ""
    const preview = createTextPreview(text).replace(/[:[\]]/g, "")
    expect(preview).toContain("first line second line")
    expect(preview.endsWith("...")).toBe(true)
    expect(serialized).toContain(`@[quote:${preview}:${utf8ToBase64(text)}]`)
  })

  it("emits mention-only parts when the message text is empty", () => {
    const parts = buildQueueMessageParts({
      message: "",
      textContexts: [{ id: "t1", text: "only context", sourceMessageId: "m1" }],
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe("text")
  })
})
