import { execFile } from "node:child_process"

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
 * Run a CLI once on behalf of a capability probe, and resolve rather than
 * reject, because the failure that matters here is the ordinary one: the binary
 * is not installed. `execFile` reports a spawn failure as a string errno
 * (`ENOENT`) on `error.code` and a non-zero exit as a number, so `exitCode` is
 * `number | null` and callers read `null` as "the process never ran".
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
      // Spawn failures (ENOENT) carry a string errno, not a numeric code.
      const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0
      resolve({
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        exitCode,
      })
    })
  })
}
