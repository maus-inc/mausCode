#!/usr/bin/env node
/**
 * mausCode-authored mock of `agent -p --output-format stream-json`.
 * Plays scripted NDJSON per CURSOR_MOCK_MODE; records argv for assertions.
 */
import { appendFileSync } from "node:fs"

const mode = process.env.CURSOR_MOCK_MODE ?? "default"
const recordTo = process.env.CURSOR_MOCK_RECORD
if (recordTo) {
  appendFileSync(recordTo, `${JSON.stringify(process.argv.slice(2))}\n`)
}

const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const SID = "ses-mock-1"

const init = {
  type: "system",
  subtype: "init",
  apiKeySource: "login",
  cwd: process.cwd(),
  session_id: SID,
  model: "Mock Model",
  permissionMode: "default",
}

if (mode === "never") {
  line(init)
  setInterval(() => {}, 1000)
} else if (mode === "error-exit") {
  line(init)
  process.stderr.write("mock failure: quota exceeded\n")
  process.exitCode = 3
} else if (mode === "error-result") {
  line(init)
  line({
    type: "result",
    subtype: "error",
    is_error: true,
    duration_ms: 5,
    result: "mock result failure",
    session_id: SID,
  })
} else if (mode === "snapshot") {
  line(init)
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first segment " }],
    },
    session_id: SID,
  })
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first segment second segment" }],
    },
    session_id: SID,
  })
  // Final flush repeats everything: must add nothing.
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first segment second segment" }],
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    result: "first segment second segment",
    session_id: SID,
  })
} else if (mode === "snapshot-fresh") {
  line(init)
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "first part " }],
    },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "started",
    call_id: "call-r",
    tool_call: { readToolCall: { args: { path: "a.txt" } } },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-r",
    tool_call: {
      readToolCall: {
        args: { path: "a.txt" },
        result: { success: { content: "A" } },
      },
    },
    session_id: SID,
  })
  // Fresh message after the tool call: no shared prefix with "first part ".
  line({
    type: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "second part." }],
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    result: "two parts",
    session_id: SID,
  })
} else if (mode === "failed-tool") {
  line(init)
  line({
    type: "tool_call",
    subtype: "failed",
    call_id: "call-f",
    tool_call: {
      shellToolCall: {
        args: { command: "exit 1" },
        result: { error: "command failed" },
      },
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    result: "failed tool turn",
    session_id: SID,
  })
} else if (mode === "rejected") {
  line(init)
  line({
    type: "tool_call",
    subtype: "started",
    call_id: "call-del",
    tool_call: { deleteToolCall: { args: { path: "/tmp/x" } } },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-del",
    tool_call: {
      deleteToolCall: {
        args: { path: "/tmp/x" },
        result: { rejected: { reason: "needs approval" } },
      },
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    result: "rejected turn",
    session_id: SID,
  })
} else if (mode === "no-call-id") {
  line(init)
  line({
    type: "tool_call",
    subtype: "started",
    tool_call: { grepToolCall: { args: { pattern: "x", path: "." } } },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "completed",
    tool_call: {
      grepToolCall: {
        args: { pattern: "x", path: "." },
        result: { success: { matches: 1 } },
      },
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 5,
    result: "uncorrelated turn",
    session_id: SID,
  })
} else if (mode === "no-trailing-newline") {
  line(init)
  line({
    type: "assistant",
    timestamp_ms: 1,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "tail" }],
    },
    session_id: SID,
  })
  // Final event without a trailing newline must still be processed.
  process.stdout.write(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 5,
      result: "tail",
      session_id: SID,
    }),
  )
} else if (mode === "echo-stdin") {
  let text = ""
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (chunk) => {
    text += chunk
  })
  process.stdin.on("end", () => {
    line(init)
    line({
      type: "assistant",
      timestamp_ms: 1,
      message: {
        role: "assistant",
        content: [{ type: "text", text: `stdin:${text}` }],
      },
      session_id: SID,
    })
    line({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 5,
      result: "stdin turn",
      session_id: SID,
    })
  })
} else {
  line(init)
  line({
    type: "user",
    message: {
      role: "user",
      content: [{ type: "text", text: "hi" }],
    },
    session_id: SID,
  })
  line({
    type: "assistant",
    timestamp_ms: 1,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello " }],
    },
    session_id: SID,
  })
  // Buffered pre-tool flush: duplicate, must be skipped.
  line({
    type: "assistant",
    timestamp_ms: 2,
    model_call_id: "mc-1",
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Hello " }],
    },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "started",
    call_id: "call-1",
    tool_call: { readToolCall: { args: { path: "README.md" } } },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-1",
    tool_call: {
      readToolCall: {
        args: { path: "README.md" },
        result: { success: { content: "# Mock", totalLines: 1 } },
      },
    },
    session_id: SID,
  })
  line({
    type: "assistant",
    timestamp_ms: 3,
    message: {
      role: "assistant",
      content: [{ type: "text", text: "done." }],
    },
    session_id: SID,
  })
  // function-style tool call (generic shape).
  line({
    type: "tool_call",
    subtype: "started",
    call_id: "call-2",
    tool_call: {
      function: { name: "shell", arguments: '{"command":"ls"}' },
    },
    session_id: SID,
  })
  line({
    type: "tool_call",
    subtype: "completed",
    call_id: "call-2",
    tool_call: {
      function: {
        name: "shell",
        arguments: '{"command":"ls"}',
        result: { success: "a\nb" },
      },
    },
    session_id: SID,
  })
  line({
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 9,
    duration_api_ms: 9,
    result: "Hello done.",
    session_id: SID,
  })
}
