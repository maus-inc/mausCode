import type { StatusResult } from "simple-git"
import { describe, expect, it } from "vitest"
import { parseDiffNumstat, parseGitLog, parseGitStatus, parseNameStatus } from "./parse-status"

/** Minimal StatusResult fixture shaped like `git status --porcelain=v2` output. */
function makeStatus(
  files: Array<{ path: string; index: string; working_dir: string; from?: string }>,
  branch = "main",
): StatusResult {
  return { current: branch, files } as unknown as StatusResult
}

describe("parseGitStatus", () => {
  it("classifies staged, unstaged, and untracked files", () => {
    const result = parseGitStatus(
      makeStatus([
        { path: "src/staged.ts", index: "M", working_dir: " " },
        { path: "src/unstaged.ts", index: " ", working_dir: "M" },
        { path: "src/new.ts", index: "?", working_dir: "?" },
        { path: "src/both.ts", index: "A", working_dir: "M" },
      ]),
    )

    expect(result.branch).toBe("main")
    expect(result.staged.map((f) => f.path)).toEqual(["src/staged.ts", "src/both.ts"])
    expect(result.unstaged.map((f) => f.path)).toEqual(["src/unstaged.ts", "src/both.ts"])
    expect(result.untracked.map((f) => f.path)).toEqual(["src/new.ts"])
    expect(result.staged.find((f) => f.path === "src/both.ts")?.status).toBe("added")
    expect(result.unstaged.find((f) => f.path === "src/both.ts")?.status).toBe("modified")
  })

  it("records oldPath for renamed entries", () => {
    const result = parseGitStatus(
      makeStatus([
        { path: "src/new-name.ts", index: "R", working_dir: " ", from: "src/old-name.ts" },
      ]),
    )

    expect(result.staged).toEqual([
      expect.objectContaining({
        path: "src/new-name.ts",
        oldPath: "src/old-name.ts",
        status: "renamed",
      }),
    ])
  })

  it("falls back to HEAD when no branch is reported", () => {
    expect(parseGitStatus(makeStatus([], "")).branch).toBe("HEAD")
  })
})

describe("parseGitLog", () => {
  it("parses pipe-delimited commits and preserves pipes inside descriptions", () => {
    const output = [
      "abc1234|abc123|Fix parser|handle a|b edge case|Maus Mausson|2026-09-10T12:00:00+01:00",
      "def5678|def567|Simple commit||Maus Mausson|2026-09-09T09:30:00+01:00",
    ].join("\n")

    const commits = parseGitLog(output)

    expect(commits).toHaveLength(2)
    expect(commits[0]).toMatchObject({
      hash: "abc1234",
      shortHash: "abc123",
      message: "Fix parser",
      description: "handle a|b edge case",
      author: "Maus Mausson",
    })
    expect(commits[1]?.description).toBeUndefined()
  })

  it("returns an empty list for empty input and skips malformed lines", () => {
    expect(parseGitLog("")).toEqual([])
    expect(parseGitLog("\nincomplete|line\n")).toEqual([])
  })
})

describe("parseDiffNumstat", () => {
  it("parses additions/deletions per file including binary entries", () => {
    const output = "12\t3\tsrc/a.ts\n-\t-\tassets/logo.png\n"
    const stats = parseDiffNumstat(output)

    expect(stats.get("src/a.ts")).toEqual({ additions: 12, deletions: 3 })
    expect(stats.get("assets/logo.png")).toEqual({ additions: 0, deletions: 0 })
  })

  it("indexes both old and new path for renames", () => {
    const stats = parseDiffNumstat("5\t2\tsrc/old.ts => src/new.ts\n")

    expect(stats.get("src/new.ts")).toEqual({ additions: 5, deletions: 2 })
    expect(stats.get("src/old.ts")).toEqual({ additions: 5, deletions: 2 })
  })
})

describe("parseNameStatus", () => {
  it("maps status codes and rename paths", () => {
    const output = [
      "A\tsrc/added.ts",
      "D\tsrc/deleted.ts",
      "M\tsrc/modified.ts",
      "R100\tsrc/before.ts\tsrc/after.ts",
    ].join("\n")

    expect(parseNameStatus(output)).toEqual([
      expect.objectContaining({ path: "src/added.ts", status: "added" }),
      expect.objectContaining({ path: "src/deleted.ts", status: "deleted" }),
      expect.objectContaining({ path: "src/modified.ts", status: "modified" }),
      expect.objectContaining({
        path: "src/after.ts",
        oldPath: "src/before.ts",
        status: "renamed",
      }),
    ])
  })
})
