import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { SecretWriter } from "./lib/secret-storage"
import {
  removeStaleTemps,
  stashedCiphertextPaths,
  stashUnreadableCiphertext,
  writeCredentialTempFile,
} from "./lib/secret-storage/owner"

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

/**
 * Reads the saved user record. The fields this app writes are checked by type,
 * because a file with the wrong shape would otherwise reach callers as if it
 * were a session. An absent optional field counts as null, so a file an earlier
 * version wrote stays readable.
 */
function parseAuthUser(value: unknown): AuthUser | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const { id, email, name, imageUrl, username } = value as Record<string, unknown>
  if (typeof id !== "string" || typeof email !== "string") return null
  const optional = [name, imageUrl, username].map((field) => field ?? null)
  if (!optional.every((field) => typeof field === "string" || field === null)) return null
  return {
    id,
    email,
    name: optional[0] as string | null,
    imageUrl: optional[1] as string | null,
    username: optional[2] as string | null,
  }
}

function parseAuthData(content: string): AuthData | null {
  const parsed: unknown = JSON.parse(content)
  if (typeof parsed !== "object" || parsed === null) return null
  const candidate = parsed as Partial<AuthData>
  if (
    typeof candidate.token !== "string" ||
    typeof candidate.refreshToken !== "string" ||
    typeof candidate.expiresAt !== "string"
  ) {
    return null
  }
  const user = parseAuthUser(candidate.user)
  if (!user) return null
  return {
    token: candidate.token,
    refreshToken: candidate.refreshToken,
    expiresAt: candidate.expiresAt,
    user,
  }
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
    // Every warning this save produces is reported, so a plaintext copy that
    // could not be removed is never replaced by a later, milder notice.
    const warnings: string[] = []
    try {
      const dir = dirname(this.filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true, mode: 0o700 })
      }
      // Throws when the value may not be stored, so nothing is written.
      const prepared = this.store.prepare("The sign-in token", value)
      if (prepared.ciphertext) {
        const temp = `${this.filePath}.tmp-${process.pid}`
        writeCredentialTempFile(temp, prepared.ciphertext)
        const verified = this.store.read(readFileSync(temp), "The sign-in token") === value
        if (!verified) {
          unlinkSync(temp)
          throw new Error("The saved sign-in token could not be read back after encryption.")
        }
        renameSync(temp, this.filePath)
        warnings.push(...this.removePlaintextCopies())
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
        // The same rule as the file secret store: while a file sits at this
        // path it is the only source reads use, so the new session does not load
        // until it moves aside, and that has to be reported rather than cleared.
        if (!stashed.stashed && existsSync(this.filePath)) {
          const reason = stashed.reason ? ` (${stashed.reason}).` : "."
          warnings.push(
            `The older sign-in session is still saved at ${basename(this.filePath)} and was ` +
              `not moved aside, so the new session will not load while that file is there${reason}`,
          )
        }
      }
      this.lastFailure = warnings.length > 0 ? warnings.join(" ") : null
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
      writeCredentialTempFile(temp, `${value}\n`)
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
  private removePlaintextCopies(): string[] {
    const failures: string[] = []
    for (const path of [this.plaintextPath, this.legacyPath]) {
      if (!existsSync(path)) continue
      try {
        unlinkSync(path)
      } catch (error) {
        failures.push(`The session moved to the encrypted store, but ${path} could not be removed.`)
        console.error(`[AuthStore] Could not remove ${path}:`, error)
      }
    }
    return failures
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
      // A write that stopped before its rename leaves the session under a
      // temporary name, and a ciphertext this keyring could not read was kept
      // aside under another. Both hold the same session, so both go.
      try {
        for (const stale of removeStaleTemps(path)) {
          failed.push(stale)
          console.error(`[AuthStore] Could not remove the unfinished write at ${stale}`)
        }
        for (const stashed of stashedCiphertextPaths(path)) {
          try {
            unlinkSync(stashed)
          } catch (error) {
            failed.push(stashed)
            console.error(`[AuthStore] Could not remove ${stashed}:`, error)
          }
        }
      } catch (error) {
        // Listing the directory failed, so a file next to this path could not
        // be checked. The remaining paths are still attempted, and this one is
        // reported, because a session file could still be stored there.
        failed.push(path)
        console.error(`[AuthStore] Could not list the files next to ${path}:`, error)
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
