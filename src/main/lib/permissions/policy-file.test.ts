/**
 * Policy file tests, run against a temporary HOME.
 *
 * Two of roadmap step 10's acceptance criteria live here. An unset policy file
 * has to yield the shipped deny-by-default floor rather than the bypass the
 * router used to fall back to, and this path must never write the user's own
 * `~/.claude/settings.json`: mausCode policy lives in mausCode's file, and
 * reading a provider's config stays read-only.
 *
 * `os.homedir()` reads `$HOME` on POSIX, which is what the CI quality job runs
 * on, so pointing HOME at a temp directory is enough to isolate the reader.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { APP_DATA_DIRNAME } from "../../../shared/app-identity"
import { resolvePolicy, SHIPPED_POLICY_FLOOR } from "../../../shared/permissions/policy"
import {
  invalidatePolicyCache,
  PERMISSIONS_FILE_NAME,
  permissionsPolicyPath,
  readPolicyFile,
} from "./policy-file"

let home = ""
let realHome: string | undefined

/** Write a policy file into the temporary HOME and drop the cache. */
function writePolicy(text: string): string {
  const dir = join(home, APP_DATA_DIRNAME)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, PERMISSIONS_FILE_NAME)
  writeFileSync(path, text, "utf-8")
  invalidatePolicyCache()
  return path
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "mauscode-policy-"))
  realHome = process.env.HOME
  process.env.HOME = home
  invalidatePolicyCache()
})

afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  invalidatePolicyCache()
  // Deletes the directory `home` names, never a path derived from a value a
  // failed hook could leave empty. See RECOVERY.md: the containment test got
  // this wrong and removed the workspace.
  if (home.startsWith(tmpdir())) rmSync(home, { recursive: true, force: true })
})

describe("where the policy lives", () => {
  it("points at mausCode's own data directory, not a provider's", () => {
    expect(permissionsPolicyPath()).toBe(join(home, APP_DATA_DIRNAME, PERMISSIONS_FILE_NAME))
    expect(permissionsPolicyPath()).not.toContain(".claude")
  })
})

describe("an absent policy file", () => {
  it("resolves to the shipped floor and says the default applied", async () => {
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("default")
    expect(loaded.error).toBeUndefined()
    expect(loaded.policy).toEqual(SHIPPED_POLICY_FLOOR)
  })

  it("denies the dangerous classes rather than falling back to a bypass", async () => {
    const { policy } = await readPolicyFile()
    expect(policy.classes.destructive).toBe("deny")
    expect(policy.classes.network).toBe("deny")
    expect(policy.classes.exfiltration).toBe("deny")
  })

  it("is not created by being read", async () => {
    await readPolicyFile()
    expect(existsSync(permissionsPolicyPath())).toBe(false)
    expect(existsSync(join(home, APP_DATA_DIRNAME))).toBe(false)
  })

  it("never writes the user's own Claude settings file", async () => {
    // A real user's Claude config, present before the run, with content that a
    // write would clobber.
    const claudeDir = join(home, ".claude")
    mkdirSync(claudeDir, { recursive: true })
    const settingsPath = join(claudeDir, "settings.json")
    const before = '{"model":"claude-sonnet-4-5","permissions":{"allow":["Bash(ls)"]}}'
    writeFileSync(settingsPath, before, "utf-8")

    await readPolicyFile()
    await readPolicyFile(join(home, APP_DATA_DIRNAME, PERMISSIONS_FILE_NAME))
    writePolicy('[classes]\ndestructive = "ask"\n')
    await readPolicyFile()

    expect(readFileSync(settingsPath, "utf-8")).toBe(before)
    expect(existsSync(join(claudeDir, "settings.local.json"))).toBe(false)
  })

  it("leaves a HOME with no Claude directory alone", async () => {
    await readPolicyFile()
    expect(existsSync(join(home, ".claude"))).toBe(false)
    expect(existsSync(join(home, ".claude.json"))).toBe(false)
  })
})

describe("a policy file that parses", () => {
  it("merges over the floor and says the file decided", async () => {
    writePolicy(`[classes]
destructive = "ask"

[modes.turbo]
allow_tools = ["Bash(git *)", "Bash(npm test)"]
`)
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("file")
    expect(loaded.policy.classes.destructive).toBe("ask")
    expect(loaded.policy.classes.network).toBe("deny")
    expect(loaded.policy.modes.turbo.allow_tools).toEqual(["Bash(git *)", "Bash(npm test)"])
    // The floor survives a file that never mentions ask mode.
    expect(loaded.policy.modes.ask).toEqual(SHIPPED_POLICY_FLOOR.modes.ask)
  })

  it("accepts a file of comments only", async () => {
    writePolicy("# nothing configured yet\n")
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("file")
    expect(loaded.policy).toEqual(resolvePolicy({}))
  })
})

describe("a policy file that cannot be used", () => {
  it("falls back to the floor and names the parse failure", async () => {
    writePolicy("[classes]\nnetwork = true\n")
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("invalid-file")
    expect(loaded.error).toContain("line 2")
    expect(loaded.policy).toEqual(SHIPPED_POLICY_FLOOR)
  })

  it.each([
    ["an unknown top-level key", '[clases]\nnetwork = "deny"\n'],
    ["an unknown class", '[classes]\n"read-write" = "deny"\n'],
    ["an unknown verdict", '[classes]\nnetwork = "maybe"\n'],
    ["an unknown mode", '[modes.yolo]\napproval = "allow"\n'],
    ["a malformed tool rule", '[modes.turbo]\nallow_tools = ["Bash(git"]\n'],
  ])("refuses %s rather than ignoring it", async (_label, text) => {
    writePolicy(text)
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("invalid-file")
    expect(loaded.error).toBeTruthy()
    expect(loaded.policy).toEqual(SHIPPED_POLICY_FLOOR)
  })

  it("refuses a file that tries to configure plan mode", async () => {
    // The evaluator owns the plan-mode floor, so a file that claims it is a
    // schema error and the whole file is dropped. Failing loudly beats silently
    // ignoring the key, because the user would otherwise believe it applied.
    writePolicy('[modes.plan]\napproval = "allow"\n')
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("invalid-file")
    expect(loaded.policy.modes.plan).toEqual({})
  })

  it("reports a directory in place of the file as unreadable, not as absent", async () => {
    mkdirSync(permissionsPolicyPath(), { recursive: true })
    invalidatePolicyCache()
    const loaded = await readPolicyFile()
    expect(loaded.source).toBe("invalid-file")
    expect(loaded.error).toContain("cannot read")
    expect(loaded.policy).toEqual(SHIPPED_POLICY_FLOOR)
  })
})

describe("the cache", () => {
  it("answers a tool call without reading the file again inside the TTL", async () => {
    const path = writePolicy('[classes]\ndestructive = "ask"\n')
    expect((await readPolicyFile()).policy.classes.destructive).toBe("ask")

    writeFileSync(path, '[classes]\ndestructive = "allow"\n', "utf-8")
    expect((await readPolicyFile()).policy.classes.destructive).toBe("ask")

    invalidatePolicyCache()
    expect((await readPolicyFile()).policy.classes.destructive).toBe("allow")
  })

  it("keys on the path, so a fixture cannot answer for the user's own file", async () => {
    const fixture = join(home, "fixture.toml")
    writeFileSync(fixture, '[classes]\nnetwork = "allow"\n', "utf-8")
    invalidatePolicyCache()

    expect((await readPolicyFile(fixture)).policy.classes.network).toBe("allow")
    expect((await readPolicyFile()).policy.classes.network).toBe("deny")
  })
})
