/**
 * mausCode-authored in-process mock of `opencode serve` for session tests.
 * Implements: health, session create/get, prompt_async (schedules scripted
 * SSE), abort, permission reply, and the /global/event SSE stream.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"

export type MockSseEvent = {
  type: string
  properties: Record<string, unknown>
}

type MockServerOpts = {
  /** Script played per prompt_async, built with the real session id. */
  script?: (sessionID: string) => MockSseEvent[]
  /** Delay (ms) before playing the script; "never" for interrupt tests. */
  scriptDelayMs?: number | "never"
}

export function defaultScript(sessionID: string): MockSseEvent[] {
  return [
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt-text-1",
          sessionID,
          messageID: "msg-1",
          type: "text",
          text: "",
        },
        delta: "Hello from mock.",
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt-text-1",
          sessionID,
          messageID: "msg-1",
          type: "text",
          text: "Hello from mock.",
          time: { start: 1, end: 2 },
        },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt-tool-1",
          sessionID,
          messageID: "msg-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: { command: "echo hi" },
            output: "hi",
            title: "echo hi",
            metadata: {},
            time: { start: 1, end: 2 },
          },
        },
      },
    },
    {
      type: "message.part.updated",
      properties: {
        part: {
          id: "prt-step-1",
          sessionID,
          messageID: "msg-1",
          type: "step-finish",
          reason: "stop",
          cost: 0.001,
          tokens: {
            input: 10,
            output: 20,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        },
      },
    },
    {
      type: "permission.updated",
      properties: {
        id: "perm-1",
        type: "bash",
        sessionID,
        messageID: "msg-1",
        title: "run echo",
        metadata: {},
        time: { created: 1 },
      },
    },
    { type: "session.idle", properties: { sessionID } },
  ]
}

export function startMockOpencodeServer(opts: MockServerOpts = {}) {
  const script = opts.script ?? defaultScript
  const delayMs = opts.scriptDelayMs ?? 10
  const sseClients = new Set<ServerResponse>()
  const sessions = new Map<string, { id: string; title: string }>()
  const permissionReplies: Array<{ permissionID: string; body: unknown }> = []
  const prompts: Array<{ sessionID: string; body: unknown }> = []
  let sessionCounter = 0

  const broadcast = (event: MockSseEvent) => {
    const payload = { directory: "/mock", payload: event }
    for (const client of sseClients) {
      client.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
  }

  const readBody = (request: IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = ""
      request.on("data", (chunk) => {
        data += chunk
      })
      request.on("end", () => resolve(data))
    })

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://mock")
    const method = request.method ?? "GET"

    if (method === "GET" && url.pathname === "/global/health") {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ healthy: true, version: "mock" }))
      return
    }

    if (method === "GET" && url.pathname === "/global/event") {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      response.write(
        `data: ${JSON.stringify({ directory: "/mock", payload: { type: "server.connected", properties: {} } })}\n\n`,
      )
      sseClients.add(response)
      request.on("close", () => {
        sseClients.delete(response)
      })
      return
    }

    if (method === "POST" && url.pathname === "/session") {
      sessionCounter += 1
      const body = JSON.parse((await readBody(request)) || "{}")
      const id = `ses-mock-${sessionCounter}`
      sessions.set(id, { id, title: body.title ?? "" })
      response.writeHead(200, { "content-type": "application/json" })
      response.end(
        JSON.stringify({
          id,
          projectID: "prj-mock",
          directory: "/mock",
          title: body.title ?? "",
          version: "mock",
          time: { created: 1, updated: 1 },
        }),
      )
      return
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)(\/.*)?$/)
    if (sessionMatch) {
      const sessionID = sessionMatch[1]!
      const rest = sessionMatch[2] ?? ""
      if (!sessions.has(sessionID) && method !== "POST") {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(JSON.stringify({ message: "not found" }))
        return
      }
      if (method === "GET" && rest === "") {
        const session = sessions.get(sessionID)!
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            id: session.id,
            projectID: "prj-mock",
            directory: "/mock",
            title: session.title,
            version: "mock",
            time: { created: 1, updated: 1 },
          }),
        )
        return
      }
      if (method === "POST" && rest === "/prompt_async") {
        if (!sessions.has(sessionID)) {
          response.writeHead(404, { "content-type": "application/json" })
          response.end(JSON.stringify({ message: "not found" }))
          return
        }
        const body = JSON.parse((await readBody(request)) || "{}")
        prompts.push({ sessionID, body })
        response.writeHead(204)
        response.end()
        if (delayMs !== "never") {
          setTimeout(() => {
            for (const event of script(sessionID)) broadcast(event)
          }, delayMs)
        }
        return
      }
      if (method === "POST" && rest === "/abort") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end("true")
        setTimeout(() => {
          broadcast({
            type: "session.error",
            properties: {
              sessionID,
              error: {
                name: "MessageAbortedError",
                data: { message: "aborted" },
              },
            },
          })
        }, 5)
        return
      }
      const permMatch = rest.match(/^\/permissions\/([^/]+)$/)
      if (method === "POST" && permMatch) {
        const body = JSON.parse((await readBody(request)) || "{}")
        permissionReplies.push({ permissionID: permMatch[1]!, body })
        response.writeHead(200, { "content-type": "application/json" })
        response.end("true")
        return
      }
    }

    response.writeHead(404, { "content-type": "application/json" })
    response.end(JSON.stringify({ message: "unhandled" }))
  })

  return new Promise<{
    url: string
    close: () => Promise<void>
    permissionReplies: typeof permissionReplies
    prompts: typeof prompts
    dropSession: (id: string) => void
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      const port = typeof address === "object" && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise<void>((done) => {
            for (const client of sseClients) client.end()
            server.close(() => done())
          }),
        permissionReplies,
        prompts,
        dropSession: (id: string) => {
          sessions.delete(id)
        },
      })
    })
  })
}
