/**
 * Manager lifecycle tests (launch a real private instance).
 * Needs the pinned platform binary (`npm install` in packages/runtime-client):
 *   node --test --experimental-strip-types src/main/lib/runtime/manager.test.ts
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { RuntimeManager } from "./manager.ts"

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maus-runtime-test-"))
}

test("lazy start, ping, singleton client, shutdown", async () => {
  const manager = new RuntimeManager({ jcodeHome: tempHome() })
  assert.equal(manager.status(), "stopped")
  const a = await manager.getClient()
  assert.equal(manager.status(), "ready")
  await manager.ping()
  const b = await manager.getClient()
  assert.equal(a, b)
  await manager.shutdown()
  assert.equal(manager.status(), "stopped")
  await manager.shutdown() // idempotent
})

test("sessions persist across manager restarts with a stable home", async () => {
  const home = tempHome()
  const first = new RuntimeManager({ jcodeHome: home })
  const client = await first.getClient()
  const created = await client.createSession(os.tmpdir())
  await first.shutdown()
  const second = new RuntimeManager({ jcodeHome: home })
  const client2 = await second.getClient()
  const sessions = await client2.listSessions()
  assert.ok(sessions.some((s) => s.session_id === created.session_id))
  await second.shutdown()
  fs.rmSync(home, { recursive: true, force: true })
})

test("status events fire on ready and shutdown", async () => {
  const manager = new RuntimeManager({ jcodeHome: tempHome() })
  const seen: string[] = []
  manager.on("status", (s: string) => seen.push(s))
  await manager.getClient()
  await manager.shutdown()
  assert.ok(seen.includes("ready"))
  assert.ok(seen.includes("stopped"))
})
