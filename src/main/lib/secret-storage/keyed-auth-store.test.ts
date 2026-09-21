import { readdirSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { createKeyedAuthStore, maskCredential } from "./keyed-auth-store"
import { makeHome, makeStore } from "./test-support"
import { SecretStorageError } from "./types"

function makeKeyedStore(home: string, available = true, consent = false) {
  return createKeyedAuthStore({
    provider: "github",
    field: "token",
    context: "The GitHub token",
    emptyMessage: "GitHub token cannot be empty",
    userDataPath: () => home,
    store: () => makeStore(home, { available, consent }),
  })
}

describe("keyed auth store", () => {
  it("round trips a value and reports it masked", () => {
    const home = makeHome()
    const store = makeKeyedStore(home)
    store.save("ghp_synthetic_token_value")
    expect(store.load()).toBe("ghp_synthetic_token_value")
    expect(store.status()).toEqual({
      ok: true,
      hasKey: true,
      maskedKey: "ghp_...alue",
    })
  })

  it("reports a missing value as absent rather than as an error", () => {
    expect(makeKeyedStore(makeHome()).status()).toEqual({ ok: true, hasKey: false })
  })

  it("masks a short value completely", () => {
    expect(maskCredential("short")).toBe("****")
    expect(maskCredential("exactly8")).toBe("****")
    expect(maskCredential("exactly9!")).toBe("exac...ly9!")
  })

  it("refuses an empty value and leaves the stored one alone", () => {
    const home = makeHome()
    const store = makeKeyedStore(home)
    store.save("ghp_synthetic_token_value")
    expect(() => store.save("   ")).toThrow("GitHub token cannot be empty")
    expect(store.load()).toBe("ghp_synthetic_token_value")
  })

  it("refuses a value the provider check rejects before writing anything", () => {
    const home = makeHome()
    const store = createKeyedAuthStore({
      provider: "openrouter",
      field: "apiKey",
      context: "The OpenRouter API key",
      emptyMessage: "OpenRouter API key cannot be empty",
      validate: (value) => {
        if (!value.startsWith("sk-or-")) throw new Error("must start with 'sk-or-'")
      },
      userDataPath: () => home,
      store: () => makeStore(home),
    })
    expect(() => store.save("wrong-prefix")).toThrow("must start with 'sk-or-'")
    expect(
      readdirSync(home, { recursive: true }).filter((name) =>
        String(name).includes("openrouter-auth"),
      ),
    ).toHaveLength(0)
  })

  it("reports an unreadable value instead of returning it", () => {
    const home = makeHome()
    makeKeyedStore(home).save("ghp_synthetic_token_value")
    const status = makeKeyedStore(home, false).status()
    expect(status.ok).toBe(false)
    if (status.ok) throw new Error("expected a refusal")
    expect(status.error).toMatch(/keyring|decrypt/i)
  })

  it("refuses a new value without consent and keeps the old one readable", () => {
    const home = makeHome()
    makeKeyedStore(home).save("ghp_synthetic_token_value")
    const locked = makeKeyedStore(home, false)
    expect(() => locked.save("ghp_replacement")).toThrow(SecretStorageError)
    expect(makeKeyedStore(home).load()).toBe("ghp_synthetic_token_value")
  })

  it("clears the value it owns", () => {
    const home = makeHome()
    const store = makeKeyedStore(home)
    store.save("ghp_synthetic_token_value")
    store.clear()
    expect(store.load()).toBeNull()
    expect(store.status()).toEqual({ ok: true, hasKey: false })
  })
})
