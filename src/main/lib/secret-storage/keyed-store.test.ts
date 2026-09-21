import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  keyedStorePath,
  readKeyedSecret,
  readKeyedSecrets,
  removeKeyedSecret,
  writeKeyedSecret,
} from "./keyed-store"
import type { SecretStore } from "./store"
import { makeHome, makeStore } from "./test-support"
import { SecretStorageError } from "./types"

function keyedStore(available = true, consent = false): SecretStore {
  return makeStore(makeHome("mauscode-keyed-store-"), { available, consent })
}

function keyed(store: SecretStore) {
  return { filePath: keyedStorePath(store.userDataPath), store }
}

/** Same location, no keyring: the state after a keyring stops answering. */
function lockedCopyOf(store: SecretStore): SecretStore {
  return makeStore(store.userDataPath, { available: false })
}

describe("keyed secret store", () => {
  it("removes the copies it could not read once the last secret is removed", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "agents:openai-api-key", "sk-value")
    // A file this version cannot read is kept aside under a recovery name.
    const stashed = `${keyedStorePath(store.userDataPath)}.unreadable-2026-09-21T00-00-00-000Z`
    writeFileSync(stashed, "an entry this build cannot read")
    removeKeyedSecret(keyed(store), "agents:openai-api-key")
    expect(existsSync(stashed)).toBe(false)
    expect(readdirSync(store.userDataPath).filter((name) => name.includes(".unreadable-"))).toEqual(
      [],
    )
  })

  it("keeps the copies it could not read while another secret is still stored", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "agents:openai-api-key", "sk-value")
    writeKeyedSecret(keyed(store), "agents:gemini-api-key", "gemini-value")
    const stashed = `${keyedStorePath(store.userDataPath)}.unreadable-2026-09-21T00-00-00-000Z`
    writeFileSync(stashed, "an entry this build cannot read")
    removeKeyedSecret(keyed(store), "agents:openai-api-key")
    // The other secret's older bytes stay available for a keyring that can read
    // them, so a removal does not destroy what it did not touch.
    expect(existsSync(stashed)).toBe(true)
  })

  it("round trips an encrypted value and records how it was stored", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "agents:openai-api-key", '{"key":"sk-value"}')
    const raw = readFileSync(keyedStorePath(store.userDataPath), "utf-8")
    expect(raw).not.toContain("sk-value")
    const file = JSON.parse(raw) as { entries: Record<string, { protection: string }> }
    expect(file.entries["agents:openai-api-key"]?.protection).toBe("os-encryption")
    expect(readKeyedSecret(keyed(store), "agents:openai-api-key")).toBe('{"key":"sk-value"}')
  })

  it("writes owner-only files", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "k", "v")
    expect(statSync(keyedStorePath(store.userDataPath)).mode & 0o777).toBe(0o600)
  })

  it("refuses a write without consent when no keyring is available and leaves the file alone", () => {
    const owner = keyedStore()
    writeKeyedSecret(keyed(owner), "k", "first")
    const refused = lockedCopyOf(owner)
    expect(() => writeKeyedSecret(keyed(refused), "k", "second")).toThrow(SecretStorageError)
    expect(readKeyedSecrets(keyed(owner)).values.k).toBe("first")
  })

  it("reads a plaintext value written under consent after a keyring returns", () => {
    const consented = keyedStore(false, true)
    writeKeyedSecret(keyed(consented), "k", "legacy-value")
    const file = JSON.parse(readFileSync(keyedStorePath(consented.userDataPath), "utf-8")) as {
      entries: Record<string, { protection: string }>
    }
    expect(file.entries.k?.protection).toBe("plaintext")
    const withKeyring = makeStore(consented.userDataPath)
    expect(readKeyedSecret(keyed(withKeyring), "k")).toBe("legacy-value")
  })

  it("reports an unreadable entry instead of returning it", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "k", "value")
    const read = readKeyedSecrets(keyed(lockedCopyOf(store)))
    expect(read.values.k).toBeUndefined()
    expect(read.error).not.toBeNull()
  })

  it("removes one key without touching the others", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "a", "1")
    writeKeyedSecret(keyed(store), "b", "2")
    removeKeyedSecret(keyed(store), "a")
    const values = readKeyedSecrets(keyed(store)).values
    expect(values.a).toBeUndefined()
    expect(values.b).toBe("2")
  })

  it("leaves no temporary file behind", () => {
    const store = keyedStore()
    writeKeyedSecret(keyed(store), "a", "1")
    const dir = join(store.userDataPath, "data")
    expect(readdirSync(dir).filter((name) => name.includes(".tmp-"))).toHaveLength(0)
    expect(readKeyedSecret(keyed(store), "a")).toBe("1")
  })

  it("puts the unreadable file back when the replacement never lands", () => {
    const store = keyedStore(true, false)
    const path = keyedStorePath(store.userDataPath)
    mkdirSync(join(store.userDataPath, "data"), { recursive: true })
    writeFileSync(path, "{ this is not json")
    // A directory where this write's temporary file belongs makes the write
    // fail after the unreadable file was already moved aside.
    mkdirSync(`${path}.tmp-${process.pid}`)
    expect(() => writeKeyedSecret(keyed(store), "a", "1")).toThrow()
    // The bytes are back where reads look for them, instead of surviving only
    // under a recovery name this version never reads.
    expect(readFileSync(path, "utf-8")).toBe("{ this is not json")
  })

  it("sweeps the temporary file an unfinished write left", () => {
    const store = keyedStore(true, false)
    const path = keyedStorePath(store.userDataPath)
    mkdirSync(join(store.userDataPath, "data"), { recursive: true })
    const stale = `${path}.tmp-999999`
    writeFileSync(stale, JSON.stringify({ version: 1, entries: {} }))
    writeKeyedSecret(keyed(store), "a", "1")
    expect(readdirSync(join(store.userDataPath, "data"))).not.toContain(`${path}.tmp-999999`)
    expect(readKeyedSecret(keyed(store), "a")).toBe("1")
  })

  it("leaves an unreadable file in place when the write is refused", () => {
    const store = keyedStore(true, false)
    const dir = join(store.userDataPath, "data")
    mkdirSync(dir, { recursive: true })
    const path = keyedStorePath(store.userDataPath)
    writeFileSync(path, "{ this is not json")
    // No keyring and no consent: the refusal happens before anything moves.
    const refused = makeStore(store.userDataPath, { available: false, consent: false })
    expect(() => writeKeyedSecret(keyed(refused), "a", "1")).toThrow(SecretStorageError)
    expect(readFileSync(path, "utf-8")).toBe("{ this is not json")
    expect(readdirSync(dir).filter((name) => name.includes(".unreadable-"))).toHaveLength(0)
  })

  it("keeps an unreadable file instead of replacing its bytes", () => {
    const store = keyedStore()
    const dir = join(store.userDataPath, "data")
    mkdirSync(dir, { recursive: true })
    writeFileSync(keyedStorePath(store.userDataPath), "{ this is not json")
    writeKeyedSecret(keyed(store), "a", "1")
    const kept = readdirSync(dir).filter((name) => name.includes(".unreadable-"))
    expect(kept).toHaveLength(1)
    // Every byte the broken file held is still there to recover from.
    expect(readFileSync(join(dir, kept[0] ?? ""), "utf-8")).toBe("{ this is not json")
    expect(readKeyedSecret(keyed(store), "a")).toBe("1")
  })

  it("reports an entry whose protection it does not recognize", () => {
    const store = keyedStore()
    mkdirSync(join(store.userDataPath, "data"), { recursive: true })
    writeFileSync(
      keyedStorePath(store.userDataPath),
      JSON.stringify({ version: 1, entries: { k: { protection: "rot13", payload: "value" } } }),
    )
    const read = readKeyedSecrets(keyed(store))
    expect(read.values.k).toBeUndefined()
    expect(read.error).toMatch(/unrecognized shape/)
  })
})
