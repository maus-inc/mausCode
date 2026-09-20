/**
 * The app secret store. This module imports no Electron APIs so it can be
 * unit-tested with an injected keychain; `./index` wires it to the running app.
 */
import { grantPlaintextConsent, readMetadata, revokePlaintextConsent } from "./metadata"
import {
  buildStatus,
  decodeBytes,
  decodeStoredBase64,
  encodeSecret,
  inspectBytes,
  inspectStoredBase64,
  resolveProtection,
} from "./owner"
import type { Keychain, PrepareResult, SecretProtection, SecretStorageStatus } from "./types"

export class SecretStore {
  constructor(
    readonly userDataPath: string,
    readonly keychain: Keychain,
  ) {}

  status(): SecretStorageStatus {
    const read = readMetadata(this.userDataPath)
    return buildStatus({
      keychain: this.keychain,
      metadata: read.metadata,
      metadataError: read.error,
    })
  }

  /** Records or clears durable plaintext permission for future writes. */
  setPlaintextConsent(consent: boolean): SecretStorageStatus {
    if (consent) {
      grantPlaintextConsent(this.userDataPath)
    } else {
      revokePlaintextConsent(this.userDataPath)
    }
    return this.status()
  }

  /**
   * Value prepared for a store that keeps a binary file plus a `.json`
   * companion. Nothing is written here; the caller owns file layout.
   */
  prepare(context: string, value: string, plaintextOnly = false): PrepareResult {
    const read = readMetadata(this.userDataPath)
    const protection = resolveProtection({
      keychain: this.keychain,
      metadata: read.metadata,
      metadataError: read.error,
      plaintextOnly,
      context,
    })
    return encodeSecret(value, protection, this.keychain)
  }

  /**
   * Reads a value written by this store or by an earlier version. Throws a
   * typed error for unreadable payloads so callers never treat ciphertext as a
   * credential.
   */
  read(payload: string | Buffer, context: string): string {
    return typeof payload === "string"
      ? decodeStoredBase64(payload, this.keychain, context).value
      : decodeBytes(payload, this.keychain, context).value
  }

  /**
   * Decodes bytes a store recorded as encrypted. Throws when the OS keyring
   * cannot read them, so a caller never receives a substitute value.
   */
  readStoredBytes(payload: Buffer, context: string): string {
    return decodeBytes(payload, this.keychain, context).value
  }

  /** Encodes for a text column, keeping the base64 representation. */
  encodeForDatabase(context: string, value: string): string {
    const prepared = this.prepare(context, value)
    if (prepared.ciphertext) return prepared.ciphertext.toString("base64")
    return Buffer.from(prepared.plaintext ?? "", "utf-8").toString("base64")
  }

  decodeFromDatabase(context: string, payload: string): string {
    return this.read(payload, context)
  }

  protectionFor(payload: string | Buffer): SecretProtection | "unknown" {
    return typeof payload === "string" ? inspectStoredBase64(payload) : inspectBytes(payload)
  }
}
