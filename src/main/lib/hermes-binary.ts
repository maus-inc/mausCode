/**
 * hermes-agent binary resolution (PATH-only; user-installed, never bundled).
 *
 * ACP entrypoints in preference order (per upstream docs): `hermes acp`,
 * then the `hermes-acp` launcher. `python -m acp_adapter` needs the checkout
 * venv on PATH and is left to the user's shell.
 */
import { resolveCliBinaryPath } from "./cli-binaries"

export type HermesLaunch = {
  command: string
  args: string[]
}

const INSTALL_HINT =
  "Install hermes-agent: https://github.com/NousResearch/hermes-agent " +
  "(then `uv pip install -e '.[acp]'` inside the checkout for ACP mode)"

export function resolveHermesCli(): string {
  return resolveCliBinaryPath({
    bundledPath: "hermes",
    commandName: "hermes",
    downloadHint: INSTALL_HINT,
  })
}

/**
 * Resolve the ACP server launch. Prefers `hermes acp` (single binary, global
 * flags supported); falls back to the standalone `hermes-acp` launcher.
 */
export function resolveHermesAcpLaunch(): HermesLaunch {
  try {
    return { command: resolveHermesCli(), args: ["acp"] }
  } catch {
    const launcher = resolveCliBinaryPath({
      bundledPath: "hermes-acp",
      commandName: "hermes-acp",
      downloadHint: INSTALL_HINT,
    })
    return { command: launcher, args: [] }
  }
}

export function resolveHermesCliLaunch(extraArgs: string[]): HermesLaunch {
  return { command: resolveHermesCli(), args: extraArgs }
}
