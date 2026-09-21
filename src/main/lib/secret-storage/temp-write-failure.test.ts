/**
 * A write that fails partway is the case a full disk produces: the file exists
 * with some of its bytes on it, and the write throws. The bytes are the value
 * the app was asked to save, so the file has to go. These tests interrupt the
 * write at that point, because a real full disk cannot be arranged from a test.
 */
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { fileSecretPaths, saveFileSecret } from "./file-secret"
import { keyedStorePath, writeKeyedSecret } from "./keyed-store"
import { makeHome, makeStore } from "./test-support"

let failNextWriteWhen: ((file: string) => boolean) | null = null

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return {
    ...actual,
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
