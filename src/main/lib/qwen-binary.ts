/**
 * mausCode qwen CLI binary resolution (ours, NOT verbatim).
 *
 * Order: `$QWEN_BINARY` override -> `qwen` on PATH (npm-global
 * `@qwen-code/qwen-code` install; upstream documents no managed
 * install dir or `$QWEN_HOME` override, so none is invented here).
 * The override exists so users with several qwen distributions can
 * pin one (same convention as `$CURSOR_AGENT_BIN`/`$GROK_BINARY`).
 */

import { join } from "node:path"
import { app } from "electron"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

export type QwenCliLaunch = {
  command: string
  args: string[]
}

function getBundledQwenPath(): string {
  const binaryName = isWindows() ? "qwen.exe" : "qwen"
  return join(
    app.isPackaged ? process.resourcesPath : process.cwd(),
    "resources",
    "bin",
    binaryName,
  )
}

function resolveQwenCommand(): string {
  const override = process.env.QWEN_BINARY?.trim()
  if (override) return override

  return resolveCliBinaryPath({
    bundledPath: getBundledQwenPath(),
    commandName: "qwen",
    downloadHint:
      "Install Qwen Code from https://github.com/QwenLM/qwen-code " +
      "(npm install -g @qwen-code/qwen-code)",
  })
}

/**
 * Resolve the `qwen` CLI. Extra args are appended verbatim after the
 * binary (headless flags are top-level; `mcp`/`sessions` subcommands
 * are passed through the same way).
 */
export function resolveQwenCliLaunch(extraArgs: string[] = []): QwenCliLaunch {
  return { command: resolveQwenCommand(), args: [...extraArgs] }
}
