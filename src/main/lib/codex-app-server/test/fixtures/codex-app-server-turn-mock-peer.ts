/**
 * mausCode-authored mock peer for session.test.ts (NOT a T3 port).
 * Implements just enough of `codex app-server` to drive a full turn:
 * initialize -> thread/start -> turn/start (+delta/completed/completed
 * notifications), plus thread/resume, thread/list, and turn/interrupt.
 * Newline-delimited JSON-RPC like the ported mock peer.
 */
const writeMessage = (message: unknown) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const respond = (id: number | string, result: unknown) => {
  writeMessage({ id, result })
}

const notify = (method: string, params: unknown) => {
  writeMessage({ method, params })
}

const THREAD_ID = "thread-mock-1"
const SESSION_ID = "session-mock-1"

const mockThread = () => ({
  cliVersion: "mock",
  createdAt: Math.floor(Date.now() / 1000),
  cwd: process.cwd(),
  ephemeral: false,
  id: THREAD_ID,
  modelProvider: "openai",
  name: "mock thread",
  preview: "mock",
  sessionId: SESSION_ID,
  source: "cli",
  status: { type: "idle" },
  turns: [],
  updatedAt: Math.floor(Date.now() / 1000),
})

const mockThreadStartResult = () => ({
  approvalPolicy: "never",
  approvalsReviewer: "user",
  cwd: process.cwd(),
  model: "gpt-mock",
  modelProvider: "openai",
  sandbox: { type: "readOnly" },
  thread: mockThread(),
})

let turnCounter = 0

const handleMethod = (message: Record<string, unknown>) => {
  const method = message.method
  if (typeof method !== "string") return
  const id = message.id as number | string

  switch (method) {
    case "initialize": {
      respond(id, {
        userAgent: "mock-codex-app-server",
        codexHome: process.cwd(),
        platformFamily: "unix",
        platformOs: "linux",
      })
      return
    }
    case "initialized": {
      return
    }
    case "thread/start": {
      respond(id, mockThreadStartResult())
      return
    }
    case "thread/resume": {
      respond(id, mockThreadStartResult())
      return
    }
    case "thread/list": {
      respond(id, { data: [mockThread()] })
      return
    }
    case "turn/start": {
      turnCounter += 1
      const turnId = `turn-mock-${turnCounter}`
      respond(id, { turn: { id: turnId, items: [], status: "inProgress" } })
      // Emit a text delta, a completed agent message, then turn completion.
      const slow = process.env.MOCK_TURN_SLOW === "1"
      const emitTurn = () => {
        notify("item/agentMessage/delta", {
          delta: "Hello from mock.",
          itemId: "msg-1",
          threadId: THREAD_ID,
          turnId,
        })
        notify("item/completed", {
          completedAtMs: Date.now(),
          item: { id: "msg-1", type: "agentMessage", text: "Hello from mock." },
          threadId: THREAD_ID,
          turnId,
        })
        notify("turn/completed", {
          threadId: THREAD_ID,
          turn: { id: turnId, items: [], status: "completed" },
        })
      }
      if (slow) {
        setTimeout(emitTurn, 5000)
      } else {
        setTimeout(emitTurn, 10)
      }
      return
    }
    case "turn/interrupt": {
      respond(id, {})
      return
    }
    default: {
      if (message.id !== undefined) {
        writeMessage({
          id,
          error: { code: -32601, message: `Unhandled request: ${method}` },
        })
      }
    }
  }
}

let remainder = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  remainder += chunk
  const lines = remainder.split("\n")
  remainder = lines.pop() ?? ""
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const message = JSON.parse(trimmed) as Record<string, unknown>
    if ("method" in message) handleMethod(message)
  }
})
process.stdin.on("end", () => {
  process.exit(0)
})
