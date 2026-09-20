import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"

const testState = vi.hoisted(() => ({ path: "" }))

const safeStorage = vi.hoisted(() => {
  const storage = {
    available: true,
    isEncryptionAvailable: vi.fn(() => storage.available),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, "")),
  }
  return storage
})

vi.mock("electron", () => ({
  app: { getPath: () => testState.path },
  safeStorage,
}))

let testUserDataPath = mkdtempSync(join(tmpdir(), "mauscode-auth-test-"))
testState.path = testUserDataPath

const loadAuthStore = async () => import("./auth-store")

describe("secret storage", () => {
  beforeEach(() => {
    safeStorage.available = true
    safeStorage.isEncryptionAvailable.mockClear()
    testUserDataPath = mkdtempSync(join(tmpdir(), "mauscode-auth-test-"))
    testState.path = testUserDataPath
  })

  it("round trips encrypted tokens", async () => {
    const { decryptToken, encryptToken } = await loadAuthStore()
    const encoded = encryptToken("private-token")
    expect(decryptToken(encoded)).toBe("private-token")
  })

  it("refuses plaintext until consent is recorded", async () => {
    safeStorage.available = false
    const { AuthStore, PlaintextSecretConsentRequiredError, setPlaintextSecretConsent } =
      await loadAuthStore()
    const store = new AuthStore(testUserDataPath)
    const data = {
      token: "private-token",
      refreshToken: "private-refresh-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: "1", email: "test@example.com", name: null, imageUrl: null, username: null },
    }

    expect(() => store.save(data)).toThrow(PlaintextSecretConsentRequiredError)
    setPlaintextSecretConsent(true)
    store.save(data)
    expect(JSON.parse(readFileSync(join(testUserDataPath, "auth.dat.json"), "utf8"))).toEqual(data)
    rmSync(testUserDataPath, { recursive: true, force: true })
  })
})
