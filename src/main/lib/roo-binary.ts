/**
 * mausCode roo CLI binary resolution (ours, NOT verbatim).
 *
 * Order: `$ROO_BINARY` override -> bundled resources/bin/roo ->
 * `roo` on PATH (install.sh puts the binary in ~/.local/bin/roo;
 * the extension bundle it drives defaults to ~/.roo/cli/extension,
 * overridable via $ROO_EXTENSION_PATH which the CLI reads itself).
 */

import { join } from "node:path"
import { app } from "electron"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

export type RooCliLaunch = {
  command: string
  args: string[]
}

function getBundledRooPath(): string {
  const binaryName = isWindows() ? "roo.exe" : "roo"
  return join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "resources",
    "bin",
    binaryName,
  )
}

function resolveRooCommand(): string {
  const override = process.env.ROO_BINARY?.trim()
  if (override) return override

  return resolveCliBinaryPath({
    bundledPath: getBundledRooPath(),
    commandName: "roo",
    downloadHint:
      "Install the Roo Code CLI (curl -fsSL https://raw.githubusercontent.com/RooCodeInc/Roo-Code/main/apps/cli/install.sh | sh).",
  })
}

/**
 * Resolve the `roo` CLI. Extra args are appended verbatim after the
 * binary (`-p ...`, `list ...`, `--version` all pass through the
 * same way).
 */
export function resolveRooCliLaunch(extraArgs: string[] = []): RooCliLaunch {
  return { command: resolveRooCommand(), args: [...extraArgs] }
}
