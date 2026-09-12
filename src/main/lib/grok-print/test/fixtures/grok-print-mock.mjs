#!/usr/bin/env node
/**
 * mausCode-authored mock of `grok -p --output-format streaming-json`.
 * Plays scripted NDJSON per GROK_MOCK_MODE; records argv for assertions.
 */
import { appendFileSync, readFileSync } from "node:fs"

const mode = process.env.GROK_MOCK_MODE ?? "default"
const recordTo = process.env.GROK_MOCK_RECORD
if (recordTo) {
  appendFileSync(recordTo, `${JSON.stringify(process.argv.slice(2))}\n`)
}

const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const SID = "ses-grok-1"

const end = (overrides = {}) =>
  line({
    type: "end",
    stopReason: "end_turn",
    sessionId: SID,
    requestId: "req-1",
    num_turns: 2,
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    ...overrides,
  })

if (mode === "never") {
  line({ type: "text", data: "started " })
  setInterval(() => {}, 1000)
} else if (mode === "error-exit") {
  process.stderr.write("mock failure: quota exceeded\n")
  process.exitCode = 1
} else if (mode === "error-event") {
  line({ type: "text", data: "partial " })
  line({ type: "error", message: "mock event failure", sessionId: SID })
} else if (mode === "progress-update") {
  line({
    type: "tool_call",
    toolCallId: "call-1",
    title: "Run tests",
    kind: "exec",
    status: "in_progress",
    toolName: "run_terminal_cmd",
    rawInput: { command: "bun test" },
    content: [],
    locations: [],
  })
  // Progress update: no result payload, must not emit tool-output.
  line({ type: "tool_call_update", toolCallId: "call-1", status: "in_progress" })
  line({
    type: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    rawOutput: { exitCode: 0 },
    content: [],
    locations: [],
  })
  // Duplicate terminal: must be ignored (at-most-once output).
  line({
    type: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    rawOutput: { exitCode: 0 },
    content: [],
    locations: [],
  })
  end()
} else if (mode === "failed-tool") {
  line({
    type: "tool_call",
    toolCallId: "call-f",
    title: "Search",
    kind: "search",
    status: "in_progress",
    toolName: "grep",
    rawInput: { pattern: "(" },
    content: [],
    locations: [],
  })
  line({
    type: "tool_call_update",
    toolCallId: "call-f",
    status: "failed",
    rawOutput: { message: "invalid regex" },
    content: [],
    locations: [],
  })
  end()
} else if (mode === "no-call-id") {
  line({
    type: "tool_call",
    title: "List",
    kind: "read",
    status: "in_progress",
    toolName: "list_dir",
    rawInput: { path: "." },
    content: [],
    locations: [],
  })
  line({
    type: "tool_call_update",
    status: "completed",
    rawOutput: { entries: 3 },
    content: [],
    locations: [],
  })
  end()
} else if (mode === "no-call-id-multi") {
  for (const name of ["list_dir", "read_file"]) {
    line({ type: "tool_call", title: name, toolName: name, rawInput: {} })
  }
  line({ type: "tool_call_update", status: "progress" })
  for (const n of [1, 2]) {
    line({
      type: "tool_call_update",
      status: "completed",
      rawOutput: { n },
    })
  }
  end()
} else if (mode === "nested-mcp") {
  line({
    type: "tool_call",
    title: "MCP",
    toolName: "use_tool",
    rawInput: { target: "gh__repos__create" },
  })
  line({
    type: "tool_call_update",
    status: "completed",
    rawOutput: { ok: true },
  })
  end()
} else if (mode === "plan") {
  line({ type: "text", data: "Planning. " })
  line({
    type: "plan",
    entries: ["Add jwtVerify helper", { title: "Replace session check" }, 42],
  })
  end()
} else if (mode === "refused") {
  end({ stopReason: "refusal" })
} else if (mode === "cancelled") {
  end({ stopReason: "cancelled" })
} else if (mode === "prompt-file") {
  const args = process.argv.slice(2)
  const flagIndex = args.indexOf("--prompt-file")
  const promptPath = flagIndex >= 0 ? args[flagIndex + 1] : null
  const content = promptPath ? readFileSync(promptPath, "utf8") : "<missing>"
  line({ type: "text", data: `file:${content.length}:` })
  line({ type: "text", data: content })
  end()
} else if (mode === "no-trailing-newline") {
  line({ type: "text", data: "tail" })
  process.stdout.write(JSON.stringify({ type: "end", stopReason: "end_turn", sessionId: SID }))
} else if (mode === "usage-lines") {
  line({
    type: "usage",
    messageId: "resp_1",
    stopReason: "tool_use",
    usage: { input_tokens: 50, output_tokens: 10 },
  })
  line({
    type: "usage",
    messageId: "resp_2",
    stopReason: "end_turn",
    usage: { input_tokens: 60, output_tokens: 15 },
  })
  // No usage on end: summed line usage must be reported.
  line({ type: "end", stopReason: "end_turn", sessionId: SID })
} else {
  line({ type: "available_commands", tools: ["read_file"], commands: [] })
  line({ type: "thought", data: "internal reasoning" })
  line({ type: "text", data: "Hello " })
  line({
    type: "tool_call",
    toolCallId: "call-1",
    title: "Read",
    kind: "read",
    status: "in_progress",
    toolName: "read_file",
    rawInput: { path: "README.md" },
    content: [],
    locations: [],
  })
  line({
    type: "tool_call_update",
    toolCallId: "call-1",
    status: "completed",
    rawOutput: { lines: 42 },
    content: [],
    locations: [],
  })
  line({ type: "text", data: "done." })
  line({
    type: "usage",
    messageId: "resp_1",
    stopReason: "end_turn",
    usage: { input_tokens: 812, output_tokens: 45 },
  })
  end()
}
