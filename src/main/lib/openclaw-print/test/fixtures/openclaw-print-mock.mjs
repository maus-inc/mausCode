#!/usr/bin/env node
/**
 * mausCode-authored mock of `openclaw agent exec --json`.
 * Replays envelopes per OPENCLAW_MOCK_MODE: error/timeout/
 * unknown-model are REAL captures (openclaw CLI 2026.9.2, recorded
 * live); success follows the documented stable envelope (sandbox TLS
 * interception blocked a live authenticated turn) with the stdin
 * prompt echoed back to prove carriage.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const mode = process.env.OPENCLAW_MOCK_MODE ?? "default"
const here = dirname(fileURLToPath(import.meta.url))
const replay = (name) => {
  const raw = readFileSync(join(here, name), "utf8")
  process.stdout.write(raw.endsWith("\n") ? raw : `${raw}\n`)
}

const readStdin = () =>
  new Promise((resolve) => {
    let text = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => {
      text += chunk
    })
    process.stdin.on("end", () => resolve(text))
    process.stdin.on("error", () => resolve(text))
  })

switch (mode) {
  case "auth-error":
    replay("openclaw-auth-error.json")
    process.exitCode = 1
    break
  case "timeout":
    replay("openclaw-timeout.json")
    process.exitCode = 2
    break
  case "unknown-model":
    replay("openclaw-unknown-model.json")
    process.exitCode = 1
    break
  case "stderr-noise": {
    process.stderr.write("[diagnostic] lane task error: lane=main durationMs=103\n")
    replay("openclaw-auth-error.json")
    process.exitCode = 1
    break
  }
  case "empty":
    process.exitCode = 0
    break
  case "garbage":
    process.stdout.write("not json at all\n")
    process.exitCode = 1
    break
  case "hang":
    setInterval(() => {}, 1000)
    break
  default: {
    const prompt = await readStdin()
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        status: "ok",
        final: `Echo: ${prompt}`,
        payloads: [{ text: `Echo: ${prompt}` }],
        usage: { input: 120, output: 8, total: 128 },
        costUsd: 0.0021,
        codeModeEngaged: false,
        assistantTurns: 2,
        toolSummary: { calls: 2, tools: ["read", "write"], totalToolTimeMs: 48 },
        model: "gpt-5.6-sol",
        provider: "openai",
        sessionId: "019mock-session-id",
      })}\n`,
    )
    break
  }
}
