/**
 * grok native-print turn tests against the mock `grok` script: full
 * turn mapping (text deltas, canonical tool names, usage, end metadata),
 * progress-update filtering, at-most-once tool output, failed tools,
 * missing call_id correlation, plan rendering, refusal/cancel stops,
 * error paths (exit code, error event), interrupt, prompt-file carriage,
 * trailing-line flush, and usage-line summation.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, it } from "@effect/vitest"
import { type GrokPrintChunk, type GrokUsage, runGrokPrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "grok-print-mock.mjs",
)

type GrokChunkOf<T extends GrokPrintChunk["type"]> = Extract<GrokPrintChunk, { type: T }>

// Narrowing filter/find over the chunk union (Array.filter/find alone do not narrow).
function chunksOf<T extends GrokPrintChunk["type"]>(
  chunks: GrokPrintChunk[],
  type: T,
): GrokChunkOf<T>[] {
  return chunks.filter((chunk): chunk is GrokChunkOf<T> => chunk.type === type)
}
function chunkOf<T extends GrokPrintChunk["type"]>(
  chunks: GrokPrintChunk[],
  type: T,
): GrokChunkOf<T> | undefined {
  return chunks.find((chunk): chunk is GrokChunkOf<T> => chunk.type === type)
}

function runTurn(
  mode?: string,
  promptFileText?: string,
  extraArgs?: string[],
): {
  chunks: GrokPrintChunk[]
  usages: GrokUsage[]
  done: ReturnType<typeof runGrokPrintTurn>["done"]
  interrupt: () => void
  seenSessionId: () => string | undefined
} {
  const chunks: GrokPrintChunk[] = []
  const usages: GrokUsage[] = []
  let seenId: string | undefined
  const turn = runGrokPrintTurn({
    command: process.execPath,
    args: [MOCK_PATH, ...(extraArgs ?? [])],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { GROK_MOCK_MODE: mode } : {}),
    },
    ...(promptFileText !== undefined ? { promptFileText } : {}),
    onChunk: (chunk) => chunks.push(chunk),
    onUsage: (usage) => usages.push(usage),
    onSessionId: (id) => {
      seenId = id
    },
  })
  return {
    chunks,
    usages,
    done: turn.done,
    interrupt: turn.interrupt,
    seenSessionId: () => seenId,
  }
}

it("maps a full turn: text, canonical tools, usage, end metadata", async () => {
  const { chunks, usages, done, seenSessionId } = runTurn()
  const result = await done
  assert.equal(result.status, "completed")
  assert.equal(result.sessionId, "ses-grok-1")
  assert.equal(seenSessionId(), "ses-grok-1")
  assert.equal(result.stopReason, "end_turn")
  assert.equal(result.numTurns, 2)
  const deltas = chunksOf(chunks, "text-delta").map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["Hello ", "done."])
  // thought + available_commands are suppressed, not text.
  assert.ok(!deltas.join("").includes("internal reasoning"))
  const input = chunkOf(chunks, "tool-input-available")
  assert.ok(input, "expected a tool-input-available chunk")
  assert.equal(input.toolName, "Read")
  assert.deepEqual(input.input, { path: "README.md" })
  const output = chunkOf(chunks, "tool-output-available")
  assert.ok(output, "expected a tool-output-available chunk")
  assert.deepEqual(output.output, { lines: 42 })
  assert.equal(usages.length, 1)
  // End usage wins over summed line usage.
  assert.deepEqual(result.usage, {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadInputTokens: undefined,
    cacheCreationInputTokens: undefined,
    reasoningTokens: undefined,
    totalTokens: 120,
  })
})

it("ignores progress updates and emits tool output at most once", async () => {
  const { chunks, done } = runTurn("progress-update")
  const result = await done
  assert.equal(result.status, "completed")
  const inputs = chunksOf(chunks, "tool-input-available")
  assert.equal(inputs.length, 1)
  assert.equal(inputs[0].toolName, "Bash")
  const outputs = chunksOf(chunks, "tool-output-available")
  assert.equal(outputs.length, 1)
  assert.deepEqual(outputs[0].output, { exitCode: 0 })
})

it("surfaces failed tools as error outputs", async () => {
  const { chunks, done } = runTurn("failed-tool")
  const result = await done
  assert.equal(result.status, "completed")
  const output = chunkOf(chunks, "tool-output-available")
  assert.ok(output, "expected a tool-output-available chunk")
  assert.deepEqual(output.output, { error: "invalid regex" })
})

it("correlates tools without call_id oldest-open-first", async () => {
  const { chunks, done } = runTurn("no-call-id")
  const result = await done
  assert.equal(result.status, "completed")
  const input = chunkOf(chunks, "tool-input-available")
  const output = chunkOf(chunks, "tool-output-available")
  assert.ok(input, "expected a tool-input-available chunk")
  assert.ok(output, "expected a tool-output-available chunk")
  assert.equal(input.toolName, "LS")
  assert.equal(output.toolCallId, input.toolCallId)
  assert.deepEqual(output.output, { entries: 3 })
})

it("renders plan entries as text lines", async () => {
  const { chunks, done } = runTurn("plan")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunksOf(chunks, "text-delta").map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["Planning. ", "Plan:\n- Add jwtVerify helper\n- Replace session check"])
})

it("maps refusal and cancellation stop reasons", async () => {
  const refused = runTurn("refused")
  const refusedResult = await refused.done
  assert.equal(refusedResult.status, "error")
  assert.ok(refused.chunks.some((chunk) => chunk.type === "error"))
  const cancelled = runTurn("cancelled")
  const cancelledResult = await cancelled.done
  assert.equal(cancelledResult.status, "interrupted")
  assert.equal(cancelledResult.sessionId, "ses-grok-1")
})

it("fails on nonzero exit with stderr detail", async () => {
  const { chunks, done } = runTurn("error-exit")
  const result = await done
  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("quota exceeded"))
  assert.ok(chunks.some((chunk) => chunk.type === "error"))
})

it("fails on error events", async () => {
  const { done } = runTurn("error-event")
  const result = await done
  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "mock event failure")
  assert.equal(result.sessionId, "ses-grok-1")
})

it("settles interrupted on interrupt()", async () => {
  const { done, interrupt } = runTurn("never")
  interrupt()
  const result = await done
  assert.equal(result.status, "interrupted")
})

it("splices --prompt-file content through a temp file", async () => {
  const { chunks, done } = runTurn("prompt-file", "hello-prompt", ["--prompt-file"])
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunksOf(chunks, "text-delta").map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["file:12:", "hello-prompt"])
})

it("flushes a final line without a trailing newline", async () => {
  const { chunks, done } = runTurn("no-trailing-newline")
  const result = await done
  assert.equal(result.status, "completed")
  const deltas = chunksOf(chunks, "text-delta").map((chunk) => chunk.delta)
  assert.deepEqual(deltas, ["tail"])
})

it("sums usage lines when end carries no usage", async () => {
  const { done } = runTurn("usage-lines")
  const result = await done
  assert.equal(result.status, "completed")
  assert.equal(result.usage?.inputTokens, 110)
  assert.equal(result.usage?.outputTokens, 25)
})

it("correlates multiple id-less tools oldest-open-first without loss", async () => {
  const { chunks, done } = runTurn("no-call-id-multi")
  const result = await done
  assert.equal(result.status, "completed")
  const outputs = chunksOf(chunks, "tool-output-available")
  assert.equal(outputs.length, 2)
  // Progress update did not consume an id: outputs attach A then B.
  const inputs = chunksOf(chunks, "tool-input-available")
  assert.deepEqual(
    outputs.map((chunk) => chunk.toolCallId),
    inputs.map((chunk) => chunk.toolCallId),
  )
  assert.deepEqual(
    outputs.map((chunk) => chunk.output),
    [{ n: 1 }, { n: 2 }],
  )
})

it("keeps frozen spend on refusal ends", async () => {
  const { done } = runTurn("refused")
  const result = await done
  assert.equal(result.status, "error")
  assert.equal(result.usage?.inputTokens, 100)
  assert.equal(result.usage?.outputTokens, 20)
})

it("resolves nested use_tool names on the first __ split", async () => {
  const { chunks, done } = runTurn("nested-mcp")
  const result = await done
  assert.equal(result.status, "completed")
  const input = chunkOf(chunks, "tool-input-available")
  assert.ok(input, "expected a tool-input-available chunk")
  assert.equal(input.toolName, "mcp__gh__repos__create")
})
