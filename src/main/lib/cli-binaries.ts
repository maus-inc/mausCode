/**
 * Transplanted from SamSammane/1code-ui (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port from commit 51b79a5. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 6).
 */
import { execSync } from "node:child_process"
import { existsSync } from "node:fs"
import { buildExtendedPath, isWindows } from "./platform"

function findExecutableOnPath(commandName: string): string | null {
  try {
    const command = isWindows() ? `where ${commandName}` : `which ${commandName}`
    const fullPath = buildExtendedPath(process.env.PATH)
    const output = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PATH: fullPath },
    }).trim()

    const firstLine = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    return firstLine && existsSync(firstLine) ? firstLine : null
  } catch {
    return null
  }
}

/**
 * Resolve a CLI binary path: prefer bundled copy, then PATH.
 */
export function resolveCliBinaryPath(options: {
  bundledPath: string
  commandName: string
  downloadHint: string
}): string {
  if (existsSync(options.bundledPath)) {
    return options.bundledPath
  }

  const pathBinary = findExecutableOnPath(options.commandName)
  if (pathBinary) {
    console.log(
      `[cli-binary] Bundled ${options.commandName} not found, using PATH: ${pathBinary}`,
    )
    return pathBinary
  }

  throw new Error(
    `${options.commandName} CLI not found at ${options.bundledPath} or on PATH. ${options.downloadHint}`,
  )
}
