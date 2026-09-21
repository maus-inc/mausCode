/**
 * A keyed secret file for values the renderer used to keep in browser storage.
 * Each entry records how it was stored, so a reader never guesses, and each
 * write is verified by reading the file back before it replaces the old one.
 * The file holds no Electron dependency and is unit-tested directly.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs"
import { dirname, join } from "node:path"
import { removeStaleTemps, writeCredentialTempFile } from "./owner"
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

/**
 * An entry records how it was stored, so a reader never guesses. Anything else,
 * including a protection value this version does not know, is reported.
 */
function isStoredEntry(value: unknown): value is StoredEntry {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as Partial<StoredEntry>
  if (candidate.protection !== "os-encryption" && candidate.protection !== "plaintext") {
    return false
  }
  return typeof candidate.payload === "string"
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
    if (!isStoredEntry(entry)) {
      firstError ??= `The saved value for ${key} has an unrecognized shape`
      continue
    }
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

/**
 * Writes through a temporary file and replaces the saved file only after the
 * temporary file was read back and `verify` accepted it, so a value that cannot
 * be read back leaves the previous file in place.
 */
function writeFile(path: string, file: StoredFile, verify?: (written: StoredFile) => void): void {
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}`
  removeStaleTemps(path, temp)
  writeCredentialTempFile(temp, `${JSON.stringify(file, null, 2)}\n`)
  try {
    const written = readFile(temp)
    if (written.error) throw new Error(written.error)
    verify?.(written.file)
    renameSync(temp, path)
  } catch (error) {
    try {
      if (existsSync(temp)) unlinkSync(temp)
    } catch {
      // The failure worth reporting is the one that stopped the write.
    }
    throw error
  }
}

/**
 * Stores one keyed value. Throws when the value may not be stored, before the
 * file is touched.
 */
export function writeKeyedSecret(store: KeyedStore, key: string, value: string): void {
  const { file, error } = readFile(store.filePath)
  // The refusal must land before anything moves: a write that is not permitted
  // has to leave the store exactly as it was.
  const prepared = store.store.prepare(`The saved value for ${key}`, value)
  // A file this version cannot read holds entries it cannot carry over, so the
  // bytes are kept under a recovery name instead of being replaced by this write.
  const setAside = error !== null ? setAsideUnreadableFile(store.filePath) : null
  const entry: StoredEntry =
    prepared.ciphertext === null
      ? { protection: "plaintext", payload: prepared.plaintext ?? "" }
      : { protection: prepared.protection, payload: prepared.ciphertext.toString("base64") }

  const next: StoredFile = { version: 1, entries: { ...file.entries, [key]: entry } }
  try {
    writeFile(store.filePath, next, (written) => verifyReadBack(store, key, value, written))

    // Reading the saved file once more catches a replacement that did not land.
    verifyReadBack(store, key, value, readFile(store.filePath).file)
  } catch (writeError) {
    // Nothing replaced the file that was moved aside, and the recovery name is
    // not read back. Put those bytes where reads look for them again, so a
    // failed write cannot hide every saved entry behind a recovery file.
    if (setAside !== null && !existsSync(store.filePath)) {
      try {
        renameSync(setAside, store.filePath)
      } catch (restoreError) {
        console.warn(
          `[SecretStore] The unreadable ${KEYED_SECRET_FILE} could not be put back at ` +
            `${store.filePath}, so it stays at ${setAside}:`,
          restoreError,
        )
      }
    }
    throw writeError
  }
}

/**
 * Moves an unreadable keyed file aside, keeping every byte for recovery, and
 * names the new path in the log so the user can find it.
 */
function setAsideUnreadableFile(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const target = `${path}.unreadable-${stamp}`
  renameSync(path, target)
  console.warn(
    `[SecretStore] ${KEYED_SECRET_FILE} could not be read, so it was kept at ${target} and a new file was written`,
  )
  return target
}

function verifyReadBack(store: KeyedStore, key: string, value: string, file: StoredFile): void {
  const readBack = readBackValue(store, key, file.entries[key])
  if (readBack !== value) {
    throw new Error(`The saved value for ${key} could not be read back after it was written.`)
  }
}

function readBackValue(
  store: KeyedStore,
  key: string,
  stored: StoredEntry | undefined,
): string | null {
  if (stored === undefined) return null
  if (stored.protection !== "os-encryption") return stored.payload
  return store.store.readStoredBytes(
    Buffer.from(stored.payload, "base64"),
    `The saved value for ${key}`,
  )
}

export function removeKeyedSecret(store: KeyedStore, key: string): void {
  const { file } = readFile(store.filePath)
  if (!(key in file.entries)) return
  const entries = { ...file.entries }
  delete entries[key]
  writeFile(store.filePath, { version: 1, entries })
}
