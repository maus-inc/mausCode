import { describe, expect, it } from "vitest"
import { parseGrokMcpListJson, parseGrokMcpToml } from "./mcp-config"

describe("parseGrokMcpToml", () => {
  it("reads [mcp_servers.*] tables and ignores the rest", () => {
    const servers = parseGrokMcpToml(`
model = "grok-4-5"

[mcp_servers.github]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"] # trailing comment
env = { GITHUB_TOKEN = "tok-1" }

[mcp_servers.docs]
url = "https://docs.internal/mcp"
headers = { Authorization = "Bearer abc" }

[other.table]
command = "should-be-ignored"
`)
    expect(Object.keys(servers).sort()).toEqual(["docs", "github"])
    expect(servers.github).toMatchObject({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "tok-1" },
    })
    expect(servers.docs).toMatchObject({
      url: "https://docs.internal/mcp",
      headers: { Authorization: "Bearer abc" },
    })
  })

  it("joins wrapped arrays and merges one-level subtables", () => {
    const servers = parseGrokMcpToml(`
[mcp_servers.wrapped]
command = "npx"
args = [
  "-y",
  "pkg",
]

[mcp_servers.sub]
command = "uvx"

[mcp_servers.sub.env]
TOKEN = "tok-sub"
`)
    expect(servers.wrapped).toMatchObject({
      command: "npx",
      args: ["-y", "pkg"],
    })
    expect(servers.sub).toMatchObject({
      command: "uvx",
      env: { TOKEN: "tok-sub" },
    })
  })

  it("returns an empty map for configs without mcp_servers", () => {
    expect(parseGrokMcpToml('[models]\ndefault = "x"\n')).toEqual({})
    expect(parseGrokMcpToml("")).toEqual({})
  })
})

describe("parseGrokMcpListJson", () => {
  it("accepts arrays of named entries", () => {
    const servers = parseGrokMcpListJson([
      { name: "a", command: "uvx", args: ["mcp-server"] },
      { name: "b", url: "https://example.com/mcp" },
      { name: "", command: "nameless" },
    ])
    expect(Object.keys(servers).sort()).toEqual(["a", "b"])
    expect(servers.a).toMatchObject({ command: "uvx", args: ["mcp-server"] })
  })

  it("accepts the common object envelopes", () => {
    for (const envelope of ["mcp_servers", "mcpServers", "servers"]) {
      const servers = parseGrokMcpListJson({
        [envelope]: { deep: { command: "deep-cmd" } },
      })
      expect(servers.deep).toMatchObject({ command: "deep-cmd" })
    }
    const bare = parseGrokMcpListJson({ odd: { command: "odd-cmd" } })
    expect(bare.odd).toMatchObject({ command: "odd-cmd" })
  })

  it("drops transport-less stubs and non-objects", () => {
    expect(parseGrokMcpListJson([{ name: "stub" }])).toEqual({})
    expect(parseGrokMcpListJson(null)).toEqual({})
    expect(parseGrokMcpListJson("nope")).toEqual({})
  })
})
