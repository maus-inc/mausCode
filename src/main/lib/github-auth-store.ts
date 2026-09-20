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

export type GithubAuthStatus =
  | { ok: true; hasToken: true; maskedToken: string }
  | { ok: true; hasToken: false }
  | { ok: false; error: string }

function secret(): FileSecret {
  return {
    ...fileSecretPaths(app.getPath("userData"), "github"),
    field: "token",
    context: "The GitHub token",
    store: getSecretStore(),
    keychain: getSecretStore().keychain,
  }
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****"
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function saveGithubToken(token: string): void {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error("GitHub token cannot be empty")
  }
  saveFileSecret(secret(), trimmed)
}

export function loadGithubToken(): string | null {
  return loadFileSecret(secret())
}

export function clearGithubToken(): void {
  clearFileSecret(secret())
}

export function getGithubAuthStatus(): GithubAuthStatus {
  try {
    const token = loadGithubToken()
    if (!token) return { ok: true, hasToken: false }
    return { ok: true, hasToken: true, maskedToken: maskToken(token) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
