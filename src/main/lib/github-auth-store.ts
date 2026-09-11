/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { app, safeStorage } from "electron"

const FILE_NAME = "github-auth.dat"
const FALLBACK_FILE_NAME = "github-auth.json"

function getAuthFilePath(): string {
  const userDataPath = app.getPath("userData")
  return join(userDataPath, "data", FILE_NAME)
}

function getFallbackFilePath(): string {
  const userDataPath = app.getPath("userData")
  return join(userDataPath, "data", FALLBACK_FILE_NAME)
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export type GithubAuthStatus =
  | { ok: true; hasToken: true; maskedToken: string }
  | { ok: true; hasToken: false }
  | { ok: false; error: string }

function maskToken(token: string): string {
  if (token.length <= 8) return "****"
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function saveGithubToken(token: string): void {
  const trimmed = token.trim()
  if (!trimmed) {
    throw new Error("GitHub token cannot be empty")
  }

  const filePath = getAuthFilePath()
  ensureDir(filePath)

  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(trimmed)
    writeFileSync(filePath, encrypted)
    const fallbackPath = getFallbackFilePath()
    if (existsSync(fallbackPath)) {
      try {
        unlinkSync(fallbackPath)
      } catch {
        // ignore
      }
    }
    return
  }

  const fallbackPath = getFallbackFilePath()
  ensureDir(fallbackPath)
  writeFileSync(fallbackPath, JSON.stringify({ token: trimmed }), "utf-8")
}

export function loadGithubToken(): string | null {
  const filePath = getAuthFilePath()
  try {
    if (existsSync(filePath) && safeStorage.isEncryptionAvailable()) {
      const encrypted = readFileSync(filePath)
      return safeStorage.decryptString(encrypted)
    }

    const fallbackPath = getFallbackFilePath()
    if (existsSync(fallbackPath)) {
      const raw = readFileSync(fallbackPath, "utf-8")
      const parsed = JSON.parse(raw) as { token?: unknown }
      if (typeof parsed.token === "string") {
        return parsed.token
      }
    }
  } catch {
    return null
  }
  return null
}

export function clearGithubToken(): void {
  const filePath = getAuthFilePath()
  try {
    if (existsSync(filePath)) unlinkSync(filePath)
  } catch {
    // ignore
  }
  const fallbackPath = getFallbackFilePath()
  try {
    if (existsSync(fallbackPath)) unlinkSync(fallbackPath)
  } catch {
    // ignore
  }
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
