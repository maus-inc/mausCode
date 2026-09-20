import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  keyedStorePath,
  readKeyedSecret,
  readKeyedSecrets,
  removeKeyedSecret,
  writeKeyedSecret,
} from "./keyed-store"
import { SecretStore } from "./store"
import { type Keychain, SecretStorageError } from "./types"

const homes: string[] = []

function fakeKeychain(available: boolean): Keychain {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) =>
      Buffer.concat([
        Buffer.from("v10", "latin1"),
        Buffer.from([1, 2]),
        Buffer.from(value, "utf-8").map((byte) => byte ^ 0x5a),
      ]),
    decryptString: (payload) => {
      if (!payload.subarray(0, 3).equals(Buffer.from("v10", "latin1"))) {
        throw new Error("Ciphertext does not appear to be encrypted.")
      }
      return Buffer.from(payload.subarray(5).map((byte) => byte ^ 0x5a)).toString("utf-8")
    },
    selectedBackend: () => null,
  }
}

function makeStore(available = true, consent = false): SecretStore {
  const home = mkdtempSync(join(tmpdir(), "mauscode-keyed-store-"))
  homes.push(home)
  const store = new SecretStore(home, fakeKeychain(available))
  if (consent) store.setPlaintextConsent(true)
  return store
}

function keyed(store: SecretStore) {
  return { filePath: keyedStorePath(store.userDataPath), store }
}

/** Same location, no keyring: the state after a keyring stops answering. */
function lockedCopyOf(store: SecretStore): SecretStore {
  return new SecretStore(store.userDataPath, fakeKeychain(false))
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("keyed secret store", () => {
  it("round trips an encrypted value and records how it was stored", () => {
    const store = makeStore()
    writeKeyedSecret(keyed(store), "agents:openai-api-key", '{"key":"sk-value"}')
    const raw = readFileSync(keyedStorePath(store.userDataPath), "utf-8")
    expect(raw).not.toContain("sk-value")
    const file = JSON.parse(raw) as { entries: Record<string, { protection: string }> }
    expect(file.entries["agents:openai-api-key"]?.protection).toBe("os-encryption")
    expect(readKeyedSecret(keyed(store), "agents:openai-api-key")).toBe('{"key":"sk-value"}')
  })

  it("writes owner-only files", () => {
    const store = makeStore()
    writeKeyedSecret(keyed(store), "k", "v")
    expect(statSync(keyedStorePath(store.userDataPath)).mode & 0o777).toBe(0o600)
  })

  it("refuses a write without consent when no keyring is available and leaves the file alone", () => {
    const owner = makeStore()
    writeKeyedSecret(keyed(owner), "k", "first")
    const refused = lockedCopyOf(owner)
    expect(() => writeKeyedSecret(keyed(refused), "k", "second")).toThrow(SecretStorageError)
    expect(readKeyedSecrets(keyed(owner)).values.k).toBe("first")
  })

  it("reads a plaintext value written under consent after a keyring returns", () => {
    const consented = makeStore(false, true)
    writeKeyedSecret(keyed(consented), "k", "legacy-value")
    const file = JSON.parse(readFileSync(keyedStorePath(consented.userDataPath), "utf-8")) as {
      entries: Record<string, { protection: string }>
    }
    expect(file.entries.k?.protection).toBe("plaintext")
    const withKeyring = new SecretStore(consented.userDataPath, fakeKeychain(true))
    expect(readKeyedSecret(keyed(withKeyring), "k")).toBe("legacy-value")
  })

  it("reports an unreadable entry instead of returning it", () => {
    const store = makeStore()
    writeKeyedSecret(keyed(store), "k", "value")
    const read = readKeyedSecrets(keyed(lockedCopyOf(store)))
    expect(read.values.k).toBeUndefined()
    expect(read.error).not.toBeNull()
  })

  it("removes one key without touching the others", () => {
    const store = makeStore()
    writeKeyedSecret(keyed(store), "a", "1")
    writeKeyedSecret(keyed(store), "b", "2")
    removeKeyedSecret(keyed(store), "a")
    const values = readKeyedSecrets(keyed(store)).values
    expect(values.a).toBeUndefined()
    expect(values.b).toBe("2")
  })

  it("leaves no temporary file behind", () => {
    const store = makeStore()
    writeKeyedSecret(keyed(store), "a", "1")
    const dir = join(store.userDataPath, "data")
    const leftovers = readKeyedSecrets(keyed(store))
    expect(leftovers.error).toBeNull()
    expect(statSync(dir).isDirectory()).toBe(true)
  })
})
