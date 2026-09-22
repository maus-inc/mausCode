/**
 * A write that fails partway is the case a full disk produces: the file exists
 * with some of its bytes on it, and the write throws. The bytes are the value
 * the app was asked to save, so the file has to go. These tests interrupt the
 * write at that point, because a real full disk cannot be arranged from a test.
 */
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { AuthStore } from "../../auth-store"
import { fileSecretPaths, loadFileSecret, saveFileSecret } from "./file-secret"
import { keyedStorePath, writeKeyedSecret } from "./keyed-store"
import { makeHome, makeStore } from "./test-support"

let failNextWriteWhen: ((file: string) => boolean) | null = null
/** Set to make the next rename from a temporary file fail, the way an OS error does. */
let failNextRenameWhen: ((from: string, to: string) => boolean) | null = null

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
    renameSync(from: string | Buffer | URL, to: string | Buffer | URL) {
      if (failNextRenameWhen?.(String(from), String(to))) {
        failNextRenameWhen = null
        throw new Error("rename failed")
      }
      return actual.renameSync(from, to)
    },
    writeFileSync(
      file: string | Buffer | URL,
      data: string | Uint8Array,
      options?: Parameters<typeof actual.writeFileSync>[2],
    ) {
      if (failNextWriteWhen?.(String(file))) {
        failNextWriteWhen = null
        // Some of the value reaches the disk, then the write stops.
        actual.writeFileSync(file, data, options)
        throw new Error("no space left on device")
      }
      return actual.writeFileSync(file, data, options)
    },
  }
})

function session() {
  return {
    token: "synthetic-session-token",
    refreshToken: "synthetic-refresh-token",
    expiresAt: "2030-01-01T00:00:00.000Z",
    user: { id: "u1", email: "user@example.test", name: null, imageUrl: null, username: null },
  }
}

function filesStartingWith(dir: string, prefix: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith(prefix))
}

describe("a credential write that fails partway", () => {
  it("leaves no temporary file behind when the ciphertext write stops", () => {
    const store = makeStore(makeHome("mauscode-temp-write-"), { available: true })
    const paths = fileSecretPaths(store.userDataPath, "github")
    const secret = {
      ...paths,
      field: "token",
      context: "The GitHub token",
      store,
      keychain: store.keychain,
    }
    failNextWriteWhen = (file) => file.includes(`${paths.filePath}.tmp-`)

    expect(() => saveFileSecret(secret, "sk-synthetic-value-that-reached-the-disk")).toThrow(
      /no space left/,
    )

    expect(existsSync(paths.filePath)).toBe(false)
    expect(filesStartingWith(join(store.userDataPath, "data"), "github-auth.dat.tmp-")).toEqual([])
  })

  it("leaves no temporary file behind when the plaintext write stops", () => {
    const store = makeStore(makeHome("mauscode-temp-write-"), { available: false, consent: true })
    const paths = fileSecretPaths(store.userDataPath, "github")
    const secret = {
      ...paths,
      field: "token",
      context: "The GitHub token",
      store,
      keychain: store.keychain,
    }
    failNextWriteWhen = (file) => file.includes(`${paths.plaintextPath}.tmp-`)

    expect(() => saveFileSecret(secret, "synthetic-plaintext-value")).toThrow(/no space left/)

    expect(existsSync(paths.plaintextPath)).toBe(false)
    expect(filesStartingWith(join(store.userDataPath, "data"), "github-auth.json.tmp-")).toEqual([])
  })

  it("leaves no temporary file behind when the session write stops", () => {
    const home = makeHome("mauscode-temp-write-")
    const store = makeStore(home, { available: true })
    const auth = new AuthStore(home, store)
    failNextWriteWhen = (file) => file.includes(`${join(home, "auth.dat")}.tmp-`)

    expect(() => auth.save(session())).toThrow(/no space left/)

    expect(existsSync(join(home, "auth.dat"))).toBe(false)
    expect(filesStartingWith(home, "auth.dat.tmp-")).toEqual([])
  })

  it("removes the temporary ciphertext when the rename onto the stored file fails", () => {
    const store = makeStore(makeHome("mauscode-temp-write-"), { available: true })
    const paths = fileSecretPaths(store.userDataPath, "github")
    const secret = {
      ...paths,
      field: "token",
      context: "The GitHub token",
      store,
      keychain: store.keychain,
    }
    saveFileSecret(secret, "sk-first-value")
    // The bytes are written and read back, then the rename that would put them
    // in place fails. The temporary file holds the credential, so it goes.
    failNextRenameWhen = (from, to) => from.includes(".tmp-") && to === paths.filePath

    expect(() => saveFileSecret(secret, "sk-second-value")).toThrow(/rename failed/)

    expect(filesStartingWith(join(store.userDataPath, "data"), "github-auth.dat.tmp-")).toEqual([])
    // The value from before the failed write is the one that still loads.
    expect(loadFileSecret(secret)).toBe("sk-first-value")
  })

  it("puts the stashed ciphertext back when the plaintext replacement fails", () => {
    const home = makeHome("mauscode-temp-write-")
    const secret = {
      ...fileSecretPaths(home, "github"),
      field: "token",
      context: "The GitHub token",
      store: makeStore(home, { available: true }),
      keychain: makeStore(home, { available: true }).keychain,
    }
    saveFileSecret(secret, "sk-first-value")
    // A keyring that cannot read the stored bytes moves the file aside to let a
    // consented plaintext value load. That write then fails, and without the
    // restore the credential would sit under a recovery name no read uses.
    const consented = {
      ...fileSecretPaths(home, "github"),
      field: "token",
      context: "The GitHub token",
      store: makeStore(home, { available: false, consent: true }),
      keychain: makeStore(home, { available: false, consent: true }).keychain,
    }
    failNextWriteWhen = (file) => file.includes(`${consented.plaintextPath}.tmp-`)

    expect(() => saveFileSecret(consented, "sk-second-value")).toThrow(/no space left/)

    // The old file is back at the path reads use, so the credential still loads.
    expect(existsSync(secret.filePath)).toBe(true)
    expect(loadFileSecret(secret)).toBe("sk-first-value")
    expect(filesStartingWith(join(home, "data"), "github-auth.dat.unreadable-")).toEqual([])
  })

  it("leaves no temporary file behind when the keyed store write stops", () => {
    const store = makeStore(makeHome("mauscode-temp-write-"), { available: true })
    const filePath = keyedStorePath(store.userDataPath)
    failNextWriteWhen = (file) => file.includes(`${filePath}.tmp-`)

    expect(() =>
      writeKeyedSecret({ filePath, store }, "agents:openai-api-key", "sk-value"),
    ).toThrow(/no space left/)

    expect(existsSync(filePath)).toBe(false)
    expect(filesStartingWith(dirname(filePath), "renderer-secrets.json.tmp-")).toEqual([])
  })
})
