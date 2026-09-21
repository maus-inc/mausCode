import { readFileSync, statSync } from "node:fs"
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
    const leftovers = readKeyedSecrets(keyed(store))
    expect(leftovers.error).toBeNull()
    expect(statSync(dir).isDirectory()).toBe(true)
  })
})
