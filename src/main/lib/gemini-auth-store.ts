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
import { createKeyedAuthStore } from "./secret-storage/keyed-auth-store"

const store = createKeyedAuthStore({
  provider: "gemini",
  field: "apiKey",
  context: "The Gemini API key",
  emptyMessage: "Gemini API key cannot be empty",
  userDataPath: () => app.getPath("userData"),
  store: getSecretStore,
})

export type GeminiAuthStatus =
  | { ok: true; hasKey: true; maskedKey: string }
  | { ok: true; hasKey: false }
  | { ok: false; error: string }

export function saveGeminiApiKey(apiKey: string): void {
  store.save(apiKey)
}

export function loadGeminiApiKey(): string | null {
  return store.load()
}

export function clearGeminiApiKey(): void {
  store.clear()
}

export function getGeminiAuthStatus(): GeminiAuthStatus {
  return store.status()
}
