/**
 * The renderer storage for secret-bearing values, tested without a window.
 *
 * The case under test is a write the app store refuses: the value must not
 * stay in memory as if it were saved, because after a restart the app would
 * load whatever is on disk instead.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  remove: vi.fn(),
  query: vi.fn(),
}))

vi.mock("./trpc", () => ({
  trpcClient: {
    secretStorage: {
      setRendererSecret: { mutate: mocks.set },
      removeRendererSecret: { mutate: mocks.remove },
      rendererSecrets: { query: mocks.query },
    },
  },
}))

type StorageModule = typeof import("./renderer-secrets")

let mod: StorageModule

beforeEach(async () => {
  vi.resetModules()
  mocks.set.mockReset()
  mocks.remove.mockReset()
  mocks.query.mockReset()
  mocks.query.mockResolvedValue({ values: {}, error: null })
  mod = await import("./renderer-secrets")
})

afterEach(() => {
  // The module reads `globalThis.localStorage` defensively; tests that stub it
  // must not leak the stub into the next case.
  delete (globalThis as Record<string, unknown>).localStorage
})

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe("renderer secret storage", () => {
  it("puts the stored value back when the store refuses a write", async () => {
    mocks.query.mockResolvedValue({
      values: { "agents:openai-api-key": JSON.stringify("stored-key") },
      error: null,
    })
    const storage = mod.createRendererSecretStorage<string>("agents:openai-api-key")
    const seen: unknown[] = []
    storage.subscribe?.("agents:openai-api-key", (value) => seen.push(value), "fallback")
    await settle()

    mocks.set.mockRejectedValue(new Error("no usable keyring"))
    storage.setItem("agents:openai-api-key", "new-key")
    const result = await mod.whenRendererSecretSaved("agents:openai-api-key")

    expect(result.ok).toBe(false)
    // The refused value leaves memory; the confirmed one is what loads.
    expect(seen[seen.length - 1]).toBe("stored-key")
    expect(storage.getItem("agents:openai-api-key", "fallback")).toBe("stored-key")
  })

  it("keeps the stored value when a removal is refused", async () => {
    mocks.query.mockResolvedValue({
      values: { "agents:openai-api-key": JSON.stringify("stored-key") },
      error: null,
    })
    const storage = mod.createRendererSecretStorage<string>("agents:openai-api-key")
    const seen: unknown[] = []
    storage.subscribe?.("agents:openai-api-key", (value) => seen.push(value), "fallback")
    await settle()

    mocks.remove.mockRejectedValue(new Error("no usable keyring"))
    storage.removeItem("agents:openai-api-key")
    const result = await mod.whenRendererSecretSaved("agents:openai-api-key")

    expect(result.ok).toBe(false)
    // The store still holds the value, so the app keeps showing it.
    expect(seen[seen.length - 1]).toBe("stored-key")
    expect(storage.getItem("agents:openai-api-key", "fallback")).toBe("stored-key")
  })

  it("leaves a legacy value in place when its move into the store is refused", async () => {
    const legacy = new Map<string, string>([
      ["agents:openai-api-key", JSON.stringify("legacy-key")],
    ])
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => legacy.get(key) ?? null,
      removeItem: (key: string) => {
        legacy.delete(key)
      },
      setItem: (key: string, value: string) => {
        legacy.set(key, value)
      },
    }
    mocks.set.mockRejectedValue(new Error("no usable keyring"))

    const storage = mod.createRendererSecretStorage<string>("agents:openai-api-key")
    const seen: unknown[] = []
    storage.subscribe?.("agents:openai-api-key", (value) => seen.push(value), "fallback")
    await mod.whenRendererSecretSaved("agents:openai-api-key")

    // The refused move keeps the value visible and the legacy copy untouched,
    // so the next start can still read it from browser storage.
    expect(seen[seen.length - 1]).toBe("legacy-key")
    expect(storage.getItem("agents:openai-api-key", "fallback")).toBe("legacy-key")
    expect(legacy.has("agents:openai-api-key")).toBe(true)

    vi.resetModules()
    const fresh = await import("./renderer-secrets")
    const freshStorage = fresh.createRendererSecretStorage<string>("agents:openai-api-key")
    const freshSeen: unknown[] = []
    freshStorage.subscribe?.("agents:openai-api-key", (value) => freshSeen.push(value), "fallback")
    await fresh.whenRendererSecretSaved("agents:openai-api-key")

    expect(freshSeen[freshSeen.length - 1]).toBe("legacy-key")
    expect(freshStorage.getItem("agents:openai-api-key", "fallback")).toBe("legacy-key")
  })

  it("keeps the legacy copy until the store confirms the removal", async () => {
    const legacy = new Map<string, string>([
      ["agents:openai-api-key", JSON.stringify("legacy-key")],
    ])
    ;(globalThis as Record<string, unknown>).localStorage = {
      getItem: (key: string) => legacy.get(key) ?? null,
      removeItem: (key: string) => {
        legacy.delete(key)
      },
      setItem: (key: string, value: string) => {
        legacy.set(key, value)
      },
    }
    mocks.query.mockResolvedValue({
      values: { "agents:openai-api-key": JSON.stringify("stored-key") },
      error: null,
    })
    const storage = mod.createRendererSecretStorage<string>("agents:openai-api-key")
    storage.getItem("agents:openai-api-key", "fallback")
    await settle()

    mocks.remove.mockRejectedValue(new Error("no usable keyring"))
    storage.removeItem("agents:openai-api-key")
    const refused = await mod.whenRendererSecretSaved("agents:openai-api-key")
    expect(refused.ok).toBe(false)
    // A removal the store did not confirm must not destroy the only copy left.
    expect(legacy.has("agents:openai-api-key")).toBe(true)

    mocks.remove.mockResolvedValue(undefined)
    storage.removeItem("agents:openai-api-key")
    await mod.whenRendererSecretSaved("agents:openai-api-key")
    // Once the store confirms, the legacy copy goes with it.
    expect(legacy.has("agents:openai-api-key")).toBe(false)
  })

  it("drops a refused first write instead of keeping a value nothing stored", async () => {
    const storage = mod.createRendererSecretStorage<string>("agents:openai-api-key")
    storage.getItem("agents:openai-api-key", "fallback")
    await settle()

    mocks.set.mockRejectedValue(new Error("no usable keyring"))
    storage.setItem("agents:openai-api-key", "new-key")
    const result = await mod.whenRendererSecretSaved("agents:openai-api-key")

    expect(result.ok).toBe(false)
    expect(storage.getItem("agents:openai-api-key", "fallback")).toBe("fallback")
  })
})
