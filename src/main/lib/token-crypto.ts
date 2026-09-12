/**
 * OS-keychain token crypto (single home for the encrypt/decrypt pair that was
 * duplicated across routers). Tokens are encrypted with Electron safeStorage;
 * when unavailable (some Linux setups), base64 is used as a documented,
 * obfuscation-only fallback.
 */
import { safeStorage } from "electron"

export function encryptToken(token: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[TokenCrypto] Encryption not available, storing as base64")
    return Buffer.from(token).toString("base64")
  }
  return safeStorage.encryptString(token).toString("base64")
}

export function decryptToken(encrypted: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(encrypted, "base64").toString("utf-8")
  }
  const buffer = Buffer.from(encrypted, "base64")
  return safeStorage.decryptString(buffer)
}
