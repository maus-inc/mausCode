/**
 * One credential kept as encrypted bytes in a `.dat` file, with a JSON
 * companion used by earlier versions for the plaintext fallback. Every write
 * is verified by reading it back before it replaces the saved file, and the
 * plaintext companion is only removed after an encrypted write succeeded.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { stashUnreadableCiphertext } from "./owner"
import type { Keychain, SecretWriter } from "./types"

export type FileSecret = {
  /** Encrypted bytes, for example `github-auth.dat`. */
  filePath: string
  /** Plaintext JSON companion, for example `github-auth.json`. */
  plaintextPath: string
  /** Field name inside the JSON companion. */
  field: string
  /** Human label used in errors and logs. Never a value. */
  context: string
  store: SecretWriter
  /** Needed to tell an unreadable ciphertext from a readable one. */
  keychain: Keychain
}

function ensureDir(path: string): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
}

export function saveFileSecret(secret: FileSecret, value: string): void {
  const prepared = secret.store.prepare(secret.context, value)
  ensureDir(secret.filePath)

  if (prepared.ciphertext) {
    const temp = `${secret.filePath}.tmp-${process.pid}`
    writeFileSync(temp, prepared.ciphertext, { mode: 0o600 })
    if (secret.store.read(readFileSync(temp), secret.context) !== value) {
      unlinkSync(temp)
      throw new Error(
        `${secret.context} could not be read back after encryption. Nothing was changed.`,
      )
    }
    renameSync(temp, secret.filePath)
    if (existsSync(secret.plaintextPath)) {
      try {
        unlinkSync(secret.plaintextPath)
      } catch (error) {
        console.error(`[SecretStore] Could not remove ${secret.plaintextPath}:`, error)
      }
    }
    return
  }

  // A stored file that cannot be decrypted now would keep winning on read, so
  // it is kept aside rather than deleted.
  stashUnreadableCiphertext(secret.filePath, secret.keychain, secret.context)
  ensureDir(secret.plaintextPath)
  writeFileSync(secret.plaintextPath, `${JSON.stringify({ [secret.field]: value })}\n`, {
    mode: 0o600,
  })
}

export type FileSecretRead = {
  value: string | null
  /** Set when a stored file exists but cannot be read. Never holds the value. */
  error: string | null
}

/**
 * Reads the credential and says whether a stored file was unreadable, so a
 * caller that reports status can tell "nothing saved" from "cannot be read".
 * Once the encrypted file exists it is the only source, and an unreadable
 * payload is never replaced by a plaintext copy.
 */
export function readFileSecret(secret: FileSecret): FileSecretRead {
  if (existsSync(secret.filePath)) {
    try {
      const value = secret.store.read(readFileSync(secret.filePath), secret.context)
      return { value: value.length > 0 ? value : null, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[SecretStore] Could not read ${secret.context}:`, message)
      return { value: null, error: message }
    }
  }

  if (!existsSync(secret.plaintextPath)) return { value: null, error: null }
  let value: string
  try {
    const parsed = JSON.parse(readFileSync(secret.plaintextPath, "utf-8")) as Record<
      string,
      unknown
    >
    const field = parsed[secret.field]
    if (typeof field !== "string") return { value: null, error: null }
    value = field
  } catch {
    return { value: null, error: null }
  }

  try {
    saveFileSecret(secret, value)
  } catch (error) {
    console.error(
      `[SecretStore] Keeping ${secret.plaintextPath} because it could not move to encrypted storage:`,
      error instanceof Error ? error.message : error,
    )
  }
  return { value, error: null }
}

/** The value alone, for callers that treat an unreadable file as absent. */
export function loadFileSecret(secret: FileSecret): string | null {
  return readFileSecret(secret).value
}

export function clearFileSecret(secret: FileSecret): void {
  for (const path of [secret.filePath, secret.plaintextPath]) {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Clearing continues for the remaining path.
    }
  }
}

export function fileSecretPaths(
  userDataPath: string,
  name: string,
): Pick<FileSecret, "filePath" | "plaintextPath"> {
  return {
    filePath: join(userDataPath, "data", `${name}-auth.dat`),
    plaintextPath: join(userDataPath, "data", `${name}-auth.json`),
  }
}
