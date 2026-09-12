/**
 * qwen-print turn tests against the mock `qwen` script: full turn
 * projection (assistant text, canonical tool renames, session-init),
 * completion ownership (no projector finish/metadata), zero-usage
 * stripping, permission-denial surfacing, MCP status mapping, streamed
 * tool dedupe, error envelopes, exit codes (53/55/generic), interrupt,
 * and trailing-line flush.
 */

import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, it } from "@effect/vitest"
import { premapQwenLine, runQwenPrintTurn } from "./session"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "qwen-print-mock.mjs",
)

function runTurn(mode?: string): {
  chunks: any[]
  done: ReturnType<typeof runQwenPrintTurn>["done"]
  interrupt: () => void
  seenSessionId: () => string | undefined
} {
  const chunks: any[] = []
  let seenId: string | undefined
  const turn = runQwenPrintTurn({
    command: process.execPath,
    args: [MOCK_PATH],
    cwd: process.cwd(),
    env: {
      ...(process.env as Record<string, string>),
      ...(mode ? { QWEN_MOCK_MODE: mode } : {}),
    },
    onChunk: (chunk) => chunks.push(chunk),
    onSessionId: (id) => {
      seenId = id
    },
  })
  return {
    chunks,
    done: turn.done,
    interrupt: turn.interrupt,
    seenSessionId: () => seenId,
  }
}

it("maps a full turn: text, canonical tools, no projector finish", async () => {
  const { chunks, done, seenSessionId } = runTurn()
  const result = await done
  assert.strictEqual(result.status, "completed")
  assert.strictEqual(result.sessionId, "123e4567-e89b-12d3-a456-426614174000")
  assert.strictEqual(seenSessionId(), result.sessionId)
  assert.strictEqual(result.usage?.inputTokens, 100)
  assert.strictEqual(result.usage?.outputTokens, 20)
  assert.strictEqual(result.numTurns, 1)

  const types = chunks.map((c) => c.type)
  // Completion ownership: the router emits metadata + finish itself.
  assert.ok(!types.includes("finish"))
  assert.ok(!types.includes("finish-step"))
  assert.ok(!types.includes("message-metadata"))
  assert.ok(types.includes("session-init"))
  assert.ok(types.includes("text-delta"))

  const toolCall = chunks.find((c) => c.type === "tool-input-available")
  // run_shell_command -> canonical Bash (display-only rename).
  assert.strictEqual(toolCall.toolName, "Bash")
  const toolOut = chunks.find((c) => c.type === "tool-output-available")
  assert.strictEqual(toolOut.toolCallId, toolCall.toolCallId)

  const text = chunks
    .filter((c) => c.type === "text-delta")
    .map((c) => c.delta)
    .join("")
  assert.ok(text.includes("Hello. "))
})

it("dedupes streamed tool input against the assistant message", async () => {
  const { chunks, done } = runTurn("partial-tool")
  const result = await done
  assert.strictEqual(result.status, "completed")
  const available = chunks.filter((c) => c.type === "tool-input-available")
  assert.strictEqual(available.length, 1)
  assert.strictEqual(available[0].toolName, "Read")
  const outputs = chunks.filter((c) => c.type === "tool-output-available")
  assert.strictEqual(outputs.length, 1)
})

it("strips zeroed assistant usage so result usage wins", async () => {
  const { done } = runTurn("zero-usage")
  const result = await done
  assert.strictEqual(result.status, "completed")
  assert.strictEqual(result.usage?.inputTokens, 100)
  assert.strictEqual(result.usage?.outputTokens, 20)
})

it("surfaces permission denials as visible text", async () => {
  const { chunks, done } = runTurn("denials")
  const result = await done
  assert.strictEqual(result.status, "completed")
  const denial = chunks.find(
    (c) =>
      c.type === "text-delta" &&
      typeof c.delta === "string" &&
      c.delta.includes("Permission denied"),
  )
  assert.ok(denial)
  assert.ok(denial.delta.includes("write_file"))
  const renamed = chunks.find((c) => c.type === "tool-input-available")
  assert.strictEqual(renamed.toolName, "Write")
})

it("maps disconnected MCP servers to failed in session-init", async () => {
  const { chunks, done } = runTurn("mcp-status")
  await done
  const init = chunks.find((c) => c.type === "session-init")
  assert.ok(init)
  const byName = Object.fromEntries((init.mcpServers as any[]).map((s) => [s.name, s.status]))
  assert.strictEqual(byName.ok, "connected")
  assert.strictEqual(byName.down, "failed")
})

it("turns error envelopes into held error chunks (no finish)", async () => {
  const { chunks, done } = runTurn("error-envelope")
  const result = await done
  assert.strictEqual(result.status, "error")
  assert.ok(result.errorMessage?.includes("Missing API key"))
  const errorChunk = chunks.find((c) => c.type === "error")
  assert.ok(errorChunk)
  assert.ok(!chunks.map((c) => c.type).includes("finish"))
})

it("reports stderr diagnostics when the CLI exits nonzero", async () => {
  const { done } = runTurn("error-exit")
  const result = await done
  assert.strictEqual(result.status, "error")
  assert.ok(result.errorMessage?.includes("mock failure"))
})

it("maps exit 53/55 to budget errors", async () => {
  const turns = await runTurn("exit-53").done
  assert.strictEqual(turns.status, "error")
  assert.ok(turns.errorMessage?.includes("53"))
  const budget = await runTurn("exit-55").done
  assert.strictEqual(budget.status, "error")
  assert.ok(budget.errorMessage?.includes("55"))
})

it("interrupts a hanging turn via SIGINT escalation", async () => {
  const { done, interrupt } = runTurn("never")
  setTimeout(interrupt, 200)
  const result = await done
  assert.strictEqual(result.status, "interrupted")
  assert.strictEqual(result.sessionId, "123e4567-e89b-12d3-a456-426614174000")
})

it("flushes a trailing line without a newline", async () => {
  const { done } = runTurn("trailing-no-newline")
  const result = await done
  assert.strictEqual(result.status, "completed")
  assert.strictEqual(result.sessionId, "123e4567-e89b-12d3-a456-426614174000")
})

it("premapQwenLine renames streamed tool_use blocks", () => {
  const line = {
    type: "stream_event",
    event: {
      type: "content_block_start",
      content_block: { type: "tool_use", id: "c1", name: "grep_search" },
    },
  }
  premapQwenLine(line as any)
  assert.strictEqual((line.event.content_block as { name: string }).name, "Grep")
})

it("premapQwenLine passes MCP tool names through untouched", () => {
  const line = {
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "c1", name: "mcp__stub__echo" }],
    },
  }
  premapQwenLine(line as any)
  assert.strictEqual(((line.message as any).content[0] as { name: string }).name, "mcp__stub__echo")
})
