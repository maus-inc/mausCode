/**
 * roo-print argv + classifier tests against the source-verified
 * `roo -p` contract (RooCodeInc/Roo-Code apps/cli, cli-v0.1.17).
 */

import { existsSync, readFileSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { assert, describe, it } from "@effect/vitest"
import { buildRooPrintArgs, isRooAuthErrorMessage, mapRooMode } from "./args"

describe("mapRooMode", () => {
  it("maps plan->architect, ask->ask, rest->code", () => {
    assert.equal(mapRooMode("plan"), "architect")
    assert.equal(mapRooMode("ask"), "ask")
    assert.equal(mapRooMode("edit"), "code")
    assert.equal(mapRooMode("agent"), "code")
    assert.equal(mapRooMode("turbo"), "code")
  })
})

describe("buildRooPrintArgs", () => {
  it("builds the headless print argv with prompt-file carriage", () => {
    const { args, promptUsed, promptFile } = buildRooPrintArgs({
      cwd: "/repo",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
      mode: "agent",
      prompt: "hi",
    })
    try {
      const fileIndex = args.indexOf("--prompt-file")
      assert.ok(fileIndex !== -1)
      assert.equal(args[fileIndex + 1], promptFile)
      const withoutFile = [...args.slice(0, fileIndex + 1), "<prompt-file>"]
      assert.deepEqual(withoutFile, [
        "-p",
        "--output-format",
        "stream-json",
        "-w",
        "/repo",
        "--provider",
        "openrouter",
        "-m",
        "anthropic/claude-sonnet-4.5",
        "--mode",
        "code",
        "--prompt-file",
        "<prompt-file>",
      ])
      assert.equal(promptUsed, "hi")
      assert.equal(readFileSync(promptFile, "utf8"), "hi")
    } finally {
      rmSync(dirname(promptFile), { recursive: true, force: true })
    }
  })

  it("omits -m when no model is selected (upstream default chain)", () => {
    const { args, promptFile } = buildRooPrintArgs({
      cwd: "/repo",
      provider: "anthropic",
      mode: "plan",
      prompt: "hi",
    })
    try {
      assert.ok(!args.includes("-m"))
      assert.ok(args.includes("architect"))
    } finally {
      rmSync(dirname(promptFile), { recursive: true, force: true })
    }
  })

  it("wraps history ahead of the prompt (resume substitute)", () => {
    const { promptUsed, promptFile } = buildRooPrintArgs({
      cwd: "/x",
      provider: "openrouter",
      mode: "agent",
      prompt: "do it",
      historyText: "user: hello",
    })
    try {
      assert.equal(
        promptUsed,
        "<conversation_history>\nuser: hello\n</conversation_history>\n\ndo it",
      )
      assert.equal(readFileSync(promptFile, "utf8"), promptUsed)
    } finally {
      rmSync(dirname(promptFile), { recursive: true, force: true })
    }
  })

  it("carries dash-leading prompts safely via the prompt file", () => {
    const { args, promptUsed, promptFile } = buildRooPrintArgs({
      cwd: "/x",
      provider: "openrouter",
      mode: "agent",
      prompt: "--evil-flag",
    })
    try {
      assert.ok(!args.includes("--evil-flag"))
      assert.equal(promptUsed, "--evil-flag")
      assert.ok(existsSync(promptFile))
    } finally {
      rmSync(dirname(promptFile), { recursive: true, force: true })
    }
  })
})

describe("isRooAuthErrorMessage", () => {
  it("matches the CLI pre-run validation text", () => {
    assert.ok(isRooAuthErrorMessage("[CLI] Error: No API key provided."))
  })

  it("matches provider auth failures and rejects quota text", () => {
    assert.ok(isRooAuthErrorMessage("401 Unauthorized"))
    assert.ok(isRooAuthErrorMessage("invalid_api_key"))
    assert.ok(!isRooAuthErrorMessage("Rate limit exceeded, retry later"))
    assert.ok(!isRooAuthErrorMessage(""))
    assert.ok(!isRooAuthErrorMessage(undefined))
  })
})
