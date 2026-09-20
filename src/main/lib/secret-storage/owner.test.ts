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
} from "./owner"
import {
  EMPTY_METADATA,
  type Keychain,
  SecretStorageError,
  type SecretStorageMetadata,
} from "./types"

type FakeKeychainOptions = {
  available?: boolean
  backend?: string | null
  encryptThrows?: boolean
}

function fakeKeychain(
  options: FakeKeychainOptions = {},
): Keychain & { setAvailable(value: boolean): void } {
  let available = options.available ?? true
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => {
      if (options.encryptThrows) throw new Error("keyring refused")
      return Buffer.concat([
        Buffer.from("v10", "latin1"),
        Buffer.from([0, 255, 1]),
        Buffer.from(value, "utf-8").map((byte) => byte ^ 0x5a),
      ])
    },
    decryptString: (payload) => {
      const head = payload.subarray(0, 6)
      if (!head.equals(Buffer.from([118, 49, 48, 0, 255, 1]))) {
        throw new Error("Ciphertext does not appear to be encrypted.")
      }
      return Buffer.from(payload.subarray(6).map((byte) => byte ^ 0x5a)).toString("utf-8")
    },
    selectedBackend: () => options.backend ?? null,
    setAvailable: (value: boolean) => {
      available = value
    },
  }
}

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
