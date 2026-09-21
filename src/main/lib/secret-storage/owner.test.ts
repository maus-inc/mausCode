import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
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
