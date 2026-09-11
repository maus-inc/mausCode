/**
 * NOTE (transplant): cursor-agent binary resolution (PATH + platform fallbacks).
 * Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
 */
import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { resolveCliBinaryPath } from "./cli-binaries"
import { isWindows } from "./platform"

function getBundledAgentPath(binaryName: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require("electron") as typeof import("electron")
    return join(
      app.getAppPath(),
      "resources",
      "bin",
      `${process.platform}-${process.arch}`,
      binaryName,
    )
  } catch {
    return join(
      process.cwd(),
      "resources",
      "bin",
      `${process.platform}-${process.arch}`,
      binaryName,
    )
  }
}

export type CursorAgentLaunch = {
  command: string
  args: string[]
}

const VERSION_DIR_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$/

function parseCursorAgentVersion(versionString: string): number {
  const datePart = versionString.split("-")[0] ?? versionString
  const [year, month, day] = datePart.split(".")
  if (!year || !month || !day) return 0
  return Number(
    `${year}${month.padStart(2, "0")}${day.padStart(2, "0")}`,
  )
}

function getCursorAgentRoot(): string {
  const localAppData =
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
  return join(localAppData, "cursor-agent")
}

function resolveWindowsCursorAgentLaunch(agentRoot: string): CursorAgentLaunch | null {
  const versionsDir = join(agentRoot, "versions")
  if (!existsSync(versionsDir)) return null

  const versionNames = readdirSync(versionsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && VERSION_DIR_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => parseCursorAgentVersion(left) - parseCursorAgentVersion(right))

  const latestVersion = versionNames.at(-1)
  if (!latestVersion) return null

  const versionPath = join(versionsDir, latestVersion)
  const nodePath = join(versionPath, "node.exe")
  const indexPath = join(versionPath, "index.js")

  if (!existsSync(nodePath) || !existsSync(indexPath)) {
    return null
  }

  return {
    command: nodePath,
    args: [indexPath, "acp"],
  }
}

function resolveWindowsPowerShellLaunch(agentRoot: string): CursorAgentLaunch | null {
  const agentScript = join(agentRoot, "agent.ps1")
  if (!existsSync(agentScript)) return null

  const systemRoot = process.env.SystemRoot || "C:\\Windows"
  const powershellPath = join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  )

  if (!existsSync(powershellPath)) return null

  return {
    command: powershellPath,
    args: [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      agentScript,
      "acp",
    ],
  }
}

function resolveUnixCursorAgentLaunch(): CursorAgentLaunch {
  const binaryName = "agent"
  const bundledPath = getBundledAgentPath(binaryName)

  const command = resolveCliBinaryPath({
    bundledPath,
    commandName: binaryName,
    downloadHint:
      "Install Cursor CLI from https://cursor.com/docs/cli/installation",
  })

  return {
    command,
    args: ["acp"],
  }
}

/**
 * Resolve a spawn-safe Cursor Agent launch configuration.
 * On Windows, Node cannot spawn `.cmd` shims directly, so we launch the
 * bundled node.exe + index.js from the cursor-agent install directory.
 */
export function resolveCursorAgentLaunch(): CursorAgentLaunch {
  if (isWindows()) {
    const agentRoot = getCursorAgentRoot()

    const directLaunch = resolveWindowsCursorAgentLaunch(agentRoot)
    if (directLaunch) {
      console.log("[cursor-agent] Using bundled node launch:", directLaunch.command)
      return directLaunch
    }

    const powershellLaunch = resolveWindowsPowerShellLaunch(agentRoot)
    if (powershellLaunch) {
      console.log("[cursor-agent] Using PowerShell launch:", powershellLaunch.command)
      return powershellLaunch
    }
  }

  return resolveUnixCursorAgentLaunch()
}

export function resolveCursorAgentCliLaunch(extraArgs: string[]): CursorAgentLaunch {
  const acpLaunch = resolveCursorAgentLaunch()

  if (acpLaunch.args.length >= 2 && acpLaunch.args[1] === "acp") {
    return {
      command: acpLaunch.command,
      args: [acpLaunch.args[0]!, ...extraArgs],
    }
  }

  return {
    command: acpLaunch.command,
    args: [...acpLaunch.args.filter((arg) => arg !== "acp"), ...extraArgs],
  }
}
