/**
 * mausCode-authored opencode session tests against the in-process mock
 * server: full turn chunk sequence, usage, permission auto-reply, resume,
 * interrupt, and error mapping.
 */
import { assert, it } from "@effect/vitest"
import { createOpencodeSession } from "./session.ts"
import { startMockOpencodeServer } from "./test/fixtures/opencode-mock-server.ts"

it("runs a full turn and maps events to chunks with usage", async () => {
  const mock = await startMockOpencodeServer()
  try {
    const chunks: any[] = []
    const session = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      onChunk: (chunk) => chunks.push(chunk),
    })

    const result = await session.startTurn([
      { type: "text", text: "hi" },
      { type: "file", path: "/tmp/mock.png", mime: "image/png" },
    ])
    assert.equal(result.status, "completed")
    if (result.status === "completed") {
      assert.equal(result.usage.inputTokens, 10)
      assert.equal(result.usage.outputTokens, 20)
      assert.equal(result.usage.costUsd, 0.001)
    }

    const types = chunks.map((chunk) => chunk.type)
    assert.deepEqual(types, [
      "text-start",
      "text-delta",
      "text-end",
      "tool-input-start",
      "tool-input-available",
      "tool-output-available",
    ])
    assert.equal(chunks[1].delta, "Hello from mock.")
    assert.equal(chunks[4].toolName, "Bash")

    // File attachments go out as file:// URLs with mime types.
    const sentParts = (mock.prompts[0]!.body as any).parts
    assert.equal(sentParts[1].type, "file")
    assert.ok(String(sentParts[1].url).startsWith("file://"))
    assert.equal(sentParts[1].mime, "image/png")

    // Permission auto-reply fired session-wide.
    await new Promise((resolve) => setTimeout(resolve, 50))
    assert.equal(mock.permissionReplies.length, 1)
    assert.deepEqual(mock.permissionReplies[0]!.body, { response: "always" })

    await session.dispose()
  } finally {
    await mock.close()
  }
})

it("resumes an existing session id", async () => {
  const mock = await startMockOpencodeServer()
  try {
    const first = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: {},
      onChunk: () => {},
    })
    const id = first.sessionId
    await first.dispose()

    const second = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: {},
      existingSessionId: id,
      onChunk: () => {},
    })
    assert.equal(second.sessionId, id)
    await second.dispose()
  } finally {
    await mock.close()
  }
})

it("interrupts a turn via abort", async () => {
  const mock = await startMockOpencodeServer({ scriptDelayMs: "never" })
  try {
    const chunks: any[] = []
    const session = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: {},
      onChunk: (chunk) => chunks.push(chunk),
    })
    const turnPromise = session.startTurn([{ type: "text", text: "slow" }])
    await session.interrupt()
    const result = await turnPromise
    assert.equal(result.status, "interrupted")
    // Interrupts are silent: no error chunk.
    assert.ok(!chunks.some((chunk) => chunk.type === "error"))
    await session.dispose()
  } finally {
    await mock.close()
  }
})

it("maps session errors to error chunks and results", async () => {
  const mock = await startMockOpencodeServer({
    script: (sessionID) => [
      {
        type: "session.error",
        properties: {
          sessionID,
          error: { name: "ApiError", data: { message: "boom" } },
        },
      },
    ],
  })
  try {
    const chunks: any[] = []
    const session = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: {},
      onChunk: (chunk) => chunks.push(chunk),
    })
    const result = await session.startTurn([{ type: "text", text: "hi" }])
    assert.equal(result.status, "error")
    assert.equal(chunks[chunks.length - 1].type, "error")
    assert.equal(chunks[chunks.length - 1].errorText, "boom")
    await session.dispose()
  } finally {
    await mock.close()
  }
})

it("handles snapshot-only text and duplicate deliveries", async () => {
  const mock = await startMockOpencodeServer({
    script: (sessionID) => [
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "pt_snap",
            sessionID,
            messageID: "msg_1",
            type: "text",
            text: "snapshot-only text",
            time: {},
          },
        },
      },
      // Duplicate delivery: must not double-emit.
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "pt_snap",
            sessionID,
            messageID: "msg_1",
            type: "text",
            text: "snapshot-only text",
            time: {},
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "pt_snap",
            sessionID,
            messageID: "msg_1",
            type: "text",
            text: "snapshot-only text",
            time: { end: 2 },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "pt_tool",
            sessionID,
            messageID: "msg_1",
            type: "tool",
            tool: "read",
            callID: "call_dup",
            state: { status: "completed", input: {}, output: "ok" },
          },
        },
      },
      // Duplicate terminal delivery: single tool-output chunk.
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "pt_tool",
            sessionID,
            messageID: "msg_1",
            type: "tool",
            tool: "read",
            callID: "call_dup",
            state: { status: "completed", input: {}, output: "ok" },
          },
        },
      },
      { type: "session.idle", properties: { sessionID } },
    ],
    scriptDelayMs: 0,
  })
  try {
    const chunks: any[] = []
    const session = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: { ...process.env } as Record<string, string>,
      onChunk: (chunk) => chunks.push(chunk),
    })

    const result = await session.startTurn([{ type: "text", text: "hi" }])
    assert.equal(result.status, "completed")

    const deltas = chunks.filter((chunk) => chunk.type === "text-delta")
    assert.equal(deltas.length, 1)
    assert.equal(deltas[0].delta, "snapshot-only text")

    const outputs = chunks.filter(
      (chunk) => chunk.type === "tool-output-available",
    )
    assert.equal(outputs.length, 1)

    await session.dispose()
  } finally {
    await mock.close()
  }
})

it("recreates the session once when a turn hits a deleted session", async () => {
  const mock = await startMockOpencodeServer({ scriptDelayMs: 0 })
  try {
    const chunks: any[] = []
    const session = await createOpencodeSession({
      serverUrl: mock.url,
      cwd: process.cwd(),
      env: {},
      onChunk: (chunk) => chunks.push(chunk),
    })
    const originalId = session.sessionId

    // Simulate server-side session loss between turns.
    mock.dropSession(originalId)

    const result = await session.startTurn([{ type: "text", text: "hi" }])
    assert.equal(result.status, "completed")
    assert.notEqual(session.sessionId, originalId)
    assert.ok(
      chunks.some((chunk) => chunk.type === "text-delta"),
      "expected retried turn to stream",
    )

    await session.dispose()
  } finally {
    await mock.close()
  }
})
