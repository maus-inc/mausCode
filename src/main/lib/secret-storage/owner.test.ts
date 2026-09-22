import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  buildStatus,
  decodeBytes,
  decodeStoredBase64,
  encodeSecret,
  inspectBytes,
  inspectStoredBase64,
  readAvailability,
  resolveProtection,
  stashUnreadableCiphertext,
  writeCredentialTempFile,
} from "./owner"
import { fakeKeychain, makeHome } from "./test-support"
import { EMPTY_METADATA, SecretStorageError, type SecretStorageMetadata } from "./types"

const consent: SecretStorageMetadata = {
  version: 1,
  plaintextConsent: true,
  plaintextConsentAt: "2026-09-20T00:00:00.000Z",
}

describe("secret storage owner", () => {
  it("round trips an encrypted value", () => {
    const keychain = fakeKeychain()
    const prepared = encodeSecret("sk-live-value", "os-encryption", keychain)
    expect(prepared.ciphertext?.subarray(0, 3).toString("latin1")).toBe("v10")
    const bytes = prepared.ciphertext ?? Buffer.alloc(0)
    expect(decodeBytes(bytes, keychain, "The key")).toEqual({
      value: "sk-live-value",
      protection: "os-encryption",
    })
    expect(decodeStoredBase64(bytes.toString("base64"), keychain, "The key").value).toBe(
      "sk-live-value",
    )
  })

  it("keeps legacy base64 plaintext readable whether or not a keyring is available", () => {
    const legacy = Buffer.from("sk-legacy-value", "utf-8").toString("base64")
    const available = fakeKeychain({ available: true })
    const unavailable = fakeKeychain({ available: false })
    expect(decodeStoredBase64(legacy, available, "The key")).toEqual({
      value: "sk-legacy-value",
      protection: "plaintext",
    })
    expect(decodeStoredBase64(legacy, unavailable, "The key").value).toBe("sk-legacy-value")
    expect(inspectStoredBase64(legacy)).toBe("plaintext")
    expect(inspectStoredBase64("")).toBe("unknown")
  })

  it("refuses to read ciphertext when no keyring can decrypt it", () => {
    const keychain = fakeKeychain({ available: true })
    const prepared = encodeSecret("sk-live-value", "os-encryption", keychain)
    keychain.setAvailable(false)
    const ciphertext = prepared.ciphertext ?? Buffer.alloc(0)
    expect(() => decodeBytes(ciphertext, keychain, "The key")).toThrow(SecretStorageError)
    expect(() => decodeStoredBase64(ciphertext.toString("base64"), keychain, "The key")).toThrow(
      SecretStorageError,
    )
    expect(ciphertext.subarray(0, 3).toString("latin1")).toBe("v10")
    expect(inspectBytes(ciphertext)).toBe("os-encryption")
    expect(ciphertext.equals(prepared.ciphertext ?? Buffer.alloc(0))).toBe(true)
  })

  it("rejects a payload that is neither ciphertext nor recognized plaintext", () => {
    const keychain = fakeKeychain()
    expect(() => decodeBytes(Buffer.from([0xff, 0xfe, 0x00, 0x01]), keychain, "The key")).toThrow(
      SecretStorageError,
    )
    expect(() => decodeBytes(Buffer.from("v10broken", "utf-8"), keychain, "The key")).toThrow(
      SecretStorageError,
    )
    expect(() => decodeBytes(Buffer.alloc(0), keychain, "The key")).toThrow(SecretStorageError)
    expect(() => decodeStoredBase64("!!!not base64!!!", keychain, "The key")).toThrow(
      SecretStorageError,
    )
  })

  it("refuses text whose characters the decoder would ignore", () => {
    const keychain = fakeKeychain()
    // Decoding this drops the bang and yields "hello", so a corrupted column
    // would be handed back as a credential instead of being refused.
    expect(Buffer.from("aGVsbG8=!", "base64").toString("utf-8")).toBe("hello")
    expect(() => decodeStoredBase64("aGVsbG8=!", keychain, "The key")).toThrow(SecretStorageError)
    expect(inspectStoredBase64("aGVsbG8=!")).toBe("unknown")
    // The same text without the stray character is a value this store wrote.
    expect(decodeStoredBase64("aGVsbG8=", keychain, "The key").value).toBe("hello")
    expect(inspectStoredBase64("aGVsbG8=")).toBe("plaintext")
  })

  it("round trips a large column without scanning it quadratically", () => {
    const keychain = fakeKeychain()
    // A text column can hold a whole credential blob, and the check walks the
    // characters once, so a column of this size is read in a few milliseconds.
    const value = `sk-${"a".repeat(200_000)}`
    const encoded = Buffer.from(value, "utf-8").toString("base64")
    const started = Date.now()
    expect(decodeStoredBase64(encoded, keychain, "The key").value).toBe(value)
    expect(Date.now() - started).toBeLessThan(1000)
  })

  it("refuses a plaintext write without consent and allows it with consent", () => {
    const keychain = fakeKeychain({ available: false })
    const base = { keychain, context: "This credential" }
    expect(() => resolveProtection({ ...base, metadata: EMPTY_METADATA })).toThrow(
      SecretStorageError,
    )
    expect(resolveProtection({ ...base, metadata: consent })).toBe("plaintext")
  })

  it("requires consent even when the target can only hold plaintext", () => {
    const keychain = fakeKeychain({ available: true })
    const base = { keychain, context: "The CLI credential file", plaintextOnly: true }
    expect(() => resolveProtection({ ...base, metadata: EMPTY_METADATA })).toThrow(
      SecretStorageError,
    )
    expect(resolveProtection({ ...base, metadata: consent })).toBe("plaintext")
  })

  it("always prefers encryption for app-owned values", () => {
    const keychain = fakeKeychain({ available: true })
    expect(resolveProtection({ keychain, metadata: consent, context: "This credential" })).toBe(
      "os-encryption",
    )
  })

  it("refuses when consent metadata cannot be read", () => {
    const keychain = fakeKeychain({ available: false })
    expect(() =>
      resolveProtection({
        keychain,
        metadata: EMPTY_METADATA,
        metadataError: "secret-storage.json could not be read or parsed",
        context: "This credential",
      }),
    ).toThrow(SecretStorageError)
  })

  it("treats the Linux basic_text backend as unprotected", () => {
    const keychain = fakeKeychain({ available: true, backend: "basic_text" })
    const availability = readAvailability(keychain)
    expect(availability.usable).toBe(false)
    expect(availability.hardcodedKey).toBe(true)
    const status = buildStatus({ keychain, metadata: EMPTY_METADATA, metadataError: null })
    expect(status.protection).toBe("hardcoded-key")
    expect(status.appWritesProtected).toBe(false)
    expect(status.reason).toBe("hardcoded-key-backend")
    expect(() =>
      resolveProtection({ keychain, metadata: EMPTY_METADATA, context: "This credential" }),
    ).toThrow(SecretStorageError)
  })

  it("keeps ciphertext aside when the backend cannot protect new values", () => {
    const home = makeHome("mauscode-owner-")
    const file = join(home, "data", "github-auth.dat")
    mkdirSync(join(home, "data"), { recursive: true })
    const usable = fakeKeychain()
    writeFileSync(file, usable.encryptString("sk-live-value"))

    const hardcoded = fakeKeychain({ available: true, backend: "basic_text" })
    expect(stashUnreadableCiphertext(file, hardcoded, "The GitHub token").stashed).toBe(true)
    expect(existsSync(file)).toBe(false)

    // A keyring that can protect new values keeps the file where it is.
    writeFileSync(file, usable.encryptString("sk-live-value"))
    expect(stashUnreadableCiphertext(file, usable, "The GitHub token").stashed).toBe(false)
    expect(readFileSync(file).subarray(0, 3).toString("latin1")).toBe("v10")
  })

  it("keeps both copies when two moves land in the same millisecond", () => {
    vi.useFakeTimers({ now: new Date("2026-09-22T12:00:00.000Z") })
    try {
      const home = makeHome("mauscode-owner-")
      const file = join(home, "data", "github-auth.dat")
      mkdirSync(join(home, "data"), { recursive: true })
      const usable = fakeKeychain()
      writeFileSync(file, usable.encryptString("sk-first-value"))
      // An earlier move already holds the name this move builds from the clock.
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const taken = `${file}.unreadable-${stamp}`
      writeFileSync(taken, usable.encryptString("sk-even-older-value"))

      const hardcoded = fakeKeychain({ available: true, backend: "basic_text" })
      const result = stashUnreadableCiphertext(file, hardcoded, "The GitHub token")

      expect(result.stashed).toBe(true)
      expect(result.path).toBe(`${taken}-2`)
      // The copy that held the name keeps its bytes, and the moved file is
      // under the next free name.
      expect(usable.decryptString(readFileSync(taken))).toBe("sk-even-older-value")
      expect(usable.decryptString(readFileSync(result.path ?? ""))).toBe("sk-first-value")
      expect(existsSync(file)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("never writes a temporary file through a planted link", () => {
    const home = makeHome("mauscode-owner-")
    mkdirSync(home, { recursive: true })
    const file = join(home, "auth.dat")
    // The name an older version used was predictable, so a link placed there
    // could redirect the bytes. The write must not use it at all.
    const planted = `${file}.tmp-${process.pid}`
    const outside = join(home, "attacker-target")
    symlinkSync(outside, planted)

    const temp = writeCredentialTempFile(file, "v10-credential-bytes")

    expect(temp).not.toBe(planted)
    expect(temp.startsWith(`${file}.tmp-`)).toBe(true)
    expect(readFileSync(temp, "utf-8")).toBe("v10-credential-bytes")
    expect(existsSync(outside)).toBe(false)
    expect(lstatSync(planted).isSymbolicLink()).toBe(true)
  })

  it("names why a file it could not move aside stayed", () => {
    const home = makeHome("mauscode-owner-")
    mkdirSync(home, { recursive: true })
    // A directory cannot be read as a file, so the move cannot happen and the
    // reason is reported instead of a silent false.
    const file = join(home, "auth.dat")
    mkdirSync(file)
    const result = stashUnreadableCiphertext(file, fakeKeychain(), "The GitHub token")
    expect(result.stashed).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(result.path).toBeNull()
  })

  it("says nothing about moving aside a file that was never written", () => {
    const home = makeHome("mauscode-owner-")
    const file = join(home, "data", "github-auth.dat")
    const result = stashUnreadableCiphertext(file, fakeKeychain({ available: false }), "The token")
    // The refusal guard also checks the file exists, so a first save is not
    // turned away and no failure is reported for it.
    expect(result).toEqual({ stashed: false, path: null, reason: null })
  })

  it("reports an encryption failure instead of storing anything", () => {
    const keychain = fakeKeychain({ encryptThrows: true })
    expect(() => encodeSecret("sk-live-value", "os-encryption", keychain)).toThrow(
      SecretStorageError,
    )
  })

  it("separates write policy from consent in status", () => {
    const ready = buildStatus({
      keychain: fakeKeychain({ available: true }),
      metadata: EMPTY_METADATA,
      metadataError: null,
    })
    expect(ready.appWritesProtected).toBe(true)
    expect(ready.plaintextWritesAllowed).toBe(false)
    const unavailable = buildStatus({
      keychain: fakeKeychain({ available: false, backend: "gnome_libsecret" }),
      metadata: consent,
      metadataError: null,
    })
    expect(unavailable.appWritesProtected).toBe(false)
    expect(unavailable.plaintextWritesAllowed).toBe(true)
    expect(unavailable.plaintextConsentAt).toBe("2026-09-20T00:00:00.000Z")
    expect(unavailable.reason).toBe("encryption-unavailable")
  })
})
