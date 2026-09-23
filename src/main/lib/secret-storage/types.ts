/**
 * Shared types for app secret storage. This module imports no Electron APIs so
 * the policy logic stays testable with an injected keychain fake.
 */

export type SecretProtection = "os-encryption" | "hardcoded-key" | "plaintext"

export type SecretStorageReason =
  | "ready"
  | "encryption-unavailable"
  | "hardcoded-key-backend"
  | "consent-required"
  | "metadata-unreadable"
  | "ciphertext-unreadable"

export type SecretStorageStatus = {
  encryptionAvailable: boolean
  protection: SecretProtection
  /** Raw Linux backend id when the platform reports one. */
  backend: string | null
  plaintextConsent: boolean
  plaintextConsentAt: string | null
  metadataError: string | null
  /** Encryption of new app-owned values is possible right now. */
  appWritesProtected: boolean
  /** Plaintext may be written when encryption cannot protect the target. */
  plaintextWritesAllowed: boolean
  reason: SecretStorageReason
}

export type SecretStorageMetadata = {
  version: 1
  plaintextConsent: boolean
  plaintextConsentAt: string | null
}

export type PrepareResult = {
  /** Ciphertext for binary `.dat` style files, when encryption is in use. */
  ciphertext: Buffer | null
  /** Plaintext payload for `.json` companions or external stores. */
  plaintext: string | null
  protection: SecretProtection
}

export type Keychain = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(payload: Buffer): string
  /** Linux backend id, or null on other platforms. */
  selectedBackend(): string | null
}

/** The read and write surface a stored secret needs. `SecretStore` implements it. */
export type SecretWriter = {
  /** The keychain in use, so a caller can tell unreadable ciphertext apart. */
  readonly keychain: Keychain
  prepare(context: string, value: string, plaintextOnly?: boolean): PrepareResult
  /** Reads a value recorded as plaintext or as base64 of stored bytes. */
  read(payload: string | Buffer, context: string): string
  /** Reads bytes recorded as encrypted, throwing when they cannot be read. */
  readStoredBytes(payload: Buffer, context: string): string
}

export class SecretStorageError extends Error {
  constructor(
    public readonly kind: SecretStorageReason,
    message: string,
  ) {
    super(message)
    this.name = "SecretStorageError"
  }
}

export const EMPTY_METADATA: SecretStorageMetadata = {
  version: 1,
  plaintextConsent: false,
  plaintextConsentAt: null,
}
