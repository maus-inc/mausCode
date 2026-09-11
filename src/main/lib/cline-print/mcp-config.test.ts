/**
 * cline-print MCP config reader tests. File paths verified live
 * against cline CLI v3.0.61 (`cline config mcp` reads
 * `~/.cline/data/settings/cline_mcp_settings.json`).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readClineMcpConfig } from "./mcp-config"

function makeHome(files: Record<string, string>): string {
  const home = mkdtempSync(join(tmpdir(), "cline-mcp-test-"))
  for (const [rel, content] of Object.entries(files)) {
    const full = join(home, rel)
    mkdirSync(join(full, ".."), { recursive: true })
    writeFileSync(full, content)
  }
  return home
}

describe("readClineMcpConfig", () => {
  it("returns empty when no files exist", () => {
    const home = makeHome({})
    try {
      const { servers, files } = readClineMcpConfig({ homeDir: home })
      expect(servers).toEqual([])
      expect(files).toHaveLength(1)
      expect(files[0].exists).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("parses stdio + remote servers with full env values", () => {
    const home = makeHome({
      ".cline/data/settings/cline_mcp_settings.json": JSON.stringify({
        mcpServers: {
          local: {
            command: "npx",
            args: ["-y", "srv"],
            env: { API_KEY: "sekret-value" },
            disabled: false,
          },
          remote: {
            type: "streamableHttp",
            url: "https://example.com/mcp",
            headers: { Authorization: "Bearer sekres" },
          },
          legacy: { url: "https://example.com/sse" },
          off: { command: "x", disabled: true },
        },
      }),
    })
    try {
      const { servers } = readClineMcpConfig({ homeDir: home })
      expect(servers).toHaveLength(4)
      const local = servers.find((s) => s.name === "local")!
      expect(local.transport).toBe("stdio")
      expect(local.command).toBe("npx")
      expect(local.args).toEqual(["-y", "srv"])
      // Values pass through (tool fetchers need them; UI shows keys).
      expect(local.env).toEqual({ API_KEY: "sekret-value" })
      expect(local.disabled).toBe(false)
      const remote = servers.find((s) => s.name === "remote")!
      expect(remote.transport).toBe("streamableHttp")
      expect(remote.headers).toEqual({ Authorization: "Bearer sekres" })
      // Omitted type on a URL entry defaults to legacy sse.
      expect(servers.find((s) => s.name === "legacy")!.transport).toBe("sse")
      expect(servers.find((s) => s.name === "off")!.disabled).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("reads the project .cline/mcp.json as its own scope", () => {
    const home = makeHome({
      "proj/.cline/mcp.json": JSON.stringify({
        mcpServers: { p: { command: "node", args: ["s.js"] } },
      }),
    })
    try {
      const { servers, files } = readClineMcpConfig({
        homeDir: home,
        projectDir: join(home, "proj"),
      })
      expect(files).toHaveLength(2)
      expect(servers).toHaveLength(1)
      expect(servers[0].scope).toBe("project")
      expect(servers[0].transport).toBe("stdio")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("honors CLINE_DATA_DIR", () => {
    const home = makeHome({
      "alt/settings/cline_mcp_settings.json": JSON.stringify({
        mcpServers: { a: { command: "x" } },
      }),
    })
    try {
      const { servers } = readClineMcpConfig({
        homeDir: home,
        env: { CLINE_DATA_DIR: join(home, "alt") } as NodeJS.ProcessEnv,
      })
      expect(servers.map((s) => s.name)).toEqual(["a"])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
