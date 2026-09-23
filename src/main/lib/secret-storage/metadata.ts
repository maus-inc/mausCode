/**
 * Persisted plaintext-storage consent. The file holds no secrets and lives in
 * userData beside the stores it governs. A malformed file is preserved rather
 * than overwritten, so an unreadable state can never silently grant consent.
 */
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { unusedRecoveryName, writeCredentialTempFile } from "./owner"
import { EMPTY_METADATA, type SecretStorageMetadata } from "./types"

export const METADATA_FILE_NAME = "secret-storage.json"

export type MetadataRead = {
  metadata: SecretStorageMetadata
  error: string | null
}

export function metadataPath(userDataPath: string): string {
  return join(userDataPath, METADATA_FILE_NAME)
}

function isMetadata(value: unknown): value is SecretStorageMetadata {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.version === 1 &&
    typeof candidate.plaintextConsent === "boolean" &&
    (candidate.plaintextConsentAt === null || typeof candidate.plaintextConsentAt === "string")
  )
}

/**
 * Reads consent metadata. An absent file means no consent and is not an error.
 * An unreadable or malformed file leaves consent ungranted and reports why.
 */
export function readMetadata(userDataPath: string): MetadataRead {
  const path = metadataPath(userDataPath)
  if (!existsSync(path)) {
    return { metadata: { ...EMPTY_METADATA }, error: null }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"))
    if (!isMetadata(parsed)) {
      return {
        metadata: { ...EMPTY_METADATA },
        error: `${METADATA_FILE_NAME} has an unrecognized shape`,
      }
    }
    return { metadata: parsed, error: null }
  } catch {
    return {
      metadata: { ...EMPTY_METADATA },
      error: `${METADATA_FILE_NAME} could not be read or parsed`,
    }
  }
}

/**
 * Writes consent metadata atomically at owner-only permissions. A file that
 * cannot be parsed is moved aside first so the user can inspect it.
 */
export function writeMetadata(userDataPath: string, metadata: SecretStorageMetadata): void {
  const path = metadataPath(userDataPath)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  const previous = readMetadata(userDataPath)
  if (previous.error) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    try {
      renameSync(path, unusedRecoveryName(`${path}.invalid-${stamp}`))
    } catch {
      // The original stays in place when it cannot be moved.
    }
  }
  const temp = writeCredentialTempFile(path, `${JSON.stringify(metadata, null, 2)}\n`)
  renameSync(temp, path)
}

export function grantPlaintextConsent(
  userDataPath: string,
  grantedAt = new Date(),
): SecretStorageMetadata {
  const metadata: SecretStorageMetadata = {
    version: 1,
    plaintextConsent: true,
    plaintextConsentAt: grantedAt.toISOString(),
  }
  writeMetadata(userDataPath, metadata)
  return metadata
}

export function revokePlaintextConsent(userDataPath: string): SecretStorageMetadata {
  const metadata: SecretStorageMetadata = {
    version: 1,
    plaintextConsent: false,
    plaintextConsentAt: null,
  }
  writeMetadata(userDataPath, metadata)
  return metadata
}
