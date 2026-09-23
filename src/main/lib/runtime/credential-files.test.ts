/**
 * Private credential file cleanup tests (no Electron, no daemon):
 *   node --test --experimental-strip-types src/main/lib/runtime/credential-files.test.ts
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { clearPrivateCredentialFiles, privateCredentialDir } from "./credential-files.ts"

const homes: string[] = []

function tempHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maus-runtime-cred-"))
  homes.push(home)
  return home
}

after(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true })
})

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

test("refuses a credential path that is a symlink, without following it", () => {
  const home = tempHome()
  const elsewhere = tempHome()
  fs.mkdirSync(path.join(home, "config"), { recursive: true })
  fs.writeFileSync(path.join(elsewhere, "anthropic.env"), "ANTHROPIC_API_KEY=sk-synthetic")
  fs.symlinkSync(elsewhere, privateCredentialDir(home))
  // Failing closed is the point: the daemon follows this path itself, so a
  // cleanup that cannot vouch for it must stop the daemon rather than wave it on.
  assert.throws(
    () => clearPrivateCredentialFiles(home),
    /could not be inspected|not a plain directory/,
  )
  assert.equal(fs.existsSync(path.join(elsewhere, "anthropic.env")), true)
})

test("fails closed when the credential path is not a directory", () => {
  const home = tempHome()
  fs.mkdirSync(path.join(home, "config"), { recursive: true })
  fs.writeFileSync(privateCredentialDir(home), "not a directory")
  assert.throws(
    () => clearPrivateCredentialFiles(home),
    /could not be inspected|not a plain directory/,
  )
})

test("fails closed when a credential file cannot be removed", () => {
  const home = tempHome()
  const file = writeCredential(home, "anthropic.env", "ANTHROPIC_API_KEY=sk-synthetic")
  assert.throws(
    () =>
      clearPrivateCredentialFiles(home, () => {
        throw new Error("EPERM")
      }),
    /could not be removed/,
  )
  assert.equal(fs.existsSync(file), true)
})

test("passes over a missing directory without throwing", () => {
  const home = tempHome()
  fs.rmSync(home, { recursive: true, force: true })
  assert.deepEqual(clearPrivateCredentialFiles(home), [])
})
