/**
 * In-process mock harness server for SDK tests.
 *
 * Speaks the same NDJSON frames as the bridge so client tests exercise real
 * framing and reply correlation instead of stubbed methods.
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import type { ApiRequest, ServerFrame, UnknownApiEvent } from "../dist/index.js"
import { NdjsonDecoder } from "../dist/index.js"

/** A request off the wire: the protocol's typed request union plus the frame `id` the harness echoes back as `reply_to`. */
export type MockRequest = ApiRequest & { id: number }

/**
 * A reply body: a `ServerFrame` without the envelope fields the caller adds. Spelled as the
 * event type rather than `Omit<ServerFrame, ...>` because `Omit` over an index-signature type
 * drops the required `ev`, which is the one field the client routes replies on.
 */
export type MockReply = UnknownApiEvent

export interface MockOptions {
  /** Called for each client request after the handshake; `send` writes one reply frame to the socket. */
  onRequest?: (request: MockRequest, send: (frame: ServerFrame) => void) => void
}

export interface MockServer {
  socketPath: string
  close(): Promise<void>
  /** Number of currently open client connections. */
  clientCount(): number
  /** Push an unsolicited event to every connected client. */
  broadcast(event: ServerFrame): void
}

export async function startMockHarness(options: MockOptions = {}): Promise<MockServer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jcode-sdk-test-"))
  const socketPath = path.join(dir, "api.sock")
  const clients = new Set<net.Socket>()

  const server = net.createServer((socket) => {
    clients.add(socket)
    socket.on("close", () => clients.delete(socket))
    socket.on("error", () => clients.delete(socket))
    const decoder = new NdjsonDecoder()
    socket.on("data", (chunk) => {
      for (const raw of decoder.push(chunk)) {
        // The decoder yields parsed JSON. The harness is a fixture, not a validator, so the
        // request shape is asserted rather than checked - but it is the real union, so a rename
        // of a `req` verb or its fields is still a compile error for the tests that read them.
        const request = raw as MockRequest
        const send = (frame: ServerFrame) => socket.write(`${JSON.stringify(frame)}\n`)
        if (request.req === "hello") {
          send({
            v: 1,
            reply_to: request.id,
            ev: "hello_ok",
            version: 1,
            server: "mock/0.1",
            capabilities: ["sessions", "streaming"],
          })
          continue
        }
        options.onRequest?.(request, send)
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(socketPath, resolve))

  return {
    socketPath,
    clientCount() {
      return clients.size
    },
    broadcast(event: ServerFrame) {
      for (const socket of clients) socket.write(`${JSON.stringify(event)}\n`)
    },
    close() {
      for (const socket of clients) socket.destroy()
      return new Promise<void>((resolve) => {
        server.close(() => {
          fs.rmSync(dir, { recursive: true, force: true })
          resolve()
        })
      })
    },
  }
}

/**
 * The one request in `requests` that carries verb `req`, typed as that verb's payload.
 *
 * Reading a capture array by hand is two holes at once: the lookup can be `undefined`, and the
 * fields a test asserts on are never checked against the protocol. This closes both - a verb the
 * client did not send fails with its name, and a renamed or removed field stops compiling.
 */
export function requestOf<R extends ApiRequest["req"]>(
  requests: readonly MockRequest[],
  req: R,
): MockRequest & Extract<ApiRequest, { req: R }> {
  const found = requests.find((request) => request.req === req)
  assert.ok(found, `expected the client to send a "${req}" request`)
  if (found === undefined) {
    throw new Error(`expected the client to send a "${req}" request`)
  }
  return found as MockRequest & Extract<ApiRequest, { req: R }>
}
