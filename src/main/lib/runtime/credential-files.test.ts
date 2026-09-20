/**
 * Private credential file cleanup tests (no Electron, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/credential-files.test.ts
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { clearPrivateCredentialFiles, privateCredentialDir } from "./credential-files.ts"

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "maus-runtime-cred-"))
}

function writeCredential(home: string, name: string, contents: string): string {
  const dir = privateCredentialDir(home)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents, { mode: 0o600 })
  return file
}

test("removes provider env files and reports their names only", () => {
  const home = tempHome()
  const anthropic = writeCredential(home, "anthropic.env", "ANTHROPIC_API_KEY=sk-synthetic")
  writeCredential(home, "openai.env", "OPENAI_API_KEY=sk-synthetic")
  const removed = clearPrivateCredentialFiles(home)
  assert.deepEqual(removed.sort(), ["anthropic.env", "openai.env"])
  assert.equal(fs.existsSync(anthropic), false)
  assert.ok(!JSON.stringify(removed).includes("sk-synthetic"))
})

test("keeps files that are not provider credentials", () => {
  const home = tempHome()
  const dir = privateCredentialDir(home)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "usage.json"), "{}")
  fs.mkdirSync(path.join(dir, "anthropic.env.d"), { recursive: true })
  clearPrivateCredentialFiles(home)
  assert.equal(fs.existsSync(path.join(dir, "usage.json")), true)
  assert.equal(fs.statSync(path.join(dir, "anthropic.env.d")).isDirectory(), true)
})

test("is quiet when the instance never wrote credentials", () => {
  assert.deepEqual(clearPrivateCredentialFiles(tempHome()), [])
})

test("refuses a credential path that is a symlink", () => {
  const home = tempHome()
  const elsewhere = tempHome()
  fs.mkdirSync(path.join(home, "config"), { recursive: true })
  fs.writeFileSync(path.join(elsewhere, "anthropic.env"), "ANTHROPIC_API_KEY=sk-synthetic")
  fs.symlinkSync(elsewhere, privateCredentialDir(home))
  assert.deepEqual(clearPrivateCredentialFiles(home), [])
  assert.equal(fs.existsSync(path.join(elsewhere, "anthropic.env")), true)
})

test("passes over a missing directory without throwing", () => {
  const home = tempHome()
  fs.rmSync(home, { recursive: true, force: true })
  assert.deepEqual(clearPrivateCredentialFiles(home), [])
})
