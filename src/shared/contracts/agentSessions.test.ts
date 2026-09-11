/**
 * Ported from pingdotgg/t3code packages/contracts (MIT, (c) 2026 T3 Tools Inc.).
 * T3 product identifiers kept verbatim so ported tests stay faithful; see README.md.
 */
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"

import { AgentSessionScanResult } from "./agentSessions.ts"

const decodeScanResult = Schema.decodeUnknownSync(AgentSessionScanResult)

const candidate = {
  path: "/projects/repo",
  title: "repo",
  sources: ["codex"],
  threadCount: 3,
  lastActiveAt: "2026-08-20T12:00:00.000Z",
  alreadyImported: false,
} as const

describe("AgentSessionScanResult", () => {
  it("decodes candidates from servers that predate the git scan", () => {
    const result = decodeScanResult({
      candidates: [candidate],
      scannedAt: "2026-08-22T12:00:00.000Z",
    })

    expect(result.candidates[0]?.git).toBeUndefined()
  })

  it("preserves reported git identity", () => {
    const git = { remoteKey: "github.com/pingdotgg/t3code", repository: "pingdotgg/t3code" }
    const result = decodeScanResult({
      candidates: [{ ...candidate, git }],
      scannedAt: "2026-08-22T12:00:00.000Z",
    })

    expect(result.candidates[0]?.git).toEqual(git)
  })
})
