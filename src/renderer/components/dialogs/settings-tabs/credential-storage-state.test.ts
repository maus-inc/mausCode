/**
 * The rules behind the credential storage page, tested without rendering it.
 *
 * Every case here is a claim the page makes to the user, and the reviewers
 * raised three of them on the page while this logic lived inside the component,
 * where only a running app with a keyring could exercise it.
 */
import { describe, expect, it } from "vitest"
import {
  browserState,
  describeRefusal,
  describeRendererStorage,
  type ProtectionVerdict,
  protectionDetail,
  protectionHeadline,
  protectionVerdict,
  type StatusData,
  storedDetail,
  storedState,
  UNKNOWN_STATE,
} from "./credential-storage-state"

function status(overrides: Partial<StatusData> = {}): StatusData {
  return {
    protection: "os-encryption",
    encryptionAvailable: true,
    plaintextConsent: false,
    plaintextConsentAt: null,
    reason: "ready",
    backend: null,
    metadataError: null,
    signInFailure: null,
    providerReadErrors: [],
    rendererError: null,
    rendererKeysStored: [],
    ...overrides,
  }
}

const encrypted: ProtectionVerdict = {
  unknown: false,
  protectedByOs: true,
  consentOn: false,
}
const refused: ProtectionVerdict = { unknown: false, protectedByOs: false, consentOn: false }
const plaintext: ProtectionVerdict = { unknown: false, protectedByOs: false, consentOn: true }
const unknownVerdict: ProtectionVerdict = {
  unknown: true,
  protectedByOs: false,
  consentOn: false,
}

describe("credential storage verdict", () => {
  it("has no answer before the status query returns", () => {
    expect(protectionVerdict(undefined, null).unknown).toBe(true)
    expect(protectionVerdict(undefined, null).protectedByOs).toBe(false)
  })

  it("takes the flags from a status the main process confirmed", () => {
    expect(protectionVerdict(status(), null)).toEqual({
      unknown: false,
      protectedByOs: true,
      consentOn: false,
    })
    expect(protectionVerdict(status({ plaintextConsent: true }), null)).toEqual({
      unknown: false,
      protectedByOs: true,
      consentOn: true,
    })
  })

  it("states no verdict from a cached answer the query failed to confirm", () => {
    // The cache still holds the last successful answer, and presenting it beside
    // the error would report a keyring decision the app cannot stand behind now.
    const verdict = protectionVerdict(status({ plaintextConsent: true }), new Error("refused"))
    expect(verdict).toEqual({ unknown: true, protectedByOs: false, consentOn: false })
  })
})

describe("credential storage headline", () => {
  it("says it is checking while the first answer is on its way", () => {
    expect(protectionHeadline(true, unknownVerdict)).toBe("Checking the OS keyring...")
  })

  it("states no keyring verdict while the state is not known", () => {
    expect(protectionHeadline(false, unknownVerdict)).toBe("The OS keyring state is not known")
  })

  it("names each confirmed state", () => {
    expect(protectionHeadline(false, encrypted)).toBe(
      "New credentials are encrypted by the operating system",
    )
    expect(protectionHeadline(false, plaintext)).toBe(
      "New credentials are stored in plaintext because you allowed it",
    )
    expect(protectionHeadline(false, refused)).toBe(
      "The operating system cannot encrypt new credentials",
    )
  })
})

describe("credential storage detail", () => {
  it("shows the query error rather than a verdict", () => {
    expect(protectionDetail(false, unknownVerdict, "the read failed", status())).toBe(
      "the read failed",
    )
  })

  it("says it is reading the state before an answer arrives", () => {
    expect(protectionDetail(true, unknownVerdict, null, undefined)).toBe(
      "Reading the protection state from the main process.",
    )
    expect(protectionDetail(false, unknownVerdict, null, status())).toBe(
      "Reading the protection state from the main process.",
    )
  })

  it("names the keyring when it is protecting new credentials", () => {
    expect(protectionDetail(false, encrypted, null, status())).toContain("OS keyring")
  })

  it("explains each refusal the main process reports", () => {
    expect(
      protectionDetail(false, refused, null, status({ reason: "hardcoded-key-backend" })),
    ).toContain("basic_text")
    expect(protectionDetail(false, refused, null, status({ reason: "metadata-unreadable" }))).toBe(
      "The plaintext setting could not be read, so no new credential is written.",
    )
    expect(
      protectionDetail(
        false,
        refused,
        null,
        status({ reason: "metadata-unreadable", metadataError: "the file is a directory" }),
      ),
    ).toBe("the file is a directory")
    expect(
      protectionDetail(false, refused, null, status({ reason: "encryption-unavailable" })),
    ).toContain("No OS keyring is available")
    expect(
      protectionDetail(
        false,
        refused,
        null,
        status({ reason: "encryption-unavailable", backend: "kwallet" }),
      ),
    ).toContain("kwallet")
    expect(protectionDetail(false, refused, null, status({ reason: "something-new" }))).toBe(
      "The state of the OS keyring could not be read.",
    )
  })

  it("uses the refusal detail only when it answers the question", () => {
    expect(describeRefusal("metadata-unreadable", null, null)).toBe(
      "The plaintext setting could not be read, so no new credential is written.",
    )
  })
})

describe("credential storage rows", () => {
  it("names the failure the row reports", () => {
    expect(storedState(encrypted, "the store refused", "Failed")).toEqual({
      tone: "bad",
      label: "Failed",
    })
    expect(storedState(encrypted, "the file is unreadable", "Unreadable")).toEqual({
      tone: "bad",
      label: "Unreadable",
    })
  })

  it("states no verdict while the status is not known", () => {
    expect(storedState(unknownVerdict, null, "Failed")).toEqual(UNKNOWN_STATE)
  })

  it("describes the next write from the confirmed flags", () => {
    expect(storedState(encrypted, null, "Failed").label).toBe("New: encrypted")
    expect(storedState(plaintext, null, "Failed").label).toBe("New: plaintext")
    expect(storedState(refused, null, "Failed").label).toBe("New: refused")
  })

  it("names where a renderer value is stored, or that there is none", () => {
    expect(browserState(null, 0)).toEqual({ tone: "mute", label: "Nothing saved" })
    expect(browserState(null, 2)).toEqual({ tone: "ok", label: "In the app store" })
    expect(browserState("the file could not be read", 2)).toEqual({
      tone: "bad",
      label: "Unreadable",
    })
  })

  it("explains the renderer row in a sentence", () => {
    expect(describeRendererStorage(null, 0)).toBe("No provider value is saved in this app's store")
    expect(describeRendererStorage(null, 1)).toContain("1 provider value(s)")
    expect(describeRendererStorage("the file could not be read", 1)).toBe(
      "the file could not be read",
    )
  })

  it("takes the row sentence from the confirmed flags", () => {
    expect(storedDetail(encrypted, "encrypted", "allowed", "refused")).toBe("encrypted")
    expect(storedDetail(plaintext, "encrypted", "allowed", "refused")).toBe("allowed")
    expect(storedDetail(refused, "encrypted", "allowed", "refused")).toBe("refused")
  })
})
