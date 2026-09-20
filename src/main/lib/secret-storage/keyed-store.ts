/**
 * A keyed secret file for values the renderer used to keep in browser storage.
 * Each entry records how it was stored, so a reader never guesses, and each
 * write is verified by reading the file back before it replaces the old one.
 * The file holds no Electron dependency and is unit-tested directly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { SecretProtection, SecretWriter } from "./types"

export const KEYED_SECRET_FILE = "renderer-secrets.json"

type StoredEntry = {
  protection: SecretProtection
  /** Base64 ciphertext under `os-encryption`, otherwise the stored text. */
  payload: string
}

type StoredFile = {
  version: 1
  entries: Record<string, StoredEntry>
}

export type KeyedStore = {
  filePath: string
  store: SecretWriter
}

export function keyedStorePath(userDataPath: string): string {
  return join(userDataPath, "data", KEYED_SECRET_FILE)
}

function emptyFile(): StoredFile {
  return { version: 1, entries: {} }
}

function readFile(path: string): { file: StoredFile; error: string | null } {
  if (!existsSync(path)) return { file: emptyFile(), error: null }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"))
    if (typeof parsed !== "object" || parsed === null) {
      return { file: emptyFile(), error: `${KEYED_SECRET_FILE} has an unrecognized shape` }
    }
    const candidate = parsed as Partial<StoredFile>
    if (
      candidate.version !== 1 ||
      typeof candidate.entries !== "object" ||
      candidate.entries === null
    ) {
      return { file: emptyFile(), error: `${KEYED_SECRET_FILE} has an unrecognized shape` }
    }
    return { file: candidate as StoredFile, error: null }
  } catch {
    return { file: emptyFile(), error: `${KEYED_SECRET_FILE} could not be read or parsed` }
  }
}

/** Reads every key the file holds. Unreadable entries are reported, not guessed. */
export function readKeyedSecrets(store: KeyedStore): {
  values: Record<string, string>
  error: string | null
} {
  const { file, error } = readFile(store.filePath)
  const values: Record<string, string> = {}
  let firstError = error
  for (const [key, entry] of Object.entries(file.entries)) {
    try {
      // The recorded protection decides how to decode; nothing is guessed.
      values[key] =
        entry.protection === "os-encryption"
          ? store.store.readStoredBytes(
              Buffer.from(entry.payload, "base64"),
              `The saved value for ${key}`,
            )
          : entry.payload
    } catch (readError) {
      firstError ??= readError instanceof Error ? readError.message : String(readError)
    }
  }
  return { values, error: firstError }
}

export function readKeyedSecret(store: KeyedStore, key: string): string | null {
  return readKeyedSecrets(store).values[key] ?? null
}

function writeFile(path: string, file: StoredFile): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
  renameSync(temp, path)
}

/**
 * Stores one keyed value. Throws when the value may not be stored, before the
 * file is touched.
 */
export function writeKeyedSecret(store: KeyedStore, key: string, value: string): void {
  const { file } = readFile(store.filePath)
  const prepared = store.store.prepare(`The saved value for ${key}`, value)
  const entry: StoredEntry =
    prepared.ciphertext === null
      ? { protection: "plaintext", payload: prepared.plaintext ?? "" }
      : { protection: prepared.protection, payload: prepared.ciphertext.toString("base64") }

  const next: StoredFile = { version: 1, entries: { ...file.entries, [key]: entry } }
  writeFile(store.filePath, next)

  const written = readFile(store.filePath)
  const stored = written.file.entries[key]
  const readBack =
    stored === undefined
      ? null
      : stored.protection === "os-encryption"
        ? store.store.readStoredBytes(
            Buffer.from(stored.payload, "base64"),
            `The saved value for ${key}`,
          )
        : stored.payload
  if (readBack !== value) {
    throw new Error(`The saved value for ${key} could not be read back after it was written.`)
  }
}

export function removeKeyedSecret(store: KeyedStore, key: string): void {
  const { file } = readFile(store.filePath)
  if (!(key in file.entries)) return
  const entries = { ...file.entries }
  delete entries[key]
  writeFile(store.filePath, { version: 1, entries })
}
