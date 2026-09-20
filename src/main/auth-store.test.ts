import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { type AuthData, AuthStore } from "./auth-store"
import { SecretStore } from "./lib/secret-storage/store"
import { type Keychain, SecretStorageError } from "./lib/secret-storage/types"

const homes: string[] = []

function fakeKeychain(available = true): Keychain {
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

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mauscode-auth-store-"))
  homes.push(home)
  return home
}

function session(overrides: Partial<AuthData> = {}): AuthData {
  return {
    token: "synthetic-session-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
    user: { id: "u1", email: "user@example.test", name: null, imageUrl: null, username: null },
    ...overrides,
  }
}

function storeFor(
  home: string,
  available = true,
  consent = false,
): { auth: AuthStore; store: SecretStore } {
  const store = new SecretStore(home, fakeKeychain(available))
  if (consent) store.setPlaintextConsent(true)
  return { auth: new AuthStore(home, store), store }
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("auth store", () => {
  it("round trips an encrypted session and writes no plaintext copies", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    const raw = readFileSync(join(home, "auth.dat"))
    expect(raw.subarray(0, 3).toString("latin1")).toBe("v10")
    expect(readFileSync(join(home, "auth.dat")).toString("utf-8")).not.toContain(
      "synthetic-session-token",
    )
    expect(auth.getToken()).toBe("synthetic-session-token")
    expect(readFileSync(join(home, "auth.dat")).subarray(0, 3).toString("latin1")).toBe("v10")
  })

  it("keeps every read working after the keyring disappears", () => {
    const home = makeHome()
    storeFor(home).auth.save(session())
    const { auth } = storeFor(home, false)
    expect(auth.getToken()).toBeNull()
    expect(auth.lastError()).toMatch(/keyring|decrypt/i)
  })

  it("refuses a new session without consent and leaves the saved one alone", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    const refused = storeFor(home, false).auth
    expect(() => refused.save(session({ token: "replacement" }))).toThrow(SecretStorageError)
    expect(auth.getToken()).toBe("synthetic-session-token")
  })

  it("reads a consented plaintext save instead of the ciphertext it could not decrypt", () => {
    const home = makeHome()
    storeFor(home).auth.save(session())
    const { auth } = storeFor(home, false, true)
    auth.save(session({ token: "consented-plaintext-token" }))
    const aside = readdirSync(home).filter((name) => name.startsWith("auth.dat.unreadable-"))
    expect(aside).toHaveLength(1)
    // The unreadable ciphertext is kept aside, still encrypted, and no longer read.
    expect(
      readFileSync(join(home, aside[0] ?? ""))
        .subarray(0, 3)
        .toString("latin1"),
    ).toBe("v10")
    expect(auth.getToken()).toBe("consented-plaintext-token")
    // The same plaintext copy stays readable once a keyring returns.
    expect(storeFor(home).auth.getToken()).toBe("consented-plaintext-token")
  })

  it("migrates the legacy auth.json file to the encrypted store", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    const { auth } = storeFor(home)
    expect(auth.getToken()).toBe("synthetic-session-token")
    expect(readdirSync(home).includes("auth.json")).toBe(false)
    expect(readFileSync(join(home, "auth.dat")).subarray(0, 3).toString("latin1")).toBe("v10")
  })

  it("keeps a legacy plaintext file when the migration is refused", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.dat.json"), JSON.stringify(session()))
    const { auth } = storeFor(home, false)
    expect(auth.getToken()).toBe("synthetic-session-token")
    expect(readdirSync(home).includes("auth.dat.json")).toBe(true)
    expect(auth.lastError()).not.toBeNull()
  })

  it("clears every file the session could be stored in", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    auth.clear()
    expect(readdirSync(home).filter((name) => name.startsWith("auth."))).toHaveLength(0)
  })

  it("treats a malformed saved session as absent and reports it", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.dat"), "not a session")
    const { auth } = storeFor(home)
    expect(auth.load()).toBeNull()
    expect(auth.lastError()).not.toBeNull()
  })
})
