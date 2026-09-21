import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

/**
 * A directory listing that fails, which a real disk reports for permissions,
 * descriptor exhaustion or a path that stopped being a directory. The failure
 * is injected so the loop that has to survive it can be exercised.
 */
let failListFor: string | null = null
vi.mock("./lib/secret-storage/owner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/secret-storage/owner")>()
  return {
    ...actual,
    removeStaleTemps: (filePath: string, keepPath?: string) => {
      if (failListFor !== null && filePath === failListFor) {
        throw new Error("EACCES: permission denied, scandir")
      }
      return actual.removeStaleTemps(filePath, keepPath)
    },
  }
})

import { type AuthData, AuthStore } from "./auth-store"
import type { SecretStore } from "./lib/secret-storage/store"
import { makeHome, makeStore } from "./lib/secret-storage/test-support"
import { SecretStorageError } from "./lib/secret-storage/types"

function session(overrides: Partial<AuthData> = {}): AuthData {
  return {
    token: "synthetic-session-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
    user: { id: "u1", email: "user@example.test", name: null, imageUrl: null, username: null },
    ...overrides,
  }
}

function storeFor(
  home: string,
  available = true,
  consent = false,
): { auth: AuthStore; store: SecretStore } {
  const store = makeStore(home, { available, consent })
  return { auth: new AuthStore(home, store), store }
}

describe("auth store", () => {
  it("round trips an encrypted session and writes no plaintext copies", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    const raw = readFileSync(join(home, "auth.dat"))
    expect(raw.subarray(0, 3).toString("latin1")).toBe("v10")
    expect(raw.toString("utf-8")).not.toContain("synthetic-session-token")
    expect(auth.getToken()).toBe("synthetic-session-token")
  })

  it("reports the token expiry while the token is valid", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    expect(auth.getTokenExpiry()).toBe("2030-01-01T00:00:00.000Z")
    expect(auth.getToken()).toBe("synthetic-session-token")
  })

  it("reports no expiry once the saved token has passed", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session({ expiresAt: "2020-01-01T00:00:00.000Z" }))
    expect(auth.getTokenExpiry()).toBeNull()
    expect(auth.getToken()).toBeNull()
  })

  it("keeps every read working after the keyring disappears", () => {
    const home = makeHome()
    storeFor(home).auth.save(session())
    const { auth } = storeFor(home, false)
    expect(auth.getToken()).toBeNull()
    expect(auth.lastError()).toMatch(/keyring|decrypt/i)
  })

  it("refuses a new session without consent and leaves the saved one alone", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    const refused = storeFor(home, false).auth
    expect(() => refused.save(session({ token: "replacement-token" }))).toThrow(SecretStorageError)
    expect(auth.getToken()).toBe("synthetic-session-token")
  })

  it("reads a consented plaintext save instead of the ciphertext it could not decrypt", () => {
    const home = makeHome()
    storeFor(home).auth.save(session())
    const { auth } = storeFor(home, false, true)
    auth.save(session({ token: "consented-plaintext-token" }))
    const aside = readdirSync(home).filter((name) => name.startsWith("auth.dat.unreadable-"))
    expect(aside).toHaveLength(1)
    // The unreadable ciphertext is kept aside, still encrypted, and no longer read.
    expect(
      readFileSync(join(home, aside[0] ?? ""))
        .subarray(0, 3)
        .toString("latin1"),
    ).toBe("v10")
    expect(auth.getToken()).toBe("consented-plaintext-token")
    // The same plaintext copy stays readable once a keyring returns.
    expect(storeFor(home).auth.getToken()).toBe("consented-plaintext-token")
  })

  it("migrates the legacy auth.json file to the encrypted store", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    const { auth } = storeFor(home)
    expect(auth.getToken()).toBe("synthetic-session-token")
    expect(readdirSync(home).includes("auth.json")).toBe(false)
    expect(readFileSync(join(home, "auth.dat")).subarray(0, 3).toString("latin1")).toBe("v10")
  })

  it("keeps a legacy plaintext file when the migration is refused", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.dat.json"), JSON.stringify(session()))
    const { auth } = storeFor(home, false)
    expect(auth.getToken()).toBe("synthetic-session-token")
    expect(readdirSync(home).includes("auth.dat.json")).toBe(true)
    expect(auth.lastError()).not.toBeNull()
  })

  it("keeps the readable session when the plaintext write cannot land", () => {
    const home = makeHome()
    storeFor(home).auth.save(session())
    // A directory where the companion belongs makes the replace fail. The
    // ciphertext is the only readable candidate, so it must stay in place.
    mkdirSync(join(home, "auth.dat.json"))
    const consented = storeFor(home, false, true).auth
    expect(() => consented.save(session({ token: "replacement-token" }))).toThrow()
    expect(storeFor(home).auth.getToken()).toBe("synthetic-session-token")
  })

  it("reports a stash that did not happen instead of clearing the message", () => {
    const home = makeHome()
    // A directory where the ciphertext belongs makes the read that the stash
    // needs fail, so the path it could not move stays on disk.
    mkdirSync(join(home, "auth.dat"))
    const consented = storeFor(home, false, true).auth
    consented.save(session({ token: "consented-plaintext-token" }))
    // The new plaintext is readable and the reason the older file stayed is
    // still reported, instead of the save looking fully clean.
    expect(consented.lastError()).toMatch(/still saved/)
    expect(existsSync(join(home, "auth.dat"))).toBe(true)
  })

  it("removes every file it can and reports the one it could not", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    // A directory cannot be unlinked, so this one stays behind and is named.
    mkdirSync(join(home, "auth.dat.json"))
    expect(() => auth.clear()).toThrow(/could not be removed/)
    expect(readdirSync(home).filter((name) => name === "auth.dat")).toHaveLength(0)
    expect(readdirSync(home).filter((name) => name === "auth.json")).toHaveLength(0)
    expect(auth.lastError()).toMatch(/could not be removed/)
  })

  it("reports a session file it will not replace, and keeps that session readable", () => {
    const home = makeHome()
    // A plaintext `auth.dat` is the only source reads use while it is there, so
    // the write is refused with the file named and the saved session survives.
    writeFileSync(join(home, "auth.dat"), JSON.stringify(session()))
    const { auth } = storeFor(home, false, true)
    auth.save(session({ token: "consented-plaintext-token" }))
    expect(auth.lastError()).toMatch(/auth\.dat/)
    expect(auth.load()?.token).toBe("synthetic-session-token")
  })

  it("removes the temporary file a crashed write left behind", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    // A write that stopped before its rename leaves the session under this name.
    const stale = join(home, "auth.dat.json.tmp-999999")
    writeFileSync(stale, JSON.stringify(session()))
    auth.clear()
    expect(existsSync(stale)).toBe(false)
    expect(readdirSync(home).filter((name) => name.startsWith("auth.dat.json.tmp-"))).toHaveLength(
      0,
    )
  })

  it("reports a plaintext copy it could not remove instead of a clean save", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    // A directory cannot be unlinked, so this copy stays behind. The save must
    // not report success while the plaintext file is still on disk.
    mkdirSync(join(home, "auth.dat.json"))
    auth.save(session())
    expect(existsSync(join(home, "auth.dat.json"))).toBe(true)
    expect(auth.lastError()).toMatch(/auth\.dat\.json could not be removed/)
  })

  it("reports every plaintext copy it could not remove", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    mkdirSync(join(home, "auth.dat.json"))
    mkdirSync(join(home, "auth.json"))
    auth.save(session())
    // One failure is not dropped in favour of the other.
    expect(auth.lastError()).toMatch(/auth\.dat\.json could not be removed/)
    expect(auth.lastError()).toMatch(/auth\.json could not be removed/)
  })

  it("removes the other session files when one cannot be listed", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    failListFor = join(home, "auth.dat")
    // The listing failure is reported, and the paths after it are still tried.
    expect(() => auth.clear()).toThrow(/could not be removed/)
    failListFor = null
    expect(existsSync(join(home, "auth.dat"))).toBe(false)
    expect(existsSync(join(home, "auth.json"))).toBe(false)
    expect(auth.lastError()).toMatch(/auth\.dat/)
  })

  it("removes the copy kept aside when the old bytes could not be read", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    // `stashUnreadableCiphertext` renames the session file to this name when a
    // keyring cannot read it. The session is just as readable there.
    const stashed = join(home, "auth.dat.unreadable-2026-09-21T00-00-00-000Z")
    writeFileSync(stashed, JSON.stringify(session()))
    auth.clear()
    expect(existsSync(stashed)).toBe(false)
  })

  it("clears every file the session could be stored in", () => {
    const home = makeHome()
    const { auth } = storeFor(home)
    auth.save(session())
    writeFileSync(join(home, "auth.json"), JSON.stringify(session()))
    auth.clear()
    expect(readdirSync(home).filter((name) => name.startsWith("auth."))).toHaveLength(0)
  })

  it("treats a user record of the wrong shape as absent", () => {
    const home = makeHome()
    writeFileSync(
      join(home, "auth.dat.json"),
      JSON.stringify({ ...session(), user: { id: 7, email: "user@example.test" } }),
    )
    const { auth } = storeFor(home, false, true)
    // A number where an id belongs would reach the app as a user, so the whole
    // session is treated as unrecognized instead.
    expect(auth.load()).toBeNull()
    expect(auth.lastError()).toMatch(/unrecognized shape/)
  })

  it("reads a session whose user record omits the optional fields", () => {
    const home = makeHome()
    writeFileSync(
      join(home, "auth.dat.json"),
      JSON.stringify({ ...session(), user: { id: "u1", email: "user@example.test" } }),
    )
    const { auth } = storeFor(home, false, true)
    // An earlier version wrote only the two required fields, so that file stays
    // readable and the missing fields read as null.
    expect(auth.load()?.user).toEqual({
      id: "u1",
      email: "user@example.test",
      name: null,
      imageUrl: null,
      username: null,
    })
  })

  it("rejects a user record that is an array", () => {
    const home = makeHome()
    writeFileSync(
      join(home, "auth.dat.json"),
      JSON.stringify({ ...session(), user: ["u1", "user@example.test"] }),
    )
    const { auth } = storeFor(home, false, true)
    expect(auth.load()).toBeNull()
    expect(auth.lastError()).toMatch(/unrecognized shape/)
  })

  it("treats a malformed saved session as absent and reports it", () => {
    const home = makeHome()
    writeFileSync(join(home, "auth.dat"), "not a session")
    const { auth } = storeFor(home)
    expect(auth.load()).toBeNull()
    expect(auth.lastError()).not.toBeNull()
  })
})
