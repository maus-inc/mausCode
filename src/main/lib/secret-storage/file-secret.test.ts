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

  it("names the file that keeps a new value from loading, and saves the old one", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    // A `.dat` this version never wrote itself holds readable plaintext. While
    // it is there it is the only source reads use, so the write is refused and
    // the value it already holds stays readable.
    mkdirSync(join(home, "data"), { recursive: true })
    writeFileSync(secret.filePath, "plain-text-token")
    const consented = fixture(home, false, true)
    expect(() => saveFileSecret(consented, "synthetic-token")).toThrow(SecretStorageError)
    expect(loadFileSecret(consented)).toBe("plain-text-token")
  })

  it("refuses a plaintext replacement when the old bytes cannot be moved aside", () => {
    const home = makeHome("mauscode-file-secret-")
    const secret = fixture(home)
    // The stored file is an unreadable directory, so the stash cannot move it,
    // and it would keep winning on read over anything written now.
    mkdirSync(secret.filePath, { recursive: true })
    const consented = fixture(home, false, true)
    expect(() => saveFileSecret(consented, "synthetic-token")).toThrow(SecretStorageError)
  })

  it("is quiet when there is nothing to clear", () => {
    const home = makeHome("mauscode-file-secret-")
    // No data directory at all, which is the state before the first write.
    expect(() => clearFileSecret(fixture(home))).not.toThrow()
  })

  it("clears the stashed ciphertext copy too", () => {
    const home = makeHome("mauscode-file-secret-")
    saveFileSecret(fixture(home), "first-token")
    // A keyring that cannot read the first value moves it aside under a recovery
    // name; sign-out has to remove that copy as well.
    saveFileSecret(fixture(home, false, true), "second-token")
    const dir = join(home, "data")
    expect(readdirSync(dir).filter((name) => name.includes(".unreadable-"))).toHaveLength(1)
    clearFileSecret(fixture(home))
    expect(readdirSync(dir)).toHaveLength(0)
  })
})
