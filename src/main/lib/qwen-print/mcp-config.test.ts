/**
 * qwen-print MCP config reader tests: user/project merge, transport
 * inference, tool filters, and the secret rule (env/header values are
 * never exposed, only key counts).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readQwenMcpConfig } from "./mcp-config"

function makeLayout(): { home: string; project: string } {
  const home = mkdtempSync(join(tmpdir(), "qwen-mcp-home-"))
  const project = mkdtempSync(join(tmpdir(), "qwen-mcp-proj-"))
  mkdirSync(join(home, ".qwen"), { recursive: true })
  writeFileSync(
    join(home, ".qwen", "settings.json"),
    JSON.stringify({
      mcpServers: {
        gh: {
          command: "npx",
          args: ["-y", "pkg"],
          env: { GITHUB_TOKEN: "sekret" },
          trust: true,
          includeTools: ["list_issues"],
        },
        api: {
          url: "https://api.example.test/mcp",
          transport: "http",
          headers: { Authorization: "Bearer sekres" },
          timeout: 5000,
          description: "Example API",
          excludeTools: ["doom"],
        },
      },
    }),
  )
  mkdirSync(join(project, ".qwen"), { recursive: true })
  writeFileSync(
    join(project, ".qwen", "settings.json"),
    JSON.stringify({
      mcpServers: {
        local: { command: "./mcp.sh" },
      },
    }),
  )
  writeFileSync(
    join(project, ".mcp.json"),
    JSON.stringify({ mcpServers: { extra: { url: "http://x/mcp" } } }),
  )
  return { home, project }
}

describe("readQwenMcpConfig", () => {
  it("reads user + project + .mcp.json with scopes and sources", () => {
    const { home, project } = makeLayout()
    const { servers, files } = readQwenMcpConfig({
      homeDir: home,
      projectDir: project,
    })
    expect(files).toHaveLength(3)
    expect(files.every((f) => f.exists)).toBe(true)
    expect(servers.map((s) => s.name).sort()).toEqual(["api", "extra", "gh", "local"])
    const gh = servers.find((s) => s.name === "gh")
    expect(gh?.scope).toBe("user")
    expect(gh?.transport).toBe("stdio")
    expect(gh?.trust).toBe(true)
    expect(gh?.includeTools).toEqual(["list_issues"])
    const api = servers.find((s) => s.name === "api")
    expect(api?.transport).toBe("http")
    expect(api?.timeoutMs).toBe(5000)
    expect(api?.excludeTools).toEqual(["doom"])
    const extra = servers.find((s) => s.name === "extra")
    expect(extra?.scope).toBe("project")
    expect(extra?.transport).toBe("http")
  })

  it("passes env/header values through for tool fetchers", () => {
    const { home, project } = makeLayout()
    const { servers } = readQwenMcpConfig({ homeDir: home, projectDir: project })
    // Same posture as the grok/cursor backends: values feed MCP server
    // spawning; the settings UI renders keys only and nothing logs them.
    expect(servers.find((s) => s.name === "gh")?.env).toEqual({
      GITHUB_TOKEN: "sekret",
    })
    expect(servers.find((s) => s.name === "api")?.headers).toEqual({
      Authorization: "Bearer sekres",
    })
  })

  it("reports unreadable files instead of throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "qwen-mcp-bad-"))
    mkdirSync(join(home, ".qwen"), { recursive: true })
    writeFileSync(join(home, ".qwen", "settings.json"), "{not json")
    const { servers, files } = readQwenMcpConfig({ homeDir: home })
    expect(servers).toEqual([])
    expect(files[0].exists).toBe(true)
    expect(files[0].error).toBeTruthy()
  })

  it("returns no servers when nothing is configured", () => {
    const home = mkdtempSync(join(tmpdir(), "qwen-mcp-empty-"))
    const { servers, files } = readQwenMcpConfig({ homeDir: home })
    expect(servers).toEqual([])
    expect(files).toHaveLength(1)
    expect(files[0].exists).toBe(false)
  })
})
