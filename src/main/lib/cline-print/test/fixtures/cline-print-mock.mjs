#!/usr/bin/env node
/**
 * mausCode-authored mock of `cline --json`.
 * Replays REAL captured NDJSON per CLINE_MOCK_MODE (fixtures recorded
 * live against cline CLI v3.0.61 + a stub Responses-API provider);
 * records argv for assertions.
 */
import { appendFileSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const mode = process.env.CLINE_MOCK_MODE ?? "default"
const recordTo = process.env.CLINE_MOCK_RECORD
if (recordTo) {
  appendFileSync(recordTo, `${JSON.stringify(process.argv.slice(2))}\n`)
}

const here = dirname(fileURLToPath(import.meta.url))
const replay = (name) => {
  const raw = readFileSync(join(here, name), "utf8")
  process.stdout.write(raw.endsWith("\n") ? raw : `${raw}\n`)
}
const line = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
const errLine = (event) => process.stderr.write(`${JSON.stringify(event)}\n`)

const done = (reason, text) =>
  line({
    ts: "2026-09-11T00:00:00.000Z",
    type: "agent_event",
    event: {
      type: "done",
      reason,
      text,
      iterations: 1,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalCost: 0,
      },
    },
  })

const runResult = (finishReason, text) =>
  line({
    ts: "2026-09-11T00:00:00.000Z",
    type: "run_result",
    finishReason,
    iterations: 1,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    },
    aggregateUsage: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalCost: 0,
    },
    durationMs: 149,
    text,
  })

switch (mode) {
  case "tool":
    replay("cline-tool-turn.jsonl")
    break
  case "auth-error":
    done("error", "Incorrect API key provided")
    runResult("error", "Incorrect API key provided")
    line({
      ts: "2026-09-11T00:00:00.000Z",
      type: "error",
      message: "Incorrect API key provided",
    })
    break
  case "timeout":
    done("aborted", "")
    runResult("aborted", "")
    line({
      ts: "2026-09-11T00:00:00.000Z",
      type: "error",
      message: "run timed out after 4s",
    })
    break
  case "cli-error":
    line({
      ts: "2026-09-11T00:00:00.000Z",
      type: "error",
      message:
        "JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
    })
    break
  case "stderr-error":
    errLine({
      ts: "2026-09-11T00:00:00.000Z",
      type: "error",
      message: "unknown certificate verification error",
    })
    process.exitCode = 1
    break
  case "hook-noise":
    line({
      ts: "2026-09-11T00:00:00.000Z",
      type: "error",
      message: "hook dispatch failed: session.hook requires a valid hook event payload",
    })
    replay("cline-text-turn.jsonl")
    break
  case "hang":
    setInterval(() => {}, 1000)
    break
  default:
    replay("cline-text-turn.jsonl")
    break
}
