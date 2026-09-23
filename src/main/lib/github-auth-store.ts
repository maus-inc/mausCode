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
  provider: "github",
  field: "token",
  context: "The GitHub token",
  emptyMessage: "GitHub token cannot be empty",
  userDataPath: () => app.getPath("userData"),
  store: getSecretStore,
})

export type GithubAuthStatus =
  | { ok: true; hasToken: true; maskedToken: string }
  | { ok: true; hasToken: false }
  | { ok: false; error: string }

export function saveGithubToken(token: string): void {
  store.save(token)
}

export function loadGithubToken(): string | null {
  return store.load()
}

export function clearGithubToken(): void {
  store.clear()
}

export function getGithubAuthStatus(): GithubAuthStatus {
  const status = store.status()
  if (!status.ok) return status
  if (!status.hasKey) return { ok: true, hasToken: false }
  return { ok: true, hasToken: true, maskedToken: status.maskedKey }
}
