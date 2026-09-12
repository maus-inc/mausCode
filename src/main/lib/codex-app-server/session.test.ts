/**
 * mausCode-authored session tests (NOT a T3 port). Drive the promise-based
 * adapter against the turn mock peer over real stdio: thread lifecycle,
 * turn chunks, interrupt, and resume paths.
 */
import { assert, it } from "@effect/vitest"
import { createCodexAppServerSession } from "./session.ts"

const peerPath = new URL("./test/fixtures/codex-app-server-turn-mock-peer.ts", import.meta.url)
  .pathname

const spawnSession = (
  onChunk: (chunk: unknown) => void,
  opts?: { existingThreadId?: string; legacySessionId?: string; env?: Record<string, string> },
) =>
  createCodexAppServerSession({
    binaryPath: process.execPath,
    argv: [peerPath],
    cwd: process.cwd(),
    env: { ...process.env, ...(opts?.env ?? {}) } as Record<string, string>,
    ...(opts?.existingThreadId ? { existingThreadId: opts.existingThreadId } : {}),
    ...(opts?.legacySessionId ? { legacySessionId: opts.legacySessionId } : {}),
    onChunk,
  })

it("runs a full turn and maps notifications to chunks", async () => {
  const chunks: unknown[] = []
  const session = await spawnSession((chunk) => chunks.push(chunk))
  assert.equal(session.threadId, "thread-mock-1")
  assert.equal(session.sessionId, "session-mock-1")

  const result = await session.startTurn([{ type: "text", text: "hi" }])
  assert.equal(result.status, "completed")

  const types = chunks.map((chunk) => chunk.type)
  assert.deepEqual(types, ["text-start", "text-delta", "text-end"])
  assert.equal(chunks[1].delta, "Hello from mock.")

  await session.dispose()
})

it("resumes via legacy session id through thread/list", async () => {
  const session = await spawnSession(() => {}, { legacySessionId: "session-mock-1" })
  assert.equal(session.threadId, "thread-mock-1")
  await session.dispose()
})

it("interrupts a slow turn", async () => {
  const session = await spawnSession(() => {}, { env: { MOCK_TURN_SLOW: "1" } })
  const turnPromise = session.startTurn([{ type: "text", text: "slow" }])
  await session.interrupt()
  const result = await turnPromise
  assert.equal(result.status, "interrupted")
  await session.dispose()
})
