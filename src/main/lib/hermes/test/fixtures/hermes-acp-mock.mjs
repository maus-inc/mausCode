/**
 * mausCode-authored mock ACP agent (NDJSON stdio) for hermes chat tests.
 *
 * Speaks the client->agent methods @mcpc-tech/acp-ai-provider uses:
 * initialize, session/new, session/load, session/set_model, session/prompt,
 * session/cancel. Prompt plays a scripted session/update sequence, then
 * {stopReason:"end_turn"}.
 *
 * Modes via HERMES_MOCK_MODE: default script; "never" (prompt never settles,
 * for cancel tests); "prompt-error" (prompt replies a JSON-RPC error).
 */
import { createInterface } from "node:readline"

const mode = process.env.HERMES_MOCK_MODE ?? "default"
const sessions = new Set()
let sessionCounter = 0

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function result(id, result) {
  send({ jsonrpc: "2.0", id, result })
}

function error(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } })
}

function sessionInfo(sessionId) {
  return {
    sessionId,
    models: {
      currentModelId: "hermes-default",
      availableModels: [
        { modelId: "hermes-default", name: "Hermes Default" },
        { modelId: "hermes-alt", name: "Hermes Alt" },
      ],
    },
  }
}

function playScript(sessionId) {
  const update = (update) =>
    send({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } })
  update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Hello from mock." },
  })
  update({
    sessionUpdate: "tool_call",
    toolCallId: "call-1",
    title: "Bash",
    rawInput: { command: "echo hi" },
  })
  update({
    sessionUpdate: "tool_call_update",
    toolCallId: "call-1",
    title: "Bash",
    status: "completed",
    rawOutput: "hi",
  })
}

const rl = createInterface({ input: process.stdin, terminal: false })
rl.on("line", (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  let message
  try {
    message = JSON.parse(trimmed)
  } catch {
    return
  }
  const { id, method, params } = message
  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? 1,
        agentCapabilities: {},
        authMethods: [],
      })
      break
    case "session/new": {
      sessionCounter += 1
      const sessionId = `ses-mock-${sessionCounter}`
      sessions.add(sessionId)
      result(id, sessionInfo(sessionId))
      break
    }
    case "session/load": {
      const sessionId = params?.sessionId
      if (typeof sessionId === "string" && sessions.has(sessionId)) {
        result(id, sessionInfo(sessionId))
      } else {
        error(id, -32000, `session not found: ${String(sessionId)}`)
      }
      break
    }
    case "session/set_model":
      result(id, {})
      break
    case "session/prompt": {
      const sessionId = params?.sessionId
      if (mode === "prompt-error") {
        error(id, -32000, "mock prompt failure")
      } else if (mode !== "never") {
        // Script plays before the result so updates stream first.
        setImmediate(() => {
          playScript(sessionId)
          result(id, { stopReason: "end_turn" })
        })
      }
      // "never": leave the prompt pending; the test cancels the stream.
      break
    }
    case "session/cancel":
      // Provider sends cancel when the consumer aborts; ack either way.
      if (id !== undefined) result(id, {})
      break
    default:
      if (id !== undefined) error(id, -32601, `method not found: ${method}`)
      break
  }
})
