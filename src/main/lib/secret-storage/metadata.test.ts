import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  grantPlaintextConsent,
  metadataPath,
  readMetadata,
  revokePlaintextConsent,
  writeMetadata,
} from "./metadata"

const homes: string[] = []

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "mauscode-secret-meta-"))
  homes.push(home)
  return home
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe("consent metadata", () => {
  it("treats an absent file as no consent and no error", () => {
    const read = readMetadata(makeHome())
    expect(read.metadata.plaintextConsent).toBe(false)
    expect(read.error).toBeNull()
  })

  it("round trips consent and revokes it", () => {
    const home = makeHome()
    grantPlaintextConsent(home, new Date("2026-09-20T10:00:00.000Z"))
    const granted = readMetadata(home)
    expect(granted.metadata.plaintextConsent).toBe(true)
    expect(granted.metadata.plaintextConsentAt).toBe("2026-09-20T10:00:00.000Z")
    revokePlaintextConsent(home)
    expect(readMetadata(home).metadata.plaintextConsent).toBe(false)
  })

  it("writes owner-only files", () => {
    const home = makeHome()
    grantPlaintextConsent(home)
    const mode = statSync(metadataPath(home)).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it("reports a malformed file and keeps consent ungranted without deleting it", () => {
    const home = makeHome()
    writeFileSync(metadataPath(home), "{not json")
    const read = readMetadata(home)
    expect(read.error).not.toBeNull()
    expect(read.metadata.plaintextConsent).toBe(false)
    expect(readFileSync(metadataPath(home), "utf-8")).toBe("{not json")
  })

  it("rejects a recognized-JSON file with the wrong shape", () => {
    const home = makeHome()
    writeFileSync(metadataPath(home), JSON.stringify({ version: 2, plaintextConsent: true }))
    const read = readMetadata(home)
    expect(read.error).not.toBeNull()
    expect(read.metadata.plaintextConsent).toBe(false)
  })

  it("preserves an unparseable file beside the replacement", () => {
    const home = makeHome()
    writeFileSync(metadataPath(home), "not json at all")
    grantPlaintextConsent(home)
    expect(readMetadata(home).metadata.plaintextConsent).toBe(true)
    const preserved = readdirSync(home).filter((name) => name.includes(".invalid-"))
    expect(preserved).toHaveLength(1)
    expect(readFileSync(join(home, preserved[0] ?? ""), "utf-8")).toBe("not json at all")
  })

  it("leaves no temporary file behind", () => {
    const home = makeHome()
    writeMetadata(home, { version: 1, plaintextConsent: true, plaintextConsentAt: null })
    expect(readdirSync(home).filter((name) => name.includes(".tmp-"))).toHaveLength(0)
  })
})
