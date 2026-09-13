/**
 * cline-print turn tests against the mock `cline` script: text-turn
 * projection from the REAL captured fixture, tool round-trip
 * projection, error/timeout/CLI-error envelopes, stderr JSON errors,
 * hook-noise tolerance, exit-code independence, interrupt, and
 * trailing-line flush.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, it } from "@effect/vitest"
import { type ClinePrintChunk, runClinePrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "cline-print-mock.mjs",
)

function runTurn(mode?: string): {
  chunks: ClinePrintChunk[]
  done: ReturnType<typeof runClinePrintTurn>["done"]
  interrupt: () => void
} {
  const chunks: ClinePrintChunk[] = []
  const turn = runClinePrintTurn({
    command: process.execPath,
    args: [MOCK_PATH],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { CLINE_MOCK_MODE: mode } : {}),
    },
    onChunk: (chunk) => chunks.push(chunk),
  })
  return { chunks, done: turn.done, interrupt: turn.interrupt }
}

it("projects the captured text turn: deltas, close, usage, completion", async () => {
  const { chunks, done } = runTurn()
  const result = await done

  assert.equal(result.status, "completed")
  assert.equal(result.stopReason, "completed")
  assert.equal(result.usage?.inputTokens, 100)
  assert.equal(result.usage?.outputTokens, 20)
  assert.equal(result.numTurns, 1)

  const starts = chunks.filter((c) => c.type === "text-start")
  const deltas = chunks.filter((c) => c.type === "text-delta")
  const ends = chunks.filter((c) => c.type === "text-end")
  assert.equal(starts.length, 1)
  assert.equal(ends.length, 1)
  assert.equal(starts[0].id, ends[0].id)
  assert.ok(deltas.length >= 7)
  assert.ok(deltas.every((d) => d.id === starts[0].id))
  assert.equal(deltas.map((d) => d.delta).join(""), "Hello from the stub model! Canned response. ")

  // Completion ownership: no finish/metadata from the runner.
  assert.ok(chunks.every((c) => c.type !== "finish"))
  assert.ok(chunks.every((c) => c.type !== "message-metadata"))
})

it("projects tool calls as input-available + output-available pairs", async () => {
  const { chunks, done } = runTurn("tool")
  const result = await done

  assert.equal(result.status, "completed")
  assert.equal(result.numTurns, 2)

  const inputs = chunks.filter((c) => c.type === "tool-input-available")
  const outputs = chunks.filter((c) => c.type === "tool-output-available")
  assert.equal(inputs.length, 1)
  assert.equal(outputs.length, 1)
  assert.equal(inputs[0].toolCallId, "call_1")
  assert.equal(inputs[0].toolName, "read_files")
  assert.equal(outputs[0].toolCallId, "call_1")
  assert.ok(Array.isArray(outputs[0].output))
  assert.equal(outputs[0].output[0].success, true)
})

it("surfaces auth failures as a held error chunk (no finish)", async () => {
  const { chunks, done } = runTurn("auth-error")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "Incorrect API key provided")
  const errors = chunks.filter((c) => c.type === "error")
  assert.equal(errors.length, 1)
  assert.equal(errors[0].errorText, "Incorrect API key provided")
  assert.ok(chunks.every((c) => c.type !== "finish"))
})

it("reports timeouts from the trailing error echo", async () => {
  const { chunks, done } = runTurn("timeout")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.stopReason, "aborted")
  assert.equal(result.errorMessage, "run timed out after 4s")
  assert.ok(chunks.some((c) => c.type === "error"))
})

it("turns CLI-level errors into turn errors (exit 0)", async () => {
  const { done } = runTurn("cli-error")
  const result = await done

  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("requires a prompt argument"))
})

it("parses JSON error lines from stderr", async () => {
  const { done } = runTurn("stderr-error")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "unknown certificate verification error")
})

it("ignores hub hook-dispatch noise", async () => {
  const { done } = runTurn("hook-noise")
  const result = await done

  assert.equal(result.status, "completed")
})

it("interrupts a hanging turn", async () => {
  const { done, interrupt } = runTurn("hang")
  setTimeout(interrupt, 300)
  const result = await done

  assert.equal(result.status, "interrupted")
})
