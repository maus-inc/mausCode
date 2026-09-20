import { describe, expect, it } from "vitest"
import { stringifyCredentialRecord } from "./secret-redaction"

describe("credential redaction", () => {
  it("never serializes credential values", () => {
    const rawToken = "oauth-token-that-must-not-appear"
    const output = stringifyCredentialRecord({ id: "account-1", oauthToken: rawToken })

    expect(output).not.toContain(rawToken)
    expect(output).toContain("[REDACTED]")
  })
})
