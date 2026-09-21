import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { SecretWriter } from "./lib/secret-storage"
import { stashUnreadableCiphertext } from "./lib/secret-storage/owner"

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

function parseAuthData(content: string): AuthData | null {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return null
  const candidate = parsed as Partial<AuthData>
  if (
    typeof candidate.token !== "string" ||
    typeof candidate.refreshToken !== "string" ||
    typeof candidate.expiresAt !== "string" ||
    typeof candidate.user !== "object" ||
    candidate.user === null
  ) {
    return null
  }
  return candidate as AuthData
}

/**
 * The desktop session, kept in `auth.dat` as OS-encrypted bytes.
 *
 * Reading is unchanged from earlier versions. Writing goes through the app
 * secret store, so a new or refreshed session is encrypted, or stored as
 * plaintext in `auth.dat.json` only when the user has allowed plaintext. A
 * write that is not permitted throws and leaves the saved session alone.
 */
export class AuthStore {
  private readonly filePath: string
  private readonly plaintextPath: string
  private readonly legacyPath: string
  private lastFailure: string | null = null

  constructor(
    userDataPath: string,
    private readonly store: SecretWriter,
  ) {
    this.filePath = join(userDataPath, "auth.dat")
    this.plaintextPath = `${this.filePath}.json`
    this.legacyPath = join(userDataPath, "auth.json")
  }

  /** Concrete reason the last read or write failed. Never contains a secret. */
  lastError(): string | null {
    return this.lastFailure
  }

  /**
   * Saves the session. The ciphertext is verified by reading it back through
   * the secret store before it replaces the saved file, so a failed encryption
   * can never destroy a working session or leave an unreadable file behind.
   */
  save(data: AuthData): void {
    const value = JSON.stringify(data)
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
      }
      // Throws when the value may not be stored, so nothing is written.
      const prepared = this.store.prepare("The sign-in token", value)
      if (prepared.ciphertext) {
        const temp = `${this.filePath}.tmp-${process.pid}`
        writeFileSync(temp, prepared.ciphertext, { mode: 0o600 })
        const verified = this.store.read(readFileSync(temp), "The sign-in token") === value
        if (!verified) {
          unlinkSync(temp)
          throw new Error("The saved sign-in token could not be read back after encryption.")
        }
        renameSync(temp, this.filePath)
        this.removePlaintextCopies()
      } else {
        // The new value lands before the ciphertext moves: the ciphertext is the
        // only readable candidate until then, so a failed write must leave it in
        // place rather than sign the user out.
        this.writePlaintext(value)
        // The saved ciphertext cannot be read without a keyring, and leaving it
        // in place would keep this new value from ever being loaded. Keep it
        // aside instead of deleting it.
        const stashed = stashUnreadableCiphertext(
          this.filePath,
          this.store.keychain,
          "The saved sign-in session",
        )
        if (!stashed.stashed && existsSync(this.filePath)) {
          this.lastFailure =
            "The older sign-in session is still saved and cannot be read without a " +
            "keyring, so the new session will not load until it moves aside."
        }
      }
      this.lastFailure = null
    } catch (error) {
      this.lastFailure = error instanceof Error ? error.message : String(error)
      console.error("[AuthStore] Failed to save the sign-in session:", this.lastFailure)
      throw error
    }
  }

  /** Writes the session to the plaintext companion through a temporary file. */
  private writePlaintext(value: string): void {
    const temp = `${this.plaintextPath}.tmp-${process.pid}`
    try {
      writeFileSync(temp, `${value}\n`, { mode: 0o600 })
      renameSync(temp, this.plaintextPath)
    } catch (error) {
      try {
        if (existsSync(temp)) unlinkSync(temp)
      } catch {
        // The failure worth reporting is the one that stopped the write.
      }
      throw error
    }
  }

  /**
   * Loads the session. An existing encrypted file is the only source once it
   * is present, so a payload that cannot be decrypted reports the reason and
   * never falls back to an older plaintext copy.
   */
  load(): AuthData | null {
    this.lastFailure = null
    if (existsSync(this.filePath)) {
      try {
        const data = parseAuthData(
          this.store.read(readFileSync(this.filePath), "The sign-in token"),
        )
        if (!data) {
          this.lastFailure = "The saved sign-in session has an unrecognized shape."
        }
        return data
      } catch (error) {
        this.lastFailure = error instanceof Error ? error.message : String(error)
        console.error("[AuthStore] Could not read the saved sign-in session:", this.lastFailure)
        return null
      }
    }

    const plaintext = this.loadFrom(this.plaintextPath)
    if (plaintext) return plaintext

    const legacy = this.loadFrom(this.legacyPath)
    if (!legacy) return null
    console.log(
      "[AuthStore] Found the legacy auth.json session and moving it to the encrypted store",
    )
    return legacy
  }

  /**
   * Reads a plaintext file and, when the store can encrypt, replaces it with a
   * verified encrypted write. A refused or failed migration keeps the file and
   * still returns the session, so the user stays signed in.
   */
  private loadFrom(path: string): AuthData | null {
    if (!existsSync(path)) return null
    try {
      const data = parseAuthData(readFileSync(path, "utf-8"))
      if (!data) {
        this.lastFailure = `${path} has an unrecognized shape. The file was left unchanged.`
        return null
      }
      try {
        this.save(data)
      } catch (error) {
        this.lastFailure = error instanceof Error ? error.message : String(error)
      }
      return data
    } catch {
      this.lastFailure = `${path} could not be read or parsed. The file was left unchanged.`
      return null
    }
  }

  /** Only called after the encrypted file was written and read back. */
  private removePlaintextCopies(): void {
    for (const path of [this.plaintextPath, this.legacyPath]) {
      if (!existsSync(path)) continue
      try {
        unlinkSync(path)
      } catch (error) {
        this.lastFailure = `The session moved to the encrypted store, but ${path} could not be removed.`
        console.error(`[AuthStore] Could not remove ${path}:`, error)
      }
    }
  }

  /**
   * Sign-out removes every file the session could be stored in. One protected
   * file does not stop the others from going, and what could not be removed is
   * reported rather than passed off as a completed sign-out.
   */
  clear(): void {
    const failed: string[] = []
    for (const path of [this.filePath, this.plaintextPath, this.legacyPath]) {
      try {
        if (existsSync(path)) unlinkSync(path)
      } catch (error) {
        failed.push(path)
        console.error(`[AuthStore] Could not remove ${path}:`, error)
      }
    }
    if (failed.length > 0) {
      this.lastFailure = `The sign-in session could not be removed from ${failed.join(", ")} and may still be stored.`
      throw new Error(this.lastFailure)
    }
    this.lastFailure = null
  }

  isAuthenticated(): boolean {
    const data = this.load()
    if (!data) return false
    return new Date(data.expiresAt).getTime() > Date.now()
  }

  getUser(): AuthUser | null {
    return this.load()?.user ?? null
  }

  getToken(): string | null {
    const data = this.load()
    if (!data) return null
    if (new Date(data.expiresAt).getTime() <= Date.now()) return null
    return data.token
  }

  /** When the saved token stops being valid, for callers that must know. */
  getTokenExpiry(): string | null {
    const data = this.load()
    if (!data) return null
    if (new Date(data.expiresAt).getTime() <= Date.now()) return null
    return data.expiresAt
  }

  getRefreshToken(): string | null {
    return this.load()?.refreshToken ?? null
  }

  needsRefresh(): boolean {
    const data = this.load()
    if (!data) return false
    return new Date(data.expiresAt).getTime() - Date.now() < 5 * 60 * 1000
  }

  updateUser(updates: Partial<AuthUser>): AuthUser | null {
    const data = this.load()
    if (!data) return null
    data.user = { ...data.user, ...updates }
    this.save(data)
    return data.user
  }
}
