#!/usr/bin/env node
/**
 * mausCode-authored mock of `qwen --output-format stream-json`.
 * Plays scripted JSONL per QWEN_MOCK_MODE (claude-vocabulary envelopes,
 * matching live qwen-code v0.23.3 traces); records argv for assertions.
 */
import { appendFileSync } from "node:fs"

const mode = process.env.QWEN_MOCK_MODE ?? "default"
const recordTo = process.env.QWEN_MOCK_RECORD
if (recordTo) {
  appendFileSync(recordTo, `${JSON.stringify(process.argv.slice(2))}\n`)
}

const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const SID = "123e4567-e89b-12d3-a456-426614174000"

const init = (overrides = {}) =>
  line({
    type: "system",
    subtype: "init",
    uuid: "uuid-init",
    session_id: SID,
    cwd: "/tmp/mock",
    tools: ["read_file", "agent"],
    mcp_servers: [],
    model: "test-model",
    permission_mode: "auto",
    ...overrides,
  })

const result = (overrides = {}) =>
  line({
    type: "result",
    subtype: "success",
    uuid: "uuid-result",
    session_id: SID,
    is_error: false,
    duration_ms: 10,
    num_turns: 1,
    result: "done.",
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    permission_denials: [],
    ...overrides,
  })

if (mode === "never") {
  line({ type: "system", subtype: "init", uuid: "u", session_id: SID })
  setInterval(() => {}, 1000)
} else if (mode === "error-exit") {
  process.stderr.write("mock failure: boom\n")
  process.exitCode = 1
} else if (mode === "error-envelope") {
  init()
  line({
    type: "result",
    subtype: "error_during_execution",
    uuid: "uuid-err",
    session_id: SID,
    is_error: true,
    duration_ms: 5,
    num_turns: 0,
    usage: { input_tokens: 0, output_tokens: 0 },
    permission_denials: [],
    error: { message: "Missing API key for OpenAI-compatible auth." },
  })
} else if (mode === "malformed") {
  init()
  // `content` is truthy but not iterable: the assistant handler throws on
  // `for (const block of content)`, so the boundary catch has to settle the
  // turn instead of letting the throw escape the stdout callback.
  line({
    type: "assistant",
    uuid: "uuid-malformed",
    session_id: SID,
    message: { id: "m1", type: "message", role: "assistant", model: "test-model", content: 42 },
  })
} else if (mode === "denials") {
  init({ permission_mode: "default" })
  line({
    type: "assistant",
    uuid: "uuid-a",
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id: "m1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [
        { type: "tool_use", id: "call_w1", name: "write_file", input: { file_path: "/tmp/x" } },
      ],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  line({
    type: "user",
    uuid: "uuid-u",
    session_id: SID,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_w1", is_error: true, content: "denied" }],
    },
  })
  result({
    num_turns: 1,
    permission_denials: [{ tool_name: "write_file", tool_use_id: "call_w1", tool_input: {} }],
  })
} else if (mode === "zero-usage") {
  init()
  line({
    type: "assistant",
    uuid: "uuid-a",
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id: "m1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: "hello" }],
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  })
  result()
} else if (mode === "mcp-status") {
  init({
    mcp_servers: [
      { name: "ok", status: "connected" },
      { name: "down", status: "disconnected" },
    ],
  })
  result()
} else if (mode === "partial-tool") {
  init()
  line({
    type: "stream_event",
    uuid: "uuid-s1",
    session_id: SID,
    event: {
      type: "content_block_start",
      content_block: { type: "tool_use", id: "call_r1", name: "read_file", input: {} },
    },
  })
  line({
    type: "stream_event",
    uuid: "uuid-s2",
    session_id: SID,
    event: {
      type: "content_block_delta",
      delta: { type: "input_json_delta", partial_json: '{"file_path":"/tmp/a"}' },
    },
  })
  line({
    type: "stream_event",
    uuid: "uuid-s3",
    session_id: SID,
    event: { type: "content_block_stop" },
  })
  line({
    type: "assistant",
    uuid: "uuid-a",
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id: "m1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [
        { type: "tool_use", id: "call_r1", name: "read_file", input: { file_path: "/tmp/a" } },
      ],
    },
  })
  line({
    type: "user",
    uuid: "uuid-u",
    session_id: SID,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_r1", is_error: false, content: "contents" },
      ],
    },
  })
  result({ num_turns: 2 })
} else if (mode === "trailing-no-newline") {
  init()
  result()
  process.stdout.write('{"type":"system","subtype":"noop","session_id":"')
  process.stdout.write(`${SID}`)
  process.stdout.write('"}')
} else if (mode === "exit-53") {
  process.exitCode = 53
} else if (mode === "exit-55") {
  process.exitCode = 55
} else {
  // default: text turn with a canonical rename + goal_state noise.
  init()
  line({
    type: "stream_event",
    uuid: "uuid-g",
    session_id: SID,
    parent_tool_use_id: null,
    event: { type: "goal_state", goal_state: { v: 2, goal: null } },
  })
  line({
    type: "assistant",
    uuid: "uuid-a",
    session_id: SID,
    parent_tool_use_id: null,
    message: {
      id: "m1",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [
        { type: "text", text: "Hello. " },
        { type: "tool_use", id: "call_s1", name: "run_shell_command", input: { command: "ls" } },
      ],
    },
  })
  line({
    type: "user",
    uuid: "uuid-u",
    session_id: SID,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call_s1", is_error: false, content: "ok" }],
    },
  })
  result()
}
