/**
 * openclaw-print turn tests against the mock `agent exec` script:
 * success projection from the documented stable envelope (stdin
 * carriage proven by echo), live-captured auth/timeout/unknown-model
 * envelopes, stderr tolerance, empty/garbage output, interrupt, and
 * completion ownership (no finish/metadata from the runner).
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, it } from "@effect/vitest"
import { type OpenclawPrintChunk, runOpenclawPrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "openclaw-print-mock.mjs",
)

function runTurn(
  mode?: string,
  prompt = "probe prompt",
): {
  chunks: OpenclawPrintChunk[]
  done: ReturnType<typeof runOpenclawPrintTurn>["done"]
  interrupt: () => void
} {
  const chunks: OpenclawPrintChunk[] = []
  const turn = runOpenclawPrintTurn({
    command: process.execPath,
    args: [MOCK_PATH],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { OPENCLAW_MOCK_MODE: mode } : {}),
    },
    prompt,
    onChunk: (chunk) => chunks.push(chunk),
  })
  return { chunks, done: turn.done, interrupt: turn.interrupt }
}

it("projects success as one text triple at settle, with usage", async () => {
  const { chunks, done } = runTurn()
  const result = await done

  assert.equal(result.status, "completed")
  assert.equal(result.stopReason, "ok")
  assert.equal(result.sessionId, "019mock-session-id")
  assert.equal(result.usage?.inputTokens, 120)
  assert.equal(result.usage?.outputTokens, 8)
  assert.equal(result.usage?.totalTokens, 128)
  assert.equal(result.costUsd, 0.0021)
  assert.equal(result.numTurns, 2)
  assert.equal(result.toolCallCount, 2)
  assert.deepEqual(result.toolNames, ["read", "write"])
  assert.equal(result.model, "gpt-5.6-sol")
  assert.equal(result.provider, "openai")

  // Stdin carriage: the mock echoes the prompt it received.
  const starts = chunks.filter((c) => c.type === "text-start")
  const deltas = chunks.filter((c) => c.type === "text-delta")
  const ends = chunks.filter((c) => c.type === "text-end")
  assert.equal(starts.length, 1)
  assert.equal(deltas.length, 1)
  assert.equal(ends.length, 1)
  assert.equal(starts[0].id, ends[0].id)
  assert.equal(deltas[0].id, starts[0].id)
  assert.equal(deltas[0].delta, "Echo: probe prompt")

  // Completion ownership: no finish/metadata from the runner.
  assert.ok(chunks.every((c) => c.type !== "finish"))
  assert.ok(chunks.every((c) => c.type !== "message-metadata"))
})

it("surfaces the live auth envelope as a held error chunk (no finish)", async () => {
  const { chunks, done } = runTurn("auth-error")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.stopReason, "error")
  assert.equal(
    result.errorMessage,
    "No route-compatible authentication source is configured for openai.",
  )
  const errors = chunks.filter((c) => c.type === "error")
  assert.equal(errors.length, 1)
  assert.equal(
    errors[0].errorText,
    "No route-compatible authentication source is configured for openai.",
  )
  assert.ok(chunks.every((c) => c.type !== "finish"))
})

it("reports timeouts with the timeout stop reason", async () => {
  const { chunks, done } = runTurn("timeout")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.stopReason, "timeout")
  assert.equal(result.errorMessage, "LLM request failed: network connection error.")
  assert.ok(chunks.some((c) => c.type === "error"))
})

it("reports unknown-model envelopes verbatim for the router retry", async () => {
  const { done } = runTurn("unknown-model")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(result.errorMessage, "Unknown model: bogus/nope")
})

it("tolerates stderr diagnostics beside a failure envelope", async () => {
  const { done } = runTurn("stderr-noise")
  const result = await done

  assert.equal(result.status, "error")
  assert.equal(
    result.errorMessage,
    "No route-compatible authentication source is configured for openai.",
  )
})

it("treats empty stdout as an error (nothing streamed to keep)", async () => {
  const { done } = runTurn("empty")
  const result = await done

  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("no output"))
})

it("treats unparseable stdout as an error", async () => {
  const { done } = runTurn("garbage")
  const result = await done

  assert.equal(result.status, "error")
  assert.ok(result.errorMessage?.includes("unparseable"))
})

it("interrupts a hanging turn", async () => {
  const { done, interrupt } = runTurn("hang")
  setTimeout(interrupt, 300)
  const result = await done
  assert.equal(result.status, "interrupted")
})
