/**
 * Claude stream translator tests (roadmap step 09). The boundary is typed by
 * the local `ClaudeStreamMessage` union in `./types`, so every fixture below
 * is a real member shape; the compile guards in `./transform` fail typecheck
 * when the classification lists stop covering the union.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createTransformer, INTERNAL_STREAM_MESSAGE_TYPES } from "./transform"
import type { ClaudeStreamMessage } from "./types"

const U1 = "00000000-0000-4000-8000-000000000001"
const U2 = "00000000-0000-4000-8000-000000000002"
const U3 = "00000000-0000-4000-8000-000000000003"
const U4 = "00000000-0000-4000-8000-000000000004"

function translate(...messages: ClaudeStreamMessage[]): string[] {
  const transform = createTransformer()
  const out: string[] = []
  for (const msg of messages) {
    for (const chunk of transform(msg)) out.push(chunk.type)
  }
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("claude transform", () => {
  it("streams a text trio from stream events", () => {
    expect(
      translate(
        {
          type: "stream_event",
          event: { type: "content_block_start", content_block: { type: "text", text: "" } },
        },
        {
          type: "stream_event",
          event: { type: "content_block_delta", delta: { type: "text_delta", text: "hello" } },
        },
        { type: "stream_event", event: { type: "content_block_stop" } },
      ),
    ).toEqual(["start", "start-step", "text-start", "text-delta", "text-end"])
  })

  it("emits a complete assistant message with text and tool_use", () => {
    const types = translate({
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "reading now" },
          { type: "tool_use", id: "tu_1", name: "Read", input: { path: "a.ts" } },
        ],
      },
      parent_tool_use_id: null,
    })
    expect(types).toEqual([
      "start",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-available",
    ])
  })

  it("maps tool results, including the error variant", () => {
    const ok = translate({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_1", content: "file body" }],
      },
    })
    // A fresh transformer opens with the start lifecycle before mapping.
    expect(ok).toEqual(["start", "start-step", "tool-output-available"])

    const failing = createTransformer()({
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tu_2", content: "nope", is_error: true }],
      },
    })
    const errorChunk = [...failing].find((chunk) => chunk.type === "tool-output-error")
    expect(errorChunk).toMatchObject({ toolCallId: "tu_2", errorText: "nope" })
  })

  it("renders structured tool_result error content as text, not [object Object]", () => {
    const failing = createTransformer()({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_3",
            is_error: true,
            content: [{ type: "text", text: "line one" }, { type: "image" }],
          },
        ],
      },
    })
    const errorChunk = [...failing].find((chunk) => chunk.type === "tool-output-error") as {
      errorText: string
    }
    expect(errorChunk.errorText).toBe("line one\n[image]")
  })

  it("maps the compacting status and compact_boundary to the Compact indicator", () => {
    const types = translate(
      { type: "system", subtype: "status", status: "compacting", uuid: U1, session_id: "s" },
      {
        type: "system",
        subtype: "compact_boundary",
        compact_metadata: { trigger: "auto", pre_tokens: 190000 },
        uuid: U2,
        session_id: "s",
      },
    )
    expect(types).toEqual(["start", "start-step", "tool-input-available", "tool-output-available"])
  })

  it("passes serverInfo and error through session-init", () => {
    const out = [
      ...createTransformer()({
        type: "system",
        subtype: "init",
        tools: ["Bash"],
        mcp_servers: [
          {
            name: "github",
            status: "connected",
            serverInfo: { name: "github", version: "1.2.3" },
          },
          { name: "broken", status: "weird", error: "boom" },
        ],
        plugins: [],
        skills: [],
      }),
    ]
    const init = out.find((c) => c.type === "session-init") as {
      mcpServers: Array<{ name: string; status: string; serverInfo?: unknown; error?: string }>
    }
    expect(init.mcpServers).toEqual([
      {
        name: "github",
        status: "connected",
        serverInfo: { name: "github", version: "1.2.3" },
      },
      { name: "broken", status: "pending", error: "boom" },
    ])
  })

  it("stays silent and chunk-free for classified internal members", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const types = translate({
      type: "auth_status",
      isAuthenticating: false,
      output: [],
      uuid: U3,
      session_id: "s",
    })
    // No content chunks, but the first message still opens the lifecycle.
    expect(types).toEqual(["start", "start-step"])
    expect(warning).not.toHaveBeenCalled()
  })

  it(`warns once per unknown message type instead of dropping it silently`, () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {})
    const mystery = { type: "message_from_the_future" } as never
    translate(mystery, mystery)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning.mock.calls[0]?.join(" ")).toContain("message_from_the_future")
    // Known internal types never warn, so the count stays at one.
    translate({
      type: "auth_status",
      isAuthenticating: false,
      output: [],
      uuid: U4,
      session_id: "s",
    })
    expect(warning).toHaveBeenCalledTimes(1)
  })

  it("classifies the union: handled plus internal covers every member", () => {
    // The compile guards carry the real check; this line documents the
    // runtime surface a new SDK member must join.
    expect([...INTERNAL_STREAM_MESSAGE_TYPES].sort()).toEqual([
      "auth_status",
      "tool_progress",
      "tool_use_summary",
    ])
  })
})
