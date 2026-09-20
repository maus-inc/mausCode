/**
 * Compatibility import path for credential encoding. The implementation, the
 * storage policy and the only Electron safeStorage call live in
 * `src/main/lib/secret-storage`. New code imports that module directly.
 *
 * Both functions keep their historical signatures. A write that cannot be
 * encrypted and is not permitted to fall back to plaintext now throws a
 * `SecretStorageError` instead of quietly storing base64.
 */
import { getSecretStore } from "./secret-storage"

export function encryptToken(token: string): string {
  return getSecretStore().encodeForDatabase("This credential", token)
}

export function decryptToken(encrypted: string): string {
  return getSecretStore().decodeFromDatabase("This credential", encrypted)
}

export { SecretStorageError, type SecretStorageStatus } from "./secret-storage"
