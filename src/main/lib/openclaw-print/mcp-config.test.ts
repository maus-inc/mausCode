/**
 * openclaw-print MCP-list parsing tests over the LIVE capture
 * (`openclaw mcp list --json` with one stdio + one remote server;
 * the bearer value is a REDACTED-FIXTURE placeholder, never a key).
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { assert, describe, it } from "@effect/vitest"
import { parseOpenclawMcpList } from "./mcp-config"

const FIXTURE = readFileSync(
  join(fileURLToPath(new URL(".", import.meta.url)), "test", "fixtures", "openclaw-mcp-list.json"),
  "utf8",
)

describe("parseOpenclawMcpList", () => {
  it("parses the live map shape into global server configs", () => {
    const servers = parseOpenclawMcpList(FIXTURE)
    assert.equal(servers.length, 2)

    const stdio = servers.find((s) => s.name === "time-probe")
    assert.ok(stdio)
    assert.equal(stdio?.scope, "global")
    assert.equal(stdio?.transport, "stdio")
    assert.equal(stdio?.command, "uvx")
    assert.deepEqual(stdio?.args, ["mcp-server-time"])
    assert.deepEqual(stdio?.env, { TZ: "America/New_York" })
    assert.equal(stdio?.disabled, false)

    const remote = servers.find((s) => s.name === "docs-probe")
    assert.ok(remote)
    assert.equal(remote?.transport, "streamable-http")
    assert.equal(remote?.url, "https://mcp.example.com/mcp")
    assert.deepEqual(remote?.headers, {
      Authorization: "Bearer REDACTED-FIXTURE",
    })
  })

  it("returns [] on unparseable output (never throws)", () => {
    assert.deepEqual(parseOpenclawMcpList("not json"), [])
    assert.deepEqual(parseOpenclawMcpList("[]"), [])
  })

  it("honors disabled/enabled flags when present", () => {
    const servers = parseOpenclawMcpList(
      JSON.stringify({
        a: { command: "x", disabled: true },
        b: { command: "y", enabled: false },
        c: { command: "z" },
      }),
    )
    assert.equal(servers.find((s) => s.name === "a")?.disabled, true)
    assert.equal(servers.find((s) => s.name === "b")?.disabled, true)
    assert.equal(servers.find((s) => s.name === "c")?.disabled, false)
  })
})
