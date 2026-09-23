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
  provider: "openrouter",
  field: "apiKey",
  context: "The OpenRouter API key",
  emptyMessage: "OpenRouter API key cannot be empty",
  // The service rejects anything else, so the refusal happens before a write.
  validate: (value) => {
    if (!value.startsWith("sk-or-")) {
      throw new Error("OpenRouter API key must start with 'sk-or-'")
    }
  },
  userDataPath: () => app.getPath("userData"),
  store: getSecretStore,
})

export type OpenRouterAuthStatus =
  | { ok: true; hasKey: true; maskedKey: string }
  | { ok: true; hasKey: false }
  | { ok: false; error: string }

export function saveOpenRouterApiKey(apiKey: string): void {
  store.save(apiKey)
}

export function loadOpenRouterApiKey(): string | null {
  return store.load()
}

export function clearOpenRouterApiKey(): void {
  store.clear()
}

export function getOpenRouterAuthStatus(): OpenRouterAuthStatus {
  return store.status()
}
