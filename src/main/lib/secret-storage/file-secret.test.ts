import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { clearFileSecret, fileSecretPaths, loadFileSecret, saveFileSecret } from "./file-secret"
import { makeHome, makeStore } from "./test-support"
import { SecretStorageError } from "./types"

function fixture(home: string, available = true, consent = false, backend: string | null = null) {
  const store = makeStore(home, { available, consent, backend })
  return {
    ...fileSecretPaths(home, "github"),
    field: "token",
    context: "The GitHub token",
    store,
    keychain: store.keychain,
  }
}

describe("file secret", () => {
  it("writes ciphertext and never the plaintext value", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    saveFileSecret(secret, "synthetic-token")
    expect(readFileSync(secret.filePath).subarray(0, 3).toString("latin1")).toBe("v10")
    expect(readFileSync(secret.filePath, "utf-8")).not.toContain("synthetic-token")
    expect(loadFileSecret(secret)).toBe("synthetic-token")
  })

  it("keeps a legacy plaintext companion readable and migrates it once encryption is possible", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    mkdirSync(join(home, "data"), { recursive: true })
    writeFileSync(secret.plaintextPath, JSON.stringify({ token: "legacy-token" }))
    expect(loadFileSecret(secret)).toBe("legacy-token")
    expect(readFileSync(secret.filePath).subarray(0, 3).toString("latin1")).toBe("v10")
    expect(readdirSync(join(home, "data")).includes("github-auth.json")).toBe(false)
  })

  it("keeps the companion file when the migration is refused", () => {
    const home = makeHome("mauscode-file-secret-")
    const refused = fixture(home, false)
    mkdirSync(join(home, "data"), { recursive: true })
    writeFileSync(refused.plaintextPath, JSON.stringify({ token: "legacy-token" }))
    expect(loadFileSecret(refused)).toBe("legacy-token")
    expect(readdirSync(join(home, "data")).includes("github-auth.json")).toBe(true)
  })

  it("refuses a new value without consent and leaves the stored one alone", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    saveFileSecret(secret, "first-token")
    expect(() => saveFileSecret(fixture(home, false), "second-token")).toThrow(SecretStorageError)
    expect(loadFileSecret(secret)).toBe("first-token")
  })

  it("reads a consented plaintext value instead of ciphertext it cannot decrypt", () => {
    const home = makeHome("mauscode-file-secret-")
    saveFileSecret(fixture(home), "first-token")
    const consented = fixture(home, false, true)
    saveFileSecret(consented, "second-token")
    expect(loadFileSecret(consented)).toBe("second-token")
    expect(
      readdirSync(join(home, "data")).filter((name) => name.includes(".unreadable-")),
    ).toHaveLength(1)
  })

  it("reads a consented plaintext value when the backend cannot protect ciphertext", () => {
    const home = makeHome("mauscode-file-secret-")
    saveFileSecret(fixture(home), "first-token")
    // Linux basic_text reports encryption while using a fixed key, so it does
    // not count as protection; the older ciphertext must stop winning on read.
    const hardcoded = fixture(home, true, true, "basic_text")
    saveFileSecret(hardcoded, "second-token")
    expect(loadFileSecret(hardcoded)).toBe("second-token")
    expect(
      readdirSync(join(home, "data")).filter((name) => name.includes(".unreadable-")),
    ).toHaveLength(1)
  })

  it("clears both files on sign-out", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    saveFileSecret(secret, "synthetic-token")
    clearFileSecret(secret)
    expect(readdirSync(join(home, "data"))).toHaveLength(0)
  })
})
