import { type ExecFileException, execFile } from "node:child_process"

/** What one probe invocation returns: the CLI's own words and how it ended. */
export type ProbeCommandResult = {
  stdout: string
  stderr: string
  exitCode: number | null
}

/**
 * Bound on a probe invocation. A probe asks a CLI for its version or its auth
 * status and nothing else, so one that has not answered within the bound is
 * reported as unavailable instead of being waited on.
 */
export const PROBE_TIMEOUT_MS = 15_000

/**
 * The code a probe ended with. `0` when the process ran and exited cleanly, its
 * numeric code when it ran and did not, and `null` when `execFile` reported no
 * numeric code at all — a spawn failure arrives as a string errno (`ENOENT`,
 * but also `EACCES`), and a timeout, a signal and a max-buffer cut arrive with
 * a non-numeric `error.code` too. `null` therefore means "no usable exit
 * code", which callers may read as "the binary is not there" only knowing the
 * ENOENT case is the one this helper can name; the cause lives on the error
 * itself, and collapsing it here is the classification the follow-up replaces
 * with a structured result.
 */
function exitCodeOf(error: ExecFileException | null): number | null {
  if (!error) return 0
  return typeof error.code === "number" ? error.code : null
}

/**
 * Run a CLI once on behalf of a capability probe, and resolve rather than
 * reject, because the failure that matters here is the ordinary one: the binary
 * is not installed.
 *
 * All ten backend manifests carried their own byte-identical copy of this —
 * eight as `runBinary`, two as `runLaunch` — which is ten places for one rule
 * about what a probe may and may not do. The two manifests that have always
 * given their launch probe a longer bound pass it explicitly.
 */
export function runProbeCommand(
  command: string,
  args: string[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeCommandResult> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        exitCode: exitCodeOf(error),
      })
    })
  })
}
