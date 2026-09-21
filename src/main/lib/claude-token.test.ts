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

const { canPersistRefreshedClaudeCredential, externalClaudeStoreKind } = await import(
  "./claude-token"
)

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
