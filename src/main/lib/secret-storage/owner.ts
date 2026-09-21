/**
 * Encoding and storage policy for app-held secrets, with no Electron import so
 * it is unit-testable through an injected keychain.
 *
 * Encoding contract, in the order a reader resolves it:
 * - `v10`/`v11` prefixed bytes are OS-encrypted and must decrypt. A prefix in
 *   the clear is what Electron itself checks, so no decode path guesses.
 * - Anything else that is valid UTF-8 text is a legacy plaintext value written
 *   by an earlier version. Text columns hold base64 of those same bytes, so a
 *   legacy column decodes to the same value. It stays readable.
 * - Anything else is unreadable and is reported, never returned as a value.
 */
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import {
  type Keychain,
  type PrepareResult,
  type SecretProtection,
  SecretStorageError,
  type SecretStorageMetadata,
  type SecretStorageStatus,
} from "./types"

export { EMPTY_METADATA } from "./types"

/** Electron writes these prefixes in the clear, before the ciphertext. */
const CIPHER_PREFIXES = new Set(["v10", "v11"])

export type DecodeResult = {
  value: string
  protection: SecretProtection
}

function startsWithCipherPrefix(payload: Buffer): boolean {
  if (payload.length < 3) return false
  return CIPHER_PREFIXES.has(payload.subarray(0, 3).toString("latin1"))
}

/** The suffix `stashUnreadableCiphertext` adds to the file it moves aside. */
const STASH_SUFFIX = ".unreadable-"

/** The infix every write uses for the file it replaces its target with. */
const TEMP_INFIX = ".tmp-"

/**
 * Removes the temporary files an unfinished write left next to a credential
 * file. Each one carries the value that was being written, and the process that
 * created it may never run again, so the next write or a clear sweeps them.
 * Returns the paths that could not be removed.
 */
export function removeStaleTemps(filePath: string, keepPath?: string): string[] {
  const dir = dirname(filePath)
  if (!existsSync(dir)) return []
  const prefix = `${basename(filePath)}${TEMP_INFIX}`
  const left: string[] = []
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix)) continue
    const candidate = join(dir, name)
    if (candidate === keepPath) continue
    try {
      unlinkSync(candidate)
    } catch {
      left.push(candidate)
    }
  }
  return left
}

/**
 * Every stashed copy of one credential file, so a caller that has to remove the
 * credential can remove the copies too. An absent directory holds none. Any
 * other listing failure throws, because a clear that cannot rule out a stashed
 * copy must not report success.
 */
export function stashedCiphertextPaths(filePath: string): string[] {
  const dir = dirname(filePath)
  if (!existsSync(dir)) return []
  const prefix = `${basename(filePath)}${STASH_SUFFIX}`
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(dir, name))
}

/**
 * Moves a ciphertext file aside when the current keyring cannot protect it, so
 * a newer plaintext value can be read instead. The check matches the write
 * policy: a backend that may not protect new values (no keyring, or the Linux
 * `basic_text` backend) must not let its older bytes keep winning on read. The
 * bytes are kept under a timestamped name for recovery; nothing is deleted.
 */
export function stashUnreadableCiphertext(
  filePath: string,
  keychain: Keychain,
  context: string,
): { stashed: boolean; path: string | null; reason: string | null } {
  try {
    const payload = readFileSync(filePath)
    if (!startsWithCipherPrefix(payload)) return { stashed: false, path: null, reason: null }
    try {
      // With a usable keyring the bytes may still belong to another keyring,
      // which the decrypt call reveals.
      if (readAvailability(keychain).usable) {
        keychain.decryptString(payload)
        return { stashed: false, path: null, reason: null }
      }
      throw new Error("no usable keyring")
    } catch {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const target = `${filePath}${STASH_SUFFIX}${stamp}`
      renameSync(filePath, target)
      console.warn(
        `[SecretStore] ${context} could not be decrypted, so the file was kept at ${target} and is no longer read.`,
      )
      return { stashed: true, path: target, reason: null }
    }
  } catch (error) {
    // The file is still where reads look for it, so the caller learns why it
    // stayed instead of reading a silent false as "nothing to move aside".
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`[SecretStore] ${context} could not be moved aside:`, reason)
    return { stashed: false, path: null, reason }
  }
}

/**
 * Inspection without decoding. `v10`/`v11` in the clear is the only signal
 * that a payload is ciphertext, matching what Electron itself checks.
 */
export function inspectBytes(payload: Buffer): SecretProtection | "unknown" {
  if (startsWithCipherPrefix(payload)) return "os-encryption"
  if (isUtf8Text(payload)) return "plaintext"
  return "unknown"
}

/** Stored text columns hold base64 of the bytes a file would hold. */
export function inspectStoredBase64(payload: string): SecretProtection | "unknown" {
  return inspectBytes(Buffer.from(payload, "base64"))
}

function isUtf8Text(payload: Buffer): boolean {
  if (payload.length === 0) return false
  if (payload.includes(0)) return false
  const text = payload.toString("utf-8")
  return Buffer.from(text, "utf-8").equals(payload) && text.trim().length > 0
}

/**
 * Decodes stored bytes. Prefixed bytes are ciphertext and must decrypt.
 * Anything else is a value a previous version wrote in the clear, which stays
 * readable. An unresolvable payload raises instead of returning a wrong value.
 */
export function decodeBytes(payload: Buffer, keychain: Keychain, context: string): DecodeResult {
  if (payload.length === 0) {
    throw new SecretStorageError("ciphertext-unreadable", `${context} is empty`)
  }
  if (!startsWithCipherPrefix(payload)) {
    if (isUtf8Text(payload)) {
      return { value: payload.toString("utf-8"), protection: "plaintext" }
    }
    throw new SecretStorageError(
      "ciphertext-unreadable",
      `${context} is neither ciphertext nor readable text. The saved value is kept unchanged.`,
    )
  }
  if (!keychain.isEncryptionAvailable()) {
    throw new SecretStorageError(
      "ciphertext-unreadable",
      `${context} is encrypted and no OS keyring can decrypt it. The saved value is kept unchanged.`,
    )
  }
  try {
    return { value: keychain.decryptString(payload), protection: "os-encryption" }
  } catch {
    throw new SecretStorageError(
      "ciphertext-unreadable",
      `${context} could not be decrypted with the current OS keyring. The saved value is kept unchanged.`,
    )
  }
}

/** Decodes a base64 text column written by this store or an earlier version. */
export function decodeStoredBase64(
  payload: string,
  keychain: Keychain,
  context: string,
): DecodeResult {
  if (!payload) {
    throw new SecretStorageError("ciphertext-unreadable", `${context} is empty`)
  }
  const bytes = Buffer.from(payload, "base64")
  if (bytes.length === 0) {
    throw new SecretStorageError("ciphertext-unreadable", `${context} is empty`)
  }
  return decodeBytes(bytes, keychain, context)
}

type Availability = {
  /** The keyring protects new values. */
  usable: boolean
  /** Electron reports encryption, but the Linux backend uses a fixed key. */
  hardcodedKey: boolean
  backend: string | null
}

/**
 * Reads the keychain state. Electron reports Linux `basic_text` through the
 * same availability call an unlocked keyring uses, and that backend encrypts
 * with a fixed key, so it is treated as unprotected.
 */
export function readAvailability(keychain: Keychain): Availability {
  const backend = keychain.selectedBackend()
  const reported = keychain.isEncryptionAvailable()
  if (backend === "basic_text") {
    return { usable: false, hardcodedKey: true, backend }
  }
  return { usable: reported, hardcodedKey: false, backend }
}

function protectionFrom(availability: Availability): SecretProtection {
  if (availability.usable) return "os-encryption"
  if (availability.hardcodedKey) return "hardcoded-key"
  return "plaintext"
}

export type ProtectionRequest = {
  keychain: Keychain
  metadata: SecretStorageMetadata
  /** The target can only hold plaintext, for example another tool's file. */
  plaintextOnly?: boolean
  metadataError?: string | null
  context: string
}

/**
 * Decides how a new value may be written. Encryption wins whenever it is
 * available, and a target that only supports plaintext still needs consent.
 */
export function resolveProtection(request: ProtectionRequest): SecretProtection {
  const availability = readAvailability(request.keychain)
  if (!request.plaintextOnly && availability.usable) {
    return "os-encryption"
  }
  if (request.metadataError) {
    throw new SecretStorageError(
      "metadata-unreadable",
      `Plaintext permission cannot be read because ${request.metadataError}. ${request.context} was not saved.`,
    )
  }
  if (!request.metadata.plaintextConsent) {
    throw new SecretStorageError(
      "consent-required",
      request.plaintextOnly
        ? `${request.context} can only be stored as plaintext on this system, and plaintext storage is not permitted.`
        : `${request.context} cannot be encrypted because no OS keyring is available, and plaintext storage is not permitted.`,
    )
  }
  return "plaintext"
}

/** Encodes a new value under the resolved protection. */
export function encodeSecret(
  value: string,
  protection: SecretProtection,
  keychain: Keychain,
): PrepareResult {
  if (protection === "os-encryption") {
    let ciphertext: Buffer
    try {
      ciphertext = keychain.encryptString(value)
    } catch {
      throw new SecretStorageError(
        "encryption-unavailable",
        "Encryption failed. Nothing was saved.",
      )
    }
    return { ciphertext, plaintext: null, protection }
  }
  return { ciphertext: null, plaintext: value, protection }
}

function statusReason(
  availability: Availability,
  metadataError: string | null,
): SecretStorageStatus["reason"] {
  if (metadataError) return "metadata-unreadable"
  if (availability.usable) return "ready"
  if (availability.hardcodedKey) return "hardcoded-key-backend"
  return "encryption-unavailable"
}

export function buildStatus(input: {
  keychain: Keychain
  metadata: SecretStorageMetadata
  metadataError: string | null
}): SecretStorageStatus {
  const availability = readAvailability(input.keychain)
  const protection = protectionFrom(availability)
  const reason = statusReason(availability, input.metadataError)
  return {
    encryptionAvailable: availability.usable,
    protection,
    backend: availability.backend,
    plaintextConsent: input.metadata.plaintextConsent,
    plaintextConsentAt: input.metadata.plaintextConsentAt,
    metadataError: input.metadataError,
    appWritesProtected: availability.usable,
    plaintextWritesAllowed: input.metadata.plaintextConsent && !input.metadataError,
    reason,
  }
}
