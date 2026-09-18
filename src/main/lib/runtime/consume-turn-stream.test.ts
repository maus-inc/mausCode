/**
 * Turn-stream consumption tests. Runnable without Electron or app
 * dependencies:
 *   node --test --experimental-strip-types src/main/lib/runtime/consume-turn-stream.test.ts
 */

import assert from "node:assert/strict"
import { test } from "node:test"
import type { ApiEvent, JcodeClient } from "@maus-inc/runtime-client"
import type { HarnessRunEvent } from "../../../shared/run-state.ts"
import type { UIMessageChunk } from "../claude/types.ts"
import { consumeNativeTurnStream, type NativeTurnTranslator } from "./consume-turn-stream.ts"

const emptyTranslator: NativeTurnTranslator = {
  translate: () => ({ chunks: [], runEvents: [] }),
}

/**
 * A hand-rolled event stream so a test can close it from the outside,
 * exactly like cancelRemote() closes a live session stream.
 */
function makeStream(events: ApiEvent[]): {
  stream: ReturnType<JcodeClient["events"]>
  close: () => void
} {
  let index = 0
  let closed = false
  const stream: AsyncIterableIterator<ApiEvent> = {
    next: async () => {
      if (closed || index >= events.length) return { done: true, value: undefined }
      return { done: false, value: events[index++] }
    },
    [Symbol.asyncIterator]() {
      return this
    },
  }
  return {
    stream: stream as unknown as ReturnType<JcodeClient["events"]>,
    close: () => (closed = true),
  }
}

test("marks completion when the daemon ends the turn", async () => {
  const { stream } = makeStream([
    { ev: "text_delta", session_id: "s", text: "hi" },
    { ev: "turn_done", session_id: "s" },
    { ev: "text_delta", session_id: "s", text: "late" },
  ])
  let completed = false

  await consumeNativeTurnStream(
    stream,
    emptyTranslator,
    () => false,
    () => {},
    () => {},
    () => {
      completed = true
    },
  )

  assert.equal(completed, true)
})

test("marks completion when the stream exhausts without a cancel", async () => {
  const { stream } = makeStream([{ ev: "text_delta", session_id: "s", text: "hi" }])
  let completed = false

  await consumeNativeTurnStream(
    stream,
    emptyTranslator,
    () => false,
    () => {},
    () => {},
    () => {
      completed = true
    },
  )

  assert.equal(completed, true)
})

test("does not mark completion when a cancel closes the iterator", async () => {
  const { stream, close } = makeStream([
    { ev: "text_delta", session_id: "s", text: "hi" },
    { ev: "text_delta", session_id: "s", text: "more" },
  ])
  let completed = false
  let checks = 0

  // Models the cancel race: the first stop-check passes while the turn is
  // still producing, then the cancel lands and closes the stream. The loop
  // exhausts through that close, and the post-loop check must see the stop
  // flag instead of recording a completion.
  const shouldStop = () => {
    checks += 1
    if (checks === 1) {
      close()
      return false
    }
    return true
  }

  await consumeNativeTurnStream(
    stream,
    emptyTranslator,
    shouldStop,
    () => {},
    () => {},
    () => {
      completed = true
    },
  )

  assert.equal(completed, false)
})

test("marks completion on a daemon error event", async () => {
  const { stream } = makeStream([{ ev: "error", code: "internal", message: "boom" }])
  let completed = false

  await consumeNativeTurnStream(
    stream,
    emptyTranslator,
    () => false,
    () => {},
    () => {},
    () => {
      completed = true
    },
  )

  assert.equal(completed, true)
})

test("forwards translator run events in stream order", async () => {
  const runEvent: HarnessRunEvent = {
    kind: "session_status",
    payload: { session_id: "s", status: "busy" },
  }
  const chunk: UIMessageChunk = { type: "text-delta", id: "t1", delta: "hi" }
  const translator: NativeTurnTranslator = {
    translate: (event) =>
      event.ev === "text_delta"
        ? { chunks: [chunk], runEvents: [] }
        : event.ev === "session_status"
          ? { chunks: [], runEvents: [runEvent] }
          : { chunks: [], runEvents: [] },
  }
  const { stream } = makeStream([
    { ev: "text_delta", session_id: "s", text: "hi" },
    { ev: "session_status", session_id: "s", status: "busy" },
    { ev: "turn_done", session_id: "s" },
  ])
  const emitted: string[] = []
  const seen: HarnessRunEvent[] = []

  await consumeNativeTurnStream(
    stream,
    translator,
    () => false,
    (c) => emitted.push(c.type),
    (event) => seen.push(event),
    () => {},
  )

  assert.deepEqual(emitted, ["text-delta"])
  assert.deepEqual(seen, [runEvent])
})
