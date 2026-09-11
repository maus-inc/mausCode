/**
 * roo-print MCP config reader tests against the source-verified
 * McpHub schema (stdio/sse/streamable-http + base fields).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { readRooMcpConfig, rooGlobalMcpPath, rooProjectMcpPath } from "./mcp-config"

describe("roo MCP paths", () => {
  it("points at the shim global-storage settings file + .roo/mcp.json", () => {
    assert.equal(
      rooGlobalMcpPath({ homeDir: "/h" }),
      join("/h", ".vscode-mock", "global-storage", "settings", "mcp_settings.json"),
    )
    assert.equal(rooProjectMcpPath("/p"), join("/p", ".roo", "mcp.json"))
  })
})

describe("readRooMcpConfig", () => {
  const withFiles = (globalData: unknown, projectData?: unknown) => {
    const home = mkdtempSync(join(tmpdir(), "roo-mcp-"))
    const projectDir = join(home, "proj")
    const globalDir = join(home, ".vscode-mock", "global-storage", "settings")
    mkdirSync(globalDir, { recursive: true })
    mkdirSync(join(projectDir, ".roo"), { recursive: true })
    writeFileSync(
      join(globalDir, "mcp_settings.json"),
      typeof globalData === "string" ? globalData : JSON.stringify(globalData),
    )
    if (projectData !== undefined) {
      writeFileSync(join(projectDir, ".roo", "mcp.json"), JSON.stringify(projectData))
    }
    return { home, projectDir }
  }

  it("parses global + project servers with transports", () => {
    const { home, projectDir } = withFiles(
      {
        mcpServers: {
          fs: { type: "stdio", command: "npx", args: ["-y", "x"], timeout: 30 },
          remote: { type: "sse", url: "https://mcp.example/sse" },
          stream: { type: "streamable-http", url: "https://mcp.example/mcp" },
          off: { command: "bin", disabled: true },
        },
      },
      { mcpServers: { local: { command: "bin2" } } },
    )
    try {
      const { servers, files } = readRooMcpConfig({ homeDir: home, projectDir })
      assert.equal(files.length, 2)
      const byName = Object.fromEntries(servers.map((s) => [s.name, s]))
      assert.equal(byName.fs.transport, "stdio")
      assert.equal(byName.fs.timeoutMs, 30_000)
      assert.equal(byName.fs.scope, "global")
      assert.equal(byName.remote.transport, "sse")
      assert.equal(byName.stream.transport, "streamableHttp")
      assert.equal(byName.off.disabled, true)
      assert.equal(byName.local.scope, "project")
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it("tolerates missing files and garbage JSON", () => {
    const home = mkdtempSync(join(tmpdir(), "roo-mcp-empty-"))
    try {
      const missing = readRooMcpConfig({ homeDir: home })
      assert.equal(missing.servers.length, 0)
      assert.equal(missing.files[0].exists, false)

      const bad = withFiles("nope{{{")
      try {
        const parsed = readRooMcpConfig({ homeDir: bad.home })
        assert.equal(parsed.servers.length, 0)
        assert.ok(parsed.files[0].error)
      } finally {
        rmSync(bad.home, { recursive: true, force: true })
      }
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
