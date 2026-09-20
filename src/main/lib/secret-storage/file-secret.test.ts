import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { clearFileSecret, fileSecretPaths, loadFileSecret, saveFileSecret } from "./file-secret"
import { SecretStore } from "./store"
import { type Keychain, SecretStorageError } from "./types"

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

function fixture(home: string, available = true, consent = false) {
  const store = new SecretStore(home, fakeKeychain(available))
  if (consent) store.setPlaintextConsent(true)
  return {
    ...fileSecretPaths(home, "github"),
    field: "token",
    context: "The GitHub token",
    store,
    keychain: store.keychain,
  }
}

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mauscode-file-secret-"))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("file secret", () => {
  it("writes ciphertext and never the plaintext value", () => {
    const home = makeHome()
    const secret = fixture(home)
    saveFileSecret(secret, "synthetic-token")
    expect(readFileSync(secret.filePath).subarray(0, 3).toString("latin1")).toBe("v10")
    expect(readFileSync(secret.filePath, "utf-8")).not.toContain("synthetic-token")
    expect(loadFileSecret(secret)).toBe("synthetic-token")
  })

  it("keeps a legacy plaintext companion readable and migrates it once encryption is possible", () => {
    const home = makeHome()
    const secret = fixture(home)
    mkdirSync(join(home, "data"), { recursive: true })
    writeFileSync(secret.plaintextPath, JSON.stringify({ token: "legacy-token" }))
    expect(loadFileSecret(secret)).toBe("legacy-token")
    expect(readFileSync(secret.filePath).subarray(0, 3).toString("latin1")).toBe("v10")
    expect(readdirSync(join(home, "data")).includes("github-auth.json")).toBe(false)
  })

  it("keeps the companion file when the migration is refused", () => {
    const home = makeHome()
    const refused = fixture(home, false)
    mkdirSync(join(home, "data"), { recursive: true })
    writeFileSync(refused.plaintextPath, JSON.stringify({ token: "legacy-token" }))
    expect(loadFileSecret(refused)).toBe("legacy-token")
    expect(readdirSync(join(home, "data")).includes("github-auth.json")).toBe(true)
  })

  it("refuses a new value without consent and leaves the stored one alone", () => {
    const home = makeHome()
    const secret = fixture(home)
    saveFileSecret(secret, "first-token")
    expect(() => saveFileSecret(fixture(home, false), "second-token")).toThrow(SecretStorageError)
    expect(loadFileSecret(secret)).toBe("first-token")
  })

  it("reads a consented plaintext value instead of ciphertext it cannot decrypt", () => {
    const home = makeHome()
    saveFileSecret(fixture(home), "first-token")
    const consented = fixture(home, false, true)
    saveFileSecret(consented, "second-token")
    expect(loadFileSecret(consented)).toBe("second-token")
    expect(
      readdirSync(join(home, "data")).filter((name) => name.includes(".unreadable-")),
    ).toHaveLength(1)
  })

  it("clears both files on sign-out", () => {
    const home = makeHome()
    const secret = fixture(home)
    saveFileSecret(secret, "synthetic-token")
    clearFileSecret(secret)
    expect(readdirSync(join(home, "data"))).toHaveLength(0)
  })
})
