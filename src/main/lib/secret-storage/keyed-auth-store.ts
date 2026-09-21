/**
 * A provider credential held as one key in the owner's file pair.
 *
 * The GitHub token, the Gemini API key and the OpenRouter API key all have the
 * same shape: one secret, one file pair, one masked status shown in settings.
 * The behavior lives here so the three call sites cannot drift, and so the
 * tests exercise the shared path rather than three copies of it.
 *
 * Nothing is written here beyond what `file-secret` does: the encrypted `.dat`
 * file while the OS keyring can protect it, and a plaintext JSON companion
 * only when the user granted plaintext permission.
 */
import {
  clearFileSecret,
  type FileSecret,
  fileSecretPaths,
  loadFileSecret,
  readFileSecret,
  saveFileSecret,
} from "./file-secret"
import type { SecretWriter } from "./types"

export type KeyedAuthStatus =
  | { ok: true; hasKey: false }
  | { ok: true; hasKey: true; maskedKey: string }
  | { ok: false; error: string }

export type KeyedAuthStore = {
  /** Trims and validates, then writes through the owner. Throws on refusal. */
  save(value: string): void
  /**
   * The stored value, or null when nothing is stored. An unreadable file also
   * yields null here; `status()` is the call that tells the two apart.
   */
  load(): string | null
  clear(): void
  status(): KeyedAuthStatus
}

export type KeyedAuthStoreOptions = {
  /** File stem in `userData/data`, for example `github`. */
  provider: string
  /** Field name inside the JSON companion. */
  field: string
  /** Named in every refusal message, for example "The GitHub token". */
  context: string
  emptyMessage: string
  /** Rejects a value the provider itself would reject, before any write. */
  validate?: (value: string) => void
  /** Read per call, so the path follows the app and tests can point it at a temp home. */
  userDataPath: () => string
  store: () => SecretWriter
}

/** Enough of a credential to recognize it, never enough to use it. */
export function maskCredential(value: string): string {
  if (value.length <= 8) return "****"
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

export function createKeyedAuthStore(options: KeyedAuthStoreOptions): KeyedAuthStore {
  function secret(): FileSecret {
    const store = options.store()
    return {
      ...fileSecretPaths(options.userDataPath(), options.provider),
      field: options.field,
      context: options.context,
      store,
      keychain: store.keychain,
    }
  }

  const load = (): string | null => loadFileSecret(secret())

  return {
    save(value) {
      const trimmed = value.trim()
      if (!trimmed) throw new Error(options.emptyMessage)
      options.validate?.(trimmed)
      saveFileSecret(secret(), trimmed)
    },
    load,
    clear() {
      clearFileSecret(secret())
    },
    status() {
      const { value, error } = readFileSecret(secret())
      if (error) return { ok: false, error }
      if (!value) return { ok: true, hasKey: false }
      return { ok: true, hasKey: true, maskedKey: maskCredential(value) }
    },
  }
}
