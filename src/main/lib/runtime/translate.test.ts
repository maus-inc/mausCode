/**
 * Translator unit tests. Runnable without Electron or app dependencies:
 *   node --test --experimental-strip-types src/main/lib/runtime/translate.test.ts
 */

import assert from "node:assert/strict"
import { mock, test } from "node:test"
import { NATIVE_QUESTION_PREFIX, NativeTranslator } from "./translate.ts"

function events(t: NativeTranslator, evs: Array<Record<string, unknown>>) {
  return evs.flatMap((ev) => t.translate(ev as never).chunks)
}

function runEvents(t: NativeTranslator, evs: Array<Record<string, unknown>>) {
  return evs.flatMap((ev) => t.translate(ev as never).runEvents)
}

test("beginTurn emits start lifecycle", () => {
  const t = new NativeTranslator()
  assert.deepEqual(t.beginTurn(), [{ type: "start" }, { type: "start-step" }])
})

test("contiguous text deltas share one block; tool splits blocks", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    { ev: "text_delta", session_id: "s", text: "Hello " },
    { ev: "text_delta", session_id: "s", text: "world" },
    { ev: "tool_start", session_id: "s", call_id: "c1", name: "read" },
    { ev: "text_delta", session_id: "s", text: "after" },
  ])
  const types = out.map((c) => c.type)
  assert.deepEqual(types, [
    "text-start",
    "text-delta",
    "text-delta",
    "text-end",
    "tool-input-start",
    "text-start",
    "text-delta",
  ])
  const ids = out.filter((c) => c.type === "text-start").map((c) => (c as { id: string }).id)
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
})

test("tool lifecycle accumulates input and parses JSON", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    { ev: "tool_start", session_id: "s", call_id: "c1", name: "read" },
    { ev: "tool_input_delta", session_id: "s", call_id: "c1", delta: '{"file' },
    { ev: "tool_input_delta", session_id: "s", call_id: "c1", delta: '_path":"a"}' },
    { ev: "tool_exec", session_id: "s", call_id: "c1", name: "read" },
    { ev: "tool_done", session_id: "s", call_id: "c1", name: "read", output: "content" },
  ])
  assert.equal(out[0].type, "tool-input-start")
  const available = out.find((c) => c.type === "tool-input-available") as unknown as {
    input: unknown
  }
  assert.deepEqual(available.input, { file_path: "a" })
  assert.deepEqual(out[out.length - 1], {
    type: "tool-output-available",
    toolCallId: "c1",
    output: "content",
  })
})

test("tool_done with error maps to tool-output-error", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    { ev: "tool_done", session_id: "s", call_id: "c9", name: "bash", output: "", error: "exit 1" },
  ])
  assert.deepEqual(out, [{ type: "tool-output-error", toolCallId: "c9", errorText: "exit 1" }])
})

test("turn_done closes text and finishes", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    { ev: "text_delta", session_id: "s", text: "hi" },
    { ev: "turn_done", session_id: "s" },
  ])
  assert.deepEqual(
    out.map((c) => c.type),
    ["text-start", "text-delta", "text-end", "finish-step", "finish"],
  )
})

test("token_usage maps to message-metadata", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    { ev: "token_usage", session_id: "s", input: 10, output: 20, cache_read_input: 5 },
  ])
  assert.deepEqual(out, [
    {
      type: "message-metadata",
      messageMetadata: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 5 },
    },
  ])
})

test("permission_request synthesizes an approval question", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [
    {
      ev: "permission_request",
      session_id: "s",
      request_id: "r1",
      tool_name: "bash",
      description: "Run rm -rf /tmp/x",
    },
  ])
  assert.equal(out.length, 1)
  const q = out[0] as unknown as {
    type: string
    toolUseId: string
    questions: Array<{ header: string; options: Array<{ label: string }> }>
  }
  assert.equal(q.type, "ask-user-question")
  assert.equal(q.toolUseId, `${NATIVE_QUESTION_PREFIX}r1`)
  assert.equal(q.questions[0].header, "bash")
  assert.deepEqual(
    q.questions[0].options.map((o) => o.label),
    ["Allow", "Deny"],
  )
})

test("compacted reuses the Compact indicator contract and defers the run event", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const translation = t.translate({
    ev: "compacted",
    session_id: "s",
    message: "done",
  } as never)
  assert.equal(translation.chunks[0].type, "tool-input-start")
  assert.equal((translation.chunks[0] as { toolName: string }).toolName, "Compact")
  assert.ok((translation.chunks[0] as { toolCallId: string }).toolCallId.startsWith("compact-"))
  assert.equal(translation.chunks[1].type, "tool-output-available")
  // The run event comes from the chunk observer so both engines record
  // compaction through one path (roadmap step 09).
  assert.deepEqual(translation.runEvents, [])
})

test("error carries a machine-readable native category", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const out = events(t, [{ ev: "error", code: "unknown_session", message: "gone" }])
  assert.deepEqual(out, [{ type: "error", errorText: "NATIVE_UNKNOWN_SESSION: gone" }])
})

test("session_status, background_progress and wake_requested become run events", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  assert.deepEqual(runEvents(t, [{ ev: "session_status", session_id: "s", status: "busy" }]), [
    {
      kind: "session_status",
      payload: { session_id: "s", status: "busy" },
    },
  ])
  assert.deepEqual(
    runEvents(t, [
      {
        ev: "background_progress",
        session_id: "s",
        task_id: "t1",
        label: "tests",
        percent: 40,
        summary: "3/7 green",
        done: false,
      },
    ]),
    [
      {
        kind: "background_progress",
        payload: {
          session_id: "s",
          task_id: "t1",
          label: "tests",
          percent: 40,
          summary: "3/7 green",
          done: false,
        },
      },
    ],
  )
  assert.deepEqual(
    runEvents(t, [
      {
        ev: "wake_requested",
        session_id: "s",
        reason: "background_task",
        notification: "build finished",
      },
    ]),
    [
      {
        kind: "wake_requested",
        payload: { session_id: "s", reason: "background_task", notification: "build finished" },
      },
    ],
  )
  // None of the three produces chat chunks.
  assert.deepEqual(
    events(t, [
      { ev: "session_status", session_id: "s", status: "idle" },
      { ev: "background_progress", session_id: "s", task_id: "t", label: "l", summary: "x" },
      { ev: "wake_requested", session_id: "s", reason: "r", notification: "n" },
    ]),
    [],
  )
})

test("unknown kinds warn once per kind and stay fatal-free", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const warning = mock.method(console, "warn", () => {})
  try {
    for (const ev of [
      { ev: "some_future_kind", session_id: "s" },
      { ev: "some_future_kind", session_id: "s" },
      { ev: "another_future_kind", session_id: "s" },
    ]) {
      const translation = t.translate(ev as never)
      assert.deepEqual(translation, { chunks: [], runEvents: [] })
    }
    assert.deepEqual(
      warning.mock.calls.map((call) => call.arguments.join(" ")),
      [
        '[runtime] unmapped harness event kind: "some_future_kind"',
        '[runtime] unmapped harness event kind: "another_future_kind"',
      ],
    )
  } finally {
    mock.restoreAll()
  }
})

test("unmapped-kind memory is bounded at MAX_UNMAPPED_KINDS", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const warning = mock.method(console, "warn", () => {})
  try {
    for (let i = 0; i < 60; i += 1) {
      const translation = t.translate({ ev: `future_kind_${i}`, session_id: "s" } as never)
      assert.deepEqual(translation, { chunks: [], runEvents: [] })
    }
    assert.equal(warning.mock.callCount(), 50)
  } finally {
    mock.restoreAll()
  }
})

test("internal session, file and transport events stay silent and empty", () => {
  const t = new NativeTranslator()
  t.beginTurn()
  const warning = mock.method(console, "warn", () => {})
  try {
    const internalKinds = [
      "message_accepted",
      "connection_phase",
      "session_renamed",
      "credential_updated",
      "model_info",
      "models",
      "runtime_info",
      "history",
      "attached",
      "session_forked",
      "sessions",
      "file_content",
      "files",
      "text_matches",
      "file_status",
      "side_pane_images",
      "hello_ok",
      "ok",
      "pong",
    ]
    for (const ev of internalKinds) {
      assert.deepEqual(t.translate({ ev, session_id: "s" } as never), {
        chunks: [],
        runEvents: [],
      })
    }
    assert.equal(warning.mock.callCount(), 0)
  } finally {
    mock.restoreAll()
  }
})
