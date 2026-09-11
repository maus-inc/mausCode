/**
 * mausCode cline CLI binary resolution (ours, NOT verbatim).
 *
 * Order: `$CLINE_BINARY` override -> `$CLINE_BIN_PATH` (the npm
 * wrapper's own override, honored for parity) -> the compiled binary
 * sitting next to the resolved `cline` entry (`bin/.cline`, the
 * wrapper's cache location) -> `cline` on PATH as a last resort.
 *
 * Resolving the REAL binary (not the node wrapper) is load-bearing:
 * the wrapper spawns the Bun child with spawnSync and does NOT
 * forward signals, so SIGINT-cancel is silently ignored through it
 * (verified live: the run continues to completion). Spawned
 * directly, the binary dies promptly on SIGINT with truncated JSONL.
 *
 * The wrapper also harvests OS trust anchors into NODE_EXTRA_CA_CERTS
 * for the child; direct spawns rely on the runtime's bundled CAs
 * (corporate-proxy TLS is a known gap — see the decision brief).
 */

import { execFileSync } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { dirname, join } from "node:path"
import { app } from "electron"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

export type ClineCliLaunch = {
  command: string
  args: string[]
}

function getBundledClinePath(): string {
  const binaryName = isWindows() ? "cline.exe" : "cline"
  return join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "resources",
    "bin",
    binaryName,
  )
}

function whichCandidates(commandName: string): string[] {
  try {
    const command = isWindows() ? "where" : "which"
    const output = execFileSync(command, [commandName], {
      encoding: "utf8",
      windowsHide: true,
    })
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/**
 * The npm wrapper caches the compiled Bun binary as `.cline` next to
 * the `cline` js entry (verified live in the global install). A
 * `.exe` sibling covers the Windows layout.
 */
function directBinaryNextTo(entryPath: string): string | null {
  try {
    const real = realpathSync(entryPath)
    const dir = dirname(real)
    for (const name of [".cline", "cline.exe", ".cline.exe"]) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
    return null
  } catch {
    return null
  }
}

function resolveClineCommand(): string {
  const override = process.env.CLINE_BINARY?.trim() || process.env.CLINE_BIN_PATH?.trim()
  if (override) return override

  for (const entry of whichCandidates("cline")) {
    const direct = directBinaryNextTo(entry)
    if (direct) return direct
  }

  return resolveCliBinaryPath({
    bundledPath: getBundledClinePath(),
    commandName: "cline",
    downloadHint: "Install the Cline CLI from https://docs.cline.bot (npm install -g cline)",
  })
}

/**
 * Resolve the `cline` CLI. Extra args are appended verbatim after the
 * binary (headless flags are top-level; `auth`/`config`/`mcp`
 * subcommands pass through the same way).
 */
export function resolveClineCliLaunch(extraArgs: string[] = []): ClineCliLaunch {
  return { command: resolveClineCommand(), args: [...extraArgs] }
}
