/**
 * Tests for the Phase 1 MCP config mirror. Fixture dirs under os.tmpdir();
 * the "real home" is injected so the tests never touch the developer's
 * ~/.claude.json. Run:
 *   node --test --experimental-strip-types src/main/lib/runtime/mcp-config.test.ts
 */

import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  isMcpServerEnabled,
  readMcpSchemaCache,
  resolveNativeMcpConfigs,
  resolveNativeMcpSnapshot,
} from "./mcp-config.ts"

function fixture(): { root: string; project: string; jcodeHome: string; home: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "maus-mcp-"))
  const project = path.join(root, "proj")
  const jcodeHome = path.join(root, "jh")
  const home = path.join(root, "home")
  fs.mkdirSync(project, { recursive: true })
  fs.mkdirSync(jcodeHome, { recursive: true })
  fs.mkdirSync(home, { recursive: true })
  return { root, project, jcodeHome, home }
}

test("enabled rule mirrors the daemon (disabled wins, default true)", () => {
  assert.equal(isMcpServerEnabled({}), true)
  assert.equal(isMcpServerEnabled({ enabled: false }), false)
  assert.equal(isMcpServerEnabled({ disabled: true }), false)
  assert.equal(isMcpServerEnabled({ disabled: true, enabled: true }), false)
  assert.equal(isMcpServerEnabled({ disabled: false, enabled: false }), true)
})

test("precedence: project overrides global, later project files win", () => {
  const { root, project, jcodeHome, home } = fixture()
  try {
    fs.writeFileSync(
      path.join(jcodeHome, "mcp.json"),
      JSON.stringify({ mcpServers: { a: { command: "global-a" }, b: { command: "global-b" } } }),
    )
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { a: { command: "proj-a" } } }),
    )
    fs.mkdirSync(path.join(project, ".jcode"), { recursive: true })
    fs.writeFileSync(
      path.join(project, ".jcode", "mcp.json"),
      JSON.stringify({ servers: { c: { command: "jcode-c" } } }),
    )
    const { servers, errors } = resolveNativeMcpConfigs(project, jcodeHome, home)
    assert.equal(errors.length, 0)
    assert.equal(servers.get("a")?.cfg.command, "proj-a")
    assert.equal(servers.get("b")?.cfg.command, "global-b")
    assert.equal(servers.get("c")?.cfg.command, "jcode-c")
    assert.ok(servers.get("a")?.source.endsWith(".mcp.json"))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("existing stdio beats incoming non-stdio on collision", () => {
  const { root, project, jcodeHome, home } = fixture()
  try {
    fs.writeFileSync(
      path.join(jcodeHome, "mcp.json"),
      JSON.stringify({ mcpServers: { s: { command: "npx server" } } }),
    )
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({ mcpServers: { s: { transport: "http", url: "https://x" } } }),
    )
    const { servers } = resolveNativeMcpConfigs(project, jcodeHome, home)
    assert.equal(servers.get("s")?.cfg.command, "npx server")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("claude.json top-level and per-project entries merge in", () => {
  const { root, project, jcodeHome, home } = fixture()
  try {
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { g: { command: "claude-global" } },
        projects: { [project]: { mcpServers: { p: { command: "claude-proj" } } } },
      }),
    )
    const { servers } = resolveNativeMcpConfigs(project, jcodeHome, home)
    assert.equal(servers.get("g")?.cfg.command, "claude-global")
    assert.equal(servers.get("p")?.cfg.command, "claude-proj")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("malformed files surface as errors, valid layers still load", () => {
  const { root, project, jcodeHome, home } = fixture()
  try {
    fs.writeFileSync(path.join(project, ".mcp.json"), "{ not json")
    fs.writeFileSync(
      path.join(jcodeHome, "mcp.json"),
      JSON.stringify({ mcpServers: { ok: { command: "fine" } } }),
    )
    const { servers, errors } = resolveNativeMcpConfigs(project, jcodeHome, home)
    assert.equal(errors.length, 1)
    assert.ok(errors[0].file.endsWith(".mcp.json"))
    assert.equal(servers.get("ok")?.cfg.command, "fine")
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("schema cache is version-gated and version-tolerant", () => {
  const { root, project, jcodeHome } = fixture()
  void project
  try {
    fs.writeFileSync(
      path.join(jcodeHome, "mcp-schema-cache.json"),
      JSON.stringify({
        version: 1,
        servers: { mem: { fingerprint: "x", tools: [{ name: "remember" }] } },
      }),
    )
    assert.deepEqual([...readMcpSchemaCache(jcodeHome).entries()], [["mem", ["remember"]]])
    fs.writeFileSync(
      path.join(jcodeHome, "mcp-schema-cache.json"),
      JSON.stringify({ version: 999, servers: {} }),
    )
    assert.equal(readMcpSchemaCache(jcodeHome).size, 0)
    fs.writeFileSync(path.join(jcodeHome, "mcp-schema-cache.json"), "garbage")
    assert.equal(readMcpSchemaCache(jcodeHome).size, 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test("snapshot: cached tools connect, missing cache pends, disabled omitted", () => {
  const { root, project, jcodeHome, home } = fixture()
  try {
    fs.writeFileSync(
      path.join(project, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          mem: { command: "mem" },
          newbie: { command: "new" },
          off: { command: "off", disabled: true },
        },
      }),
    )
    fs.writeFileSync(
      path.join(jcodeHome, "mcp-schema-cache.json"),
      JSON.stringify({
        version: 1,
        servers: { mem: { fingerprint: "x", tools: [{ name: "remember" }] } },
      }),
    )
    const snap = resolveNativeMcpSnapshot(project, jcodeHome, home)
    assert.deepEqual(
      snap.servers.map((s) => [s.name, s.status, s.tools]),
      [
        ["mem", "connected", ["remember"]],
        ["newbie", "pending", []],
      ],
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
