import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
const {
  canPersistRefreshedClaudeCredential,
  credentialSourceForRead,
  externalClaudeStoreKind,
  getValidExistingClaudeToken,
} = await import("./claude-token")

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

describe("claude token single-flight", () => {
  // These cases drive the real refresh path against a stubbed token endpoint,
  // with the Linux file fallback as the store, so the test owns every byte
  // the refresh reads and writes.
  let home = ""
  let savedHome: string | undefined
  const fetchTokens: string[] = []

  const tokenEndpoint = async (_url: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const body = JSON.parse(String(init?.body)) as { refresh_token?: string }
    fetchTokens.push(body.refresh_token ?? "")
    return new Response(
      JSON.stringify({
        access_token: `access-for-${body.refresh_token}`,
        refresh_token: `rotated-${body.refresh_token}`,
        expires_in: 3600,
      }),
      { status: 200 },
    )
  }

  const writeClaudeCredential = (refreshToken: string) => {
    writeFileSync(
      join(home, ".claude", ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: {
          accessToken: `access-${refreshToken}`,
          refreshToken,
          expiresAt: Date.now() - 60_000,
          scopes: [],
        },
      }),
      "utf-8",
    )
  }

  beforeEach(() => {
    home = makeHome("mauscode-claude-home-")
    mkdirSync(join(home, ".claude"), { recursive: true })
    savedHome = process.env.HOME
    process.env.HOME = home
    storeHome = makeHome("mauscode-claude-store-")
    plaintextAllowed = true
    fetchTokens.length = 0
    vi.stubGlobal("fetch", tokenEndpoint)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.HOME = savedHome
  })

  it.runIf(process.platform === "linux")(
    "shares one rotation across concurrent callers holding the same token",
    async () => {
      writeClaudeCredential("refresh-one")
      const first = getValidExistingClaudeToken()
      const second = getValidExistingClaudeToken()
      expect(await Promise.all([first, second])).toEqual([
        "access-for-refresh-one",
        "access-for-refresh-one",
      ])
      // One refresh token rotates once, however many callers awaited it.
      expect(fetchTokens).toEqual(["refresh-one"])
    },
  )

  it.runIf(process.platform === "linux")(
    "never shares a rotation between callers holding different tokens",
    async () => {
      writeClaudeCredential("refresh-one")
      const first = getValidExistingClaudeToken()
      // The stored credential changes while the first rotation is in flight.
      // The second caller must rotate its own token, not join the first one.
      writeClaudeCredential("refresh-two")
      const second = getValidExistingClaudeToken()
      expect(await Promise.all([first, second])).toEqual([
        "access-for-refresh-one",
        "access-for-refresh-two",
      ])
      expect(fetchTokens).toEqual(["refresh-one", "refresh-two"])
    },
  )
})
