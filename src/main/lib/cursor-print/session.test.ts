/**
 * cursor native-print turn tests against the mock `agent` script: full
 * turn mapping (deltas, flush-skipping, tool trios, function tools),
 * snapshot-mode dedup, error paths (exit code, error result), interrupt,
 * session-id capture, rejected results, missing call_id correlation,
 * trailing-line flush, and stdin prompts.
 */
import { assert, it } from "@effect/vitest"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { runCursorPrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "cursor-print-mock.mjs",
)

function runTurn(
  mode?: string,
  stdinText?: string,
): {
  chunks: any[]
  sessionIds: string[]
  done: ReturnType<typeof runCursorPrintTurn>["done"]
  interrupt: () => void
} {
  const chunks: any[] = []
  const sessionIds: string[] = []
  const turn = runCursorPrintTurn({
    command: process.execPath,
    args: [MOCK_PATH],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { CURSOR_MOCK_MODE: mode } : {}),
    },
    ...(stdinText !== undefined ? { stdinText } : {}),
    onChunk: (chunk) => chunks.push(chunk),
    onSessionId: (id) => sessionIds.push(id),
  })
  return { chunks, sessionIds, done: turn.done, interrupt: turn.interrupt }
}

it("maps a full turn and skips buffered flush duplicates", async () => {
  const { chunks, sessionIds, done } = runTurn()
  const result = await done
  assert.equal(result.status, "completed")
  assert.equal(sessionIds[0], "ses-mock-1")

  const types = chunks.map((chunk) => chunk.type)
  assert.deepEqual(types, [
    "text-start",
    "text-delta",
    "tool-input-start",
    "tool-input-available",
    "tool-output-available",
    "text-delta",
    "tool-input-start",
    "tool-input-available",
    "tool-output-available",
    "text-end",
  ])
  assert.equal(chunks[1].delta, "Hello ")
  assert.equal(chunks[5].delta, "done.")
  assert.equal(chunks[2].toolName, "Read")
  assert.equal(chunks[2].toolCallId, "call-1")
  assert.deepEqual(chunks[4].output, { content: "# Mock", totalLines: 1 })
  assert.equal(chunks[6].toolName, "Bash")
  assert.deepEqual(chunks[7].input, { command: "ls" })
  assert.equal(chunks[8].output, "a\nb")
})

it("dedups snapshot-mode complete messages by suffix", async () => {
  const { chunks, done } = runTurn("snapshot")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["first segment ", "second segment"])
})

it("surfaces non-zero exits with the stderr message", async () => {
  const { chunks, done } = runTurn("error-exit")
  const result = await done
  assert.equal(result.status, "error")
  if (result.status === "error") {
    assert.ok(result.errorMessage.includes("quota exceeded"))
  }
  assert.equal(chunks[chunks.length - 1].type, "error")
})

it("surfaces error results", async () => {
  const { chunks, done } = runTurn("error-result")
  const result = await done
  assert.equal(result.status, "error")
  if (result.status === "error") {
    assert.equal(result.errorMessage, "mock result failure")
  }
  assert.ok(chunks.some((chunk) => chunk.type === "error"))
})

it("settles interrupted without error chunks when killed", async () => {
  const { chunks, done, interrupt } = runTurn("never")
  await new Promise((resolve) => setTimeout(resolve, 200))
  interrupt()
  const result = await done
  assert.equal(result.status, "interrupted")
  assert.ok(!chunks.some((chunk) => chunk.type === "error"))
})

it("maps rejected tool results to error outputs", async () => {
  const { chunks, done } = runTurn("rejected")
  const result = await done
  assert.equal(result.status, "completed")
  const output = chunks.find(
    (chunk) => chunk.type === "tool-output-available",
  )
  assert.deepEqual(output.output, { error: "rejected: needs approval" })
})

it("correlates tools without call_id oldest-open-first", async () => {
  const { chunks, done } = runTurn("no-call-id")
  const result = await done
  assert.equal(result.status, "completed")
  const input = chunks.find(
    (chunk) => chunk.type === "tool-input-available",
  )
  const output = chunks.find(
    (chunk) => chunk.type === "tool-output-available",
  )
  assert.equal(input.toolName, "Grep")
  assert.equal(output.toolCallId, input.toolCallId)
  assert.deepEqual(output.output, { matches: 1 })
})

it("flushes a final line without a trailing newline", async () => {
  const { chunks, done } = runTurn("no-trailing-newline")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["tail"])
})

it("delivers stdinText to the child on stdin", async () => {
  const { chunks, done } = runTurn("echo-stdin", "hello-prompt")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["stdin:hello-prompt"])
})

it("emits fresh snapshots after a tool call instead of dropping them", async () => {
  const { chunks, done } = runTurn("snapshot-fresh")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunks
    .filter((chunk) => chunk.type === "text-delta")
    .map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["first part ", "second part."])
})

it("treats non-started tool subtypes as completion, not input", async () => {
  const { chunks, done } = runTurn("failed-tool")
  const result = await done
  assert.equal(result.status, "completed")
  assert.equal(
    chunks.filter((chunk) => chunk.type === "tool-input-available").length,
    0,
  )
  const output = chunks.find(
    (chunk) => chunk.type === "tool-output-available",
  )
  assert.equal(output.toolCallId, "call-f")
  assert.deepEqual(output.output, { error: "command failed" })
})
