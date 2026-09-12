/**
 * mausCode grok CLI binary resolution (ours, NOT verbatim).
 *
 * Order: `$GROK_BINARY` override -> managed install
 * (`$GROK_HOME/bin/grok`, default `~/.grok/bin/grok`) -> `grok` on PATH.
 * The managed-install path is documented (`$GROK_HOME/bin/grok` runs the
 * update check); the override exists because the generic `grok` name
 * collides with community CLIs on PATH (same convention as
 * `$CURSOR_AGENT_BIN`).
 */

import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { app } from "electron"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

export type GrokCliLaunch = {
  command: string
  args: string[]
}

/** Config/state home: `$GROK_HOME` or `~/.grok` (documented default). */
export function resolveGrokHome(): string {
  const override = process.env.GROK_HOME?.trim()
  if (override) return override
  return join(homedir(), ".grok")
}

function managedGrokPath(): string {
  return join(resolveGrokHome(), "bin", isWindows() ? "grok.exe" : "grok")
}

function getBundledGrokPath(): string {
  const binaryName = isWindows() ? "grok.exe" : "grok"
  return join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "resources",
    "bin",
    binaryName,
  )
}

function resolveGrokCommand(): string {
  const override = process.env.GROK_BINARY?.trim()
  if (override) return override

  const managed = managedGrokPath()
  if (existsSync(managed)) return managed

  return resolveCliBinaryPath({
    bundledPath: getBundledGrokPath(),
    commandName: "grok",
    downloadHint:
      "Install Grok Build from https://docs.x.ai/build/overview " +
      "(curl -fsSL https://x.ai/cli/install.sh | bash)",
  })
}

/**
 * Resolve the `grok` CLI for headless turns. Extra args are appended
 * verbatim after the binary (no subcommand prefix; `-p` etc. are
 * top-level flags).
 */
export function resolveGrokCliLaunch(extraArgs: string[] = []): GrokCliLaunch {
  return { command: resolveGrokCommand(), args: [...extraArgs] }
}
