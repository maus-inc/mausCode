import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { app, safeStorage } from "electron"

export interface AuthUser {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
}

export interface AuthData {
  token: string
  refreshToken: string
  expiresAt: string
  user: AuthUser
}

export interface SecretStorageStatus {
  encryptionAvailable: boolean
  plaintextConsent: boolean
  lastWriteUsedPlaintext: boolean
}

interface SecretStorageSettings {
  consentedToPlaintextSecrets: boolean
  lastWriteUsedPlaintext: boolean
}

const DEFAULT_SECRET_STORAGE_SETTINGS: SecretStorageSettings = {
  consentedToPlaintextSecrets: false,
  lastWriteUsedPlaintext: false,
}

export class PlaintextSecretConsentRequiredError extends Error {
  readonly code = "PLAINTEXT_SECRET_CONSENT_REQUIRED"

  constructor() {
    super(
      "Secure storage is unavailable. Allow plaintext secret storage in Settings before saving.",
    )
    this.name = "PlaintextSecretConsentRequiredError"
  }
}

function settingsPath(): string {
  return join(app.getPath("userData"), "secret-storage-settings.json")
}

function readSettings(): SecretStorageSettings {
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as Partial<SecretStorageSettings>
    return {
      consentedToPlaintextSecrets: raw.consentedToPlaintextSecrets === true,
      lastWriteUsedPlaintext: raw.lastWriteUsedPlaintext === true,
    }
  } catch {
    return DEFAULT_SECRET_STORAGE_SETTINGS
  }
}

function writeSettings(settings: SecretStorageSettings): void {
  const filePath = settingsPath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(settings, null, 2), { encoding: "utf-8", mode: 0o600 })
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function getSecretStorageStatus(): SecretStorageStatus {
  const settings = readSettings()
  return {
    encryptionAvailable: isEncryptionAvailable(),
    plaintextConsent: settings.consentedToPlaintextSecrets,
    lastWriteUsedPlaintext: settings.lastWriteUsedPlaintext,
  }
}

export function setPlaintextSecretConsent(consent: boolean): SecretStorageStatus {
  const current = readSettings()
  writeSettings({ ...current, consentedToPlaintextSecrets: consent })
  return getSecretStorageStatus()
}

function markWriteUsedPlaintext(): void {
  const current = readSettings()
  writeSettings({ ...current, lastWriteUsedPlaintext: true })
}

function markWriteUsedEncryption(): void {
  const current = readSettings()
  if (current.lastWriteUsedPlaintext) {
    writeSettings({ ...current, lastWriteUsedPlaintext: false })
  }
}

export function encryptToken(token: string, options: { secret?: boolean } = {}): string {
  const secret = options.secret !== false
  if (isEncryptionAvailable()) {
    markWriteUsedEncryption()
    return safeStorage.encryptString(token).toString("base64")
  }
  if (secret && !readSettings().consentedToPlaintextSecrets) {
    throw new PlaintextSecretConsentRequiredError()
  }
  markWriteUsedPlaintext()
  console.warn(JSON.stringify({ event: "secret_storage_write", storage: "plaintext" }))
  return Buffer.from(token, "utf-8").toString("base64")
}

export function decryptToken(encoded: string | Buffer): string {
  const base64 = Buffer.isBuffer(encoded) ? encoded.toString("base64") : encoded
  if (isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(base64, "base64"))
    } catch {
      return Buffer.from(base64, "base64").toString("utf-8")
    }
  }
  return Buffer.from(base64, "base64").toString("utf-8")
}

export class AuthStore {
  private filePath: string

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, "auth.dat")
  }

  save(data: AuthData): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const jsonData = JSON.stringify(data)

    if (isEncryptionAvailable()) {
      writeFileSync(this.filePath, safeStorage.encryptString(jsonData))
      markWriteUsedEncryption()
      return
    }

    if (!readSettings().consentedToPlaintextSecrets) {
      throw new PlaintextSecretConsentRequiredError()
    }
    writeFileSync(`${this.filePath}.json`, jsonData, "utf-8")
    markWriteUsedPlaintext()
    console.warn(JSON.stringify({ event: "secret_storage_write", storage: "plaintext" }))
  }

  load(): AuthData | null {
    try {
      if (existsSync(this.filePath) && isEncryptionAvailable()) {
        return JSON.parse(safeStorage.decryptString(readFileSync(this.filePath))) as AuthData
      }

      const fallbackPath = `${this.filePath}.json`
      if (existsSync(fallbackPath)) {
        const data = JSON.parse(readFileSync(fallbackPath, "utf-8")) as AuthData
        if (isEncryptionAvailable()) {
          this.save(data)
          unlinkSync(fallbackPath)
        }
        return data
      }

      const legacyPath = join(dirname(this.filePath), "auth.json")
      if (existsSync(legacyPath)) {
        const data = JSON.parse(readFileSync(legacyPath, "utf-8")) as AuthData
        if (isEncryptionAvailable()) {
          this.save(data)
          unlinkSync(legacyPath)
        }
        return data
      }
      return null
    } catch {
      console.error("Failed to load auth data")
      return null
    }
  }

  clear(): void {
    try {
      for (const filePath of [
        this.filePath,
        `${this.filePath}.json`,
        join(dirname(this.filePath), "auth.json"),
      ]) {
        if (existsSync(filePath)) unlinkSync(filePath)
      }
    } catch (error) {
      console.error("Failed to clear auth data:", error)
    }
  }

  isAuthenticated(): boolean {
    const data = this.load()
    return data ? new Date(data.expiresAt).getTime() > Date.now() : false
  }

  getUser(): AuthUser | null {
    return this.load()?.user ?? null
  }

  getToken(): string | null {
    const data = this.load()
    return data && new Date(data.expiresAt).getTime() > Date.now() ? data.token : null
  }

  getRefreshToken(): string | null {
    return this.load()?.refreshToken ?? null
  }

  needsRefresh(): boolean {
    const data = this.load()
    return data ? new Date(data.expiresAt).getTime() - Date.now() < 5 * 60 * 1000 : false
  }

  updateUser(updates: Partial<AuthUser>): AuthUser | null {
    const data = this.load()
    if (!data) return null
    data.user = { ...data.user, ...updates }
    this.save(data)
    return data.user
  }
}
