/**
 * Mock `roo -p --output-format stream-json` for roo-print turn tests.
 * Emits NDJSON events shaped per the source-verified emitter
 * (packages/types/src/cli.ts + agent/json-event-emitter.ts).
 * Modes via ROO_MOCK_MODE.
 */
const mode = process.env.ROO_MOCK_MODE || "success"

const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)

if (mode === "no-key") {
  process.stderr.write(
    "[CLI] Error: No API key provided. Use --api-key or set the appropriate environment variable.\n",
  )
  process.stderr.write("[CLI] For openrouter, set OPENROUTER_API_KEY\n")
  process.exit(1)
}

if (mode === "error-event") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  line({ type: "error", id: 11, content: "API request failed: overloaded" })
  process.exit(1)
}

if (mode === "result-failure") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  line({ type: "assistant", id: 21, content: "I tried but", done: false })
  line({ type: "assistant", id: 21, content: "I tried but failed.", done: true })
  line({ type: "result", id: 22, content: "Task failed: stuck", done: true, success: false })
  process.exit(1)
}

if (mode === "no-result") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  process.exit(1)
}

if (mode === "garbage") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  process.stdout.write("this is not json\n")
  line({ type: "result", id: 31, content: "done", done: true, success: true })
  process.exit(0)
}

if (mode === "hang") {
  // Never emits result; the test interrupts us (SIGINT must settle).
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  setInterval(() => {}, 1000)
  process.on("SIGINT", () => process.exit(130))
}

if (mode === "result-only") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
  })
  line({
    type: "result",
    id: 41,
    content: "Completed without streaming.",
    done: true,
    success: true,
    cost: { totalCost: 0.001, inputTokens: 10, outputTokens: 5, cacheWrites: 0, cacheReads: 2 },
  })
  process.exit(0)
}

// Default: full success turn.
if (mode === "success") {
  line({
    type: "system",
    subtype: "init",
    content: "Task started",
    schemaVersion: 1,
    protocol: "roo-cli-stream",
    capabilities: ["stdin:start", "message", "cancel", "ping", "shutdown"],
  })
  line({ type: "user", id: 100, content: "probe prompt", done: true })
  line({ type: "assistant", id: 101, content: "I'll read " })
  line({ type: "assistant", content: "the file." })
  line({ type: "assistant", id: 101, content: "I'll read the file.", done: true })
  line({ type: "thinking", id: 102, content: "planning", done: false })
  line({ type: "thinking", id: 102, content: "planning approach", done: true })
  line({
    type: "tool_use",
    id: 200,
    subtype: "tool",
    tool_use: { name: "read_file", input: { path: "a.txt" } },
    done: true,
  })
  line({
    type: "tool_use",
    id: 201,
    subtype: "command",
    tool_use: { name: "execute_command", input: { command: "ls" } },
    done: true,
  })
  line({
    type: "tool_result",
    id: 201,
    subtype: "command",
    tool_result: { name: "execute_command", output: "a.txt\n" },
  })
  line({
    type: "tool_result",
    id: 201,
    subtype: "command",
    tool_result: { name: "execute_command", output: "b.txt\n", exitCode: 0 },
    done: true,
  })
  line({
    type: "tool_use",
    id: 202,
    subtype: "mcp",
    tool_use: { name: "mcp_server", input: { raw: "call fs/read" } },
    done: true,
  })
  line({
    type: "tool_result",
    subtype: "mcp",
    tool_result: { name: "mcp_server", output: "file contents" },
    done: true,
  })
  line({
    type: "result",
    id: 300,
    content: "I'll read the file.",
    done: true,
    success: true,
    taskId: "task-mock-1",
    cost: { totalCost: 0.0042, inputTokens: 120, outputTokens: 8, cacheWrites: 1, cacheReads: 3 },
  })
  // taskId must also be picked up when carried on the result event.
  process.exit(0)
}
