import { tmpdir } from "node:os"
import { describe, expect, it, vi } from "vitest"

// claude-token pulls in the secret store, which binds to the running Electron
// app. The paths that store builds are never touched by these assertions.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    getSelectedStorageBackend: () => "unknown",
  },
}))

/** The permission the app has for a plaintext write, toggled per test. */
let plaintextAllowed = false
/** A home of this file's own, because the permission is stored in it. */
let storeHome = ""

vi.mock("./secret-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./secret-storage")>()
  return {
    ...actual,
    getSecretStore: () => makeStore(storeHome, { available: false, consent: plaintextAllowed }),
  }
})

const { makeHome, makeStore } = await import("./secret-storage/test-support")
const { canPersistRefreshedClaudeCredential, credentialSourceForRead, externalClaudeStoreKind } =
  await import("./claude-token")

describe("claude token refresh store", () => {
  // A rotated token written into a different store than the one that answers
  // reads leaves that store holding a token the server already replaced, so the
  // refresh is refused instead of half-applied.
  it.runIf(process.platform === "linux" || process.platform === "win32")(
    "refuses a refresh the platform's file write cannot put back",
    () => {
      expect(externalClaudeStoreKind()).toBe("plaintext-file")
      expect(canPersistRefreshedClaudeCredential("keychain")).toBe(false)
    },
  )

  it.runIf(process.platform === "darwin")("writes a keychain refresh back to the keychain", () => {
    expect(externalClaudeStoreKind()).toBe("keychain")
    expect(canPersistRefreshedClaudeCredential("keychain")).toBe(true)
  })
})

describe("claude token store choice", () => {
  it.beforeEach(() => {
    storeHome = makeHome("mauscode-claude-token-")
    plaintextAllowed = false
  })

  it("treats the Windows credential read as the file it reads", () => {
    // The Windows reader reads the CLI's credentials file, so a refresh of a
    // credential it returned may write that file.
    expect(credentialSourceForRead("win32")).toBe("file")
    expect(credentialSourceForRead("darwin")).toBe("keychain")
    expect(credentialSourceForRead("linux")).toBe("keychain")
  })

  it("checks plaintext permission before a file-backed refresh on any platform", () => {
    expect(canPersistRefreshedClaudeCredential("file", "darwin")).toBe(false)
    expect(canPersistRefreshedClaudeCredential("file", "win32")).toBe(false)
    plaintextAllowed = true
    // A platform with a credential store no longer skips the check for a
    // credential that came from the file, because the write goes to the file.
    expect(canPersistRefreshedClaudeCredential("file", "darwin")).toBe(true)
    expect(canPersistRefreshedClaudeCredential("file", "win32")).toBe(true)
  })

  it("refuses a credential store the platform cannot write", () => {
    plaintextAllowed = true
    expect(canPersistRefreshedClaudeCredential("keychain", "win32")).toBe(false)
    expect(canPersistRefreshedClaudeCredential("keychain", "linux")).toBe(false)
    expect(canPersistRefreshedClaudeCredential("keychain", "darwin")).toBe(true)
  })
})
