/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/ci/research/fork-network-harvest-catalog.md.
 *
 * Storage goes through the app secret store, so the encrypted file is written
 * only when the OS keyring can protect it and the plaintext companion needs
 * the plaintext permission from the Credential storage settings.
 */
import { app } from "electron"
import { getSecretStore } from "./secret-storage"
import {
  clearFileSecret,
  type FileSecret,
  fileSecretPaths,
  loadFileSecret,
  saveFileSecret,
} from "./secret-storage/file-secret"

export type GeminiAuthStatus =
  | { ok: true; hasKey: true; maskedKey: string }
  | { ok: true; hasKey: false }
  | { ok: false; error: string }

function secret(): FileSecret {
  return {
    ...fileSecretPaths(app.getPath("userData"), "gemini"),
    field: "apiKey",
    context: "The Gemini API key",
    store: getSecretStore(),
    keychain: getSecretStore().keychain,
  }
}

function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****"
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
}

export function saveGeminiApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error("Gemini API key cannot be empty")
  }
  saveFileSecret(secret(), trimmed)
}

export function loadGeminiApiKey(): string | null {
  return loadFileSecret(secret())
}

export function clearGeminiApiKey(): void {
  clearFileSecret(secret())
}

export function getGeminiAuthStatus(): GeminiAuthStatus {
  try {
    const key = loadGeminiApiKey()
    if (!key) return { ok: true, hasKey: false }
    return { ok: true, hasKey: true, maskedKey: maskKey(key) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
