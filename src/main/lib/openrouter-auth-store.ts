/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/ci/research/fork-network-harvest-catalog.md.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { decryptToken, encryptToken } from "../auth-store"

const FILE_NAME = "openrouter-auth.dat"
const FALLBACK_FILE_NAME = "openrouter-auth.json"

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

export type OpenRouterAuthStatus =
  | { ok: true; hasKey: true; maskedKey: string }
  | { ok: true; hasKey: false }
  | { ok: false; error: string }

function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) return "****"
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`
}

export function saveOpenRouterApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error("OpenRouter API key cannot be empty")
  }
  if (!trimmed.startsWith("sk-or-")) {
    throw new Error("OpenRouter API key must start with 'sk-or-'")
  }

  const filePath = getAuthFilePath()
  ensureDir(filePath)

  const encrypted = encryptToken(trimmed)
  writeFileSync(filePath, encrypted, "utf-8")
  const fallbackPath = getFallbackFilePath()
  if (existsSync(fallbackPath)) {
    try {
      unlinkSync(fallbackPath)
    } catch {
      // ignore
    }
  }
}

export function loadOpenRouterApiKey(): string | null {
  const filePath = getAuthFilePath()
  try {
    if (existsSync(filePath)) {
      const encrypted = readFileSync(filePath)
      return decryptToken(encrypted)
    }

    const fallbackPath = getFallbackFilePath()
    if (existsSync(fallbackPath)) {
      const raw = readFileSync(fallbackPath, "utf-8")
      const parsed = JSON.parse(raw) as { apiKey?: unknown }
      if (typeof parsed.apiKey === "string") {
        return parsed.apiKey
      }
    }
  } catch {
    return null
  }
  return null
}

export function clearOpenRouterApiKey(): void {
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

export function getOpenRouterAuthStatus(): OpenRouterAuthStatus {
  try {
    const key = loadOpenRouterApiKey()
    if (!key) return { ok: true, hasKey: false }
    return { ok: true, hasKey: true, maskedKey: maskKey(key) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
