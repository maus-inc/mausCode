import { describe, expect, it, vi } from "vitest"
import { AuthStore } from "./auth-store"

/**
 * The auth manager binds to the running Electron app and to the keyring, so
 * both are replaced here. The store is built over a temporary app home, which
 * is what makes the saved session readable to the assertions.
 */
let userData = ""
let sharedStore: ReturnType<typeof makeStore> | null = null

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => userData,
    getVersion: () => "0.0.0-test",
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => null,
    encryptString: (value: string) => Buffer.from(value, "utf-8"),
    decryptString: (value: Buffer) => value.toString("utf-8"),
  },
}))

vi.mock("./lib/secret-storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/secret-storage")>()
  return {
    ...actual,
    getSecretStore: () => {
      sharedStore ??= makeStore(userData, { available: true })
      return sharedStore
    },
  }
})

const { makeHome, makeStore } = await import("./lib/secret-storage/test-support")
const { AuthManager } = await import("./auth-manager")

function session(overrides: { token: string; refreshToken: string }) {
  return {
    ...overrides,
    // Far enough out that needsRefresh() stays false and near enough that the
    // scheduled timer does not overflow.
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    user: {
      id: "u1",
      email: "user@example.test",
      name: null,
      imageUrl: null,
      username: null,
    },
  }
}

function refreshResponse(token: string, refreshToken: string): Response {
  return new Response(
    JSON.stringify({
      token,
      refreshToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: { id: "u1", email: "user@example.test", name: null, imageUrl: null, username: null },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
}

/** A manager over a fresh app home, with the fetch call held open. */
function startedRefresh() {
  const home = makeHome("mauscode-auth-manager-")
  userData = home
  sharedStore = null
  let answer: (response: Response) => void = () => {}
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve
      }),
  )
  vi.stubGlobal("fetch", fetchMock)
  const manager = new AuthManager(false)
  const seed = new AuthStore(home, makeStore(home, { available: true }))
  seed.save(session({ token: "synthetic-token-a", refreshToken: "synthetic-refresh-a" }))
  return { manager, home, fetchMock, answer: (response: Response) => answer(response) }
}

describe("auth manager refresh", () => {
  it.afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("stores and reports a refresh whose session is still the current one", async () => {
    const { manager, answer, fetchMock } = startedRefresh()
    const seen: string[] = []
    manager.setOnTokenRefresh((authData) => seen.push(authData.token))
    const refreshing = manager.refresh()
    answer(refreshResponse("synthetic-token-a2", "synthetic-refresh-a2"))
    await expect(refreshing).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(manager.getAuth()?.token).toBe("synthetic-token-a2")
    // The cookie callback only hears about a token that was actually stored.
    expect(seen).toEqual(["synthetic-token-a2"])
  })

  it("discards a refresh that finished after another account signed in", async () => {
    const { manager, home, answer, fetchMock } = startedRefresh()
    const seen: string[] = []
    manager.setOnTokenRefresh((authData) => seen.push(authData.token))
    const refreshing = manager.refresh()
    // The first account's request is still in flight when the second signs in.
    const replacement = new AuthStore(home, makeStore(home, { available: true }))
    replacement.save(session({ token: "synthetic-token-b", refreshToken: "synthetic-refresh-b" }))
    answer(refreshResponse("synthetic-token-a2", "synthetic-refresh-a2"))
    await expect(refreshing).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(manager.getAuth()?.token).toBe("synthetic-token-b")
    expect(seen).toEqual([])
  })

  it("discards a refresh that finished after a sign-out", async () => {
    const { manager, answer } = startedRefresh()
    const refreshing = manager.refresh()
    manager.logout()
    answer(refreshResponse("synthetic-token-a2", "synthetic-refresh-a2"))
    await expect(refreshing).resolves.toBe(false)
    expect(manager.getAuth()).toBeNull()
    expect(manager.isAuthenticated()).toBe(false)
  })

  it("makes one request for callers that arrive during a refresh", async () => {
    const { manager, answer, fetchMock } = startedRefresh()
    const first = manager.refresh()
    const second = manager.refresh()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    answer(refreshResponse("synthetic-token-a2", "synthetic-refresh-a2"))
    await expect(Promise.all([first, second])).resolves.toEqual([true, true])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(manager.getAuth()?.token).toBe("synthetic-token-a2")
  })

  it("starts a new request once the previous refresh settled", async () => {
    const { manager, answer, fetchMock } = startedRefresh()
    const first = manager.refresh()
    answer(refreshResponse("synthetic-token-a2", "synthetic-refresh-a2"))
    await expect(first).resolves.toBe(true)
    const second = manager.refresh()
    answer(refreshResponse("synthetic-token-a3", "synthetic-refresh-a3"))
    await expect(second).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(manager.getAuth()?.token).toBe("synthetic-token-a3")
  })
})
