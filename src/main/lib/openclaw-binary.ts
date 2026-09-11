/**
 * mausCode openclaw CLI binary resolution (ours, NOT verbatim).
 *
 * Order: `$OPENCLAW_BINARY` override -> `openclaw` on PATH (npm
 * global install). Unlike the cline wrapper there is no
 * signal-eating middleman (the `openclaw` entry is a direct node
 * script; SIGINT handling is the CLI's own and is slow/ignored for
 * blocked turns — the session runner escalates to SIGKILL, so
 * resolution needs no bypass).
 */

import { join } from "node:path"
import { app } from "electron"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

export type OpenclawCliLaunch = {
  command: string
  args: string[]
}

function getBundledOpenclawPath(): string {
  const binaryName = isWindows() ? "openclaw.exe" : "openclaw"
  return join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "resources",
    "bin",
    binaryName,
  )
}

function resolveOpenclawCommand(): string {
  const override = process.env.OPENCLAW_BINARY?.trim()
  if (override) return override

  return resolveCliBinaryPath({
    bundledPath: getBundledOpenclawPath(),
    commandName: "openclaw",
    downloadHint: "Install the OpenClaw CLI (npm install -g openclaw).",
  })
}

/**
 * Resolve the `openclaw` CLI. Extra args are appended verbatim after
 * the binary (`agent exec ...`, `models ...`, `mcp ...` all pass
 * through the same way).
 */
export function resolveOpenclawCliLaunch(extraArgs: string[] = []): OpenclawCliLaunch {
  return { command: resolveOpenclawCommand(), args: [...extraArgs] }
}
