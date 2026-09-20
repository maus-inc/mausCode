import { describe, expect, it } from "vitest"
import { REDACTED, redactRecord, redactText, redactToJson } from "./redact"

/** Shaped like the credential rows the app stores. */
const accountRecord = {
  id: "acc_1",
  email: "user@example.com",
  oauthToken: "v10ciphertextbase64",
  apiKey: "sk-ant-oat01-abcdefghijklmnop",
  displayName: "Anthropic Account",
  connectedAt: "2026-09-20T10:00:00.000Z",
}

describe("log redaction", () => {
  it("redacts a serialized credential record and keeps the shape", () => {
    const serialized = redactToJson(accountRecord)
    expect(serialized).not.toContain("v10ciphertextbase64")
    expect(serialized).not.toContain("sk-ant-oat01")
    expect(JSON.parse(serialized)).toEqual({
      id: "acc_1",
      email: "user@example.com",
      oauthToken: REDACTED,
      apiKey: REDACTED,
      displayName: "Anthropic Account",
      connectedAt: "2026-09-20T10:00:00.000Z",
    })
  })

  it("redacts nested provider payloads and arrays", () => {
    const redacted = redactRecord({
      model: "claude-sonnet-4-5",
      config: {
        baseUrl: "https://example.test",
        token: "secret-value",
        headers: { Authorization: "Bearer abc" },
      },
      profiles: [{ apiKey: "sk-or-v1-abcdefghijklmnop", name: "work" }],
    })
    expect(JSON.stringify(redacted)).not.toContain("secret-value")
    expect(JSON.stringify(redacted)).not.toContain("sk-or-v1")
    expect(redacted.config.baseUrl).toBe("https://example.test")
    expect(redacted.profiles[0]?.name).toBe("work")
    expect(redacted.config.token).toBe(REDACTED)
    expect(redacted.profiles[0]?.apiKey).toBe(REDACTED)
  })

  it("redacts a token embedded in free text", () => {
    const line = `refresh failed for sk-ant-oat01-abcdefghijklmnop and gh p_${"a".repeat(20)}`
    const redacted = redactText(line)
    expect(redacted).not.toContain("sk-ant-oat01")
    expect(redacted).toContain("refresh failed for")
    expect(redactText("Authorization: Bearer abcdefghijklmnop").endsWith(REDACTED)).toBe(true)
  })

  it("keeps non-secret values and unusual input intact", () => {
    expect(redactRecord({ count: 3, enabled: true, missing: null })).toEqual({
      count: 3,
      enabled: true,
      missing: null,
    })
    expect(redactRecord(undefined)).toBeUndefined()
    const deep: Record<string, unknown> = {}
    let cursor = deep
    for (let index = 0; index < 20; index++) {
      cursor.next = {}
      cursor = cursor.next as Record<string, unknown>
    }
    expect(() => redactRecord(deep)).not.toThrow()
  })

  it("over-redacts a key that merely mentions a credential rather than leaking one", () => {
    expect(redactRecord({ tokenCount: 3, tokensUsed: 120 })).toEqual({
      tokenCount: REDACTED,
      tokensUsed: REDACTED,
    })
    expect(redactRecord({ model: "claude-sonnet-4-5", status: "ok" })).toEqual({
      model: "claude-sonnet-4-5",
      status: "ok",
    })
  })
})
