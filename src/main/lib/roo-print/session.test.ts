/**
 * roo-print turn tests against the mock stream-json script: text
 * delta dedupe, Thinking protocol, tool/command/mcp projection, mcp
 * id-less correlation, result-content guard, error/result-failure
 * paths, garbage tolerance, interrupt, and completion ownership (no
 * finish/metadata from the runner).
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, it } from "@effect/vitest"
import { runRooPrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "roo-print-mock.mjs",
)

function runTurn(mode?: string): {
  chunks: any[]
  done: ReturnType<typeof runRooPrintTurn>["done"]
  interrupt: () => void
} {
  const chunks: any[] = []
  const turn = runRooPrintTurn({
    command: process.execPath,
    args: [MOCK_PATH],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { ROO_MOCK_MODE: mode } : {}),
    },
    onChunk: (chunk) => chunks.push(chunk),
  })
  return { chunks, done: turn.done, interrupt: turn.interrupt }
}

const textOf = (chunks: any[]) =>
  chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.delta)
    .join("")

it("projects a full turn: deduped text, thinking, tools, usage", async () => {
  const { chunks, done } = runTurn()
  const result = await done

  assert.equal(result.status, "completed")
  assert.equal(result.stopReason, "result")
  assert.equal(result.sessionId, "task-mock-1")
  assert.equal(result.usage?.inputTokens, 120)
  assert.equal(result.usage?.outputTokens, 8)
  assert.equal(result.usage?.totalTokens, 128)
  assert.equal(result.usage?.cacheReadInputTokens, 3)
  assert.equal(result.usage?.cacheCreationInputTokens, 1)
  assert.equal(result.usage?.costUsd, 0.0042)

  // Partials + full final dedupe to exactly one copy; the
  // result.content duplicate is suppressed (guard).
  assert.equal(textOf(chunks), "I'll read the file.")

  const starts = chunks.filter((c) => c.type === "text-start")
  const ends = chunks.filter((c) => c.type === "text-end")
  assert.equal(starts.length, 1)
  assert.equal(ends.length, 1)
  assert.equal(starts[0].id, ends[0].id)

  // Thinking tool protocol mirrors the claude path.
  const thinkingStart = chunks.find((c) => c.type === "tool-input-start")
  assert.equal(thinkingStart.toolName, "Thinking")
  const thinkingAvailable = chunks.find(
    (c) => c.type === "tool-input-available" && c.toolCallId === thinkingStart.toolCallId,
  )
  assert.equal(thinkingAvailable.input.text, "planning approach")

  // Generic tool: exactly one input, closed without synthesis.
  const genericInputs = chunks.filter(
    (c) => c.type === "tool-input-available" && c.toolCallId === "roo-tool-200",
  )
  assert.equal(genericInputs.length, 1)
  assert.equal(genericInputs[0].toolName, "read_file")
  const genericOutputs = chunks.filter(
    (c) => c.type === "tool-output-available" && c.toolCallId === "roo-tool-200",
  )
  assert.equal(genericOutputs.length, 1)
  assert.equal(genericOutputs[0].output, undefined)

  // Command: input once, streaming outputs accumulate full-to-date.
  const commandOutputs = chunks.filter(
    (c) => c.type === "tool-output-available" && c.toolCallId === "roo-tool-201",
  )
  assert.equal(commandOutputs.length, 2)
  assert.equal(commandOutputs[1].output, "a.txt\nb.txt\n")

  // Id-less mcp result attaches to the open mcp call.
  const mcpOutputs = chunks.filter(
    (c) => c.type === "tool-output-available" && c.toolCallId === "roo-tool-202",
  )
  assert.equal(mcpOutputs.length, 1)
  assert.equal(mcpOutputs[0].output, "file contents")

  // Completion ownership: no finish/metadata from the runner.
  assert.ok(!chunks.some((c) => c.type === "finish"))
  assert.ok(!chunks.some((c) => c.type === "message-metadata"))
})

it("projects result.content as text only when nothing streamed", async () => {
  const { chunks, done } = runTurn("result-only")
  const result = await done
  assert.equal(result.status, "completed")
  assert.equal(textOf(chunks), "Completed without streaming.")
})

it("surfaces error events as held error chunks", async () => {
  const { chunks, done } = runTurn("error-event")
  const result = await done
  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "API request failed: overloaded")
  const errors = chunks.filter((c) => c.type === "error")
  assert.equal(errors.length, 1)
  assert.ok(!chunks.some((c) => c.type === "finish"))
})

it("fails result.success=false turns with the result content", async () => {
  const { chunks, done } = runTurn("result-failure")
  const result = await done
  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "Task failed: stuck")
  assert.ok(chunks.some((c) => c.type === "error"))
})

it("errors when the CLI exits with stderr and no result", async () => {
  const { done } = runTurn("no-key")
  const result = await done
  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("No API key provided"))
})

it("errors when the CLI exits with no result and no stderr", async () => {
  const { done } = runTurn("no-result")
  const result = await done
  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("no result"))
})

it("surfaces garbage stdout verbatim and still completes", async () => {
  const { chunks, done } = runTurn("garbage")
  const result = await done
  assert.equal(result.status, "completed")
  assert.ok(textOf(chunks).includes("this is not json"))
})

it("settles interrupted on SIGINT", async () => {
  const { done, interrupt } = runTurn("hang")
  setTimeout(interrupt, 300)
  const result = await done
  assert.equal(result.status, "interrupted")
})
