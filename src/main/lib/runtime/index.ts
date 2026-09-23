/**
 * Native runtime host facade: app-wide singleton manager plus teardown hook.
 *
 * Paths: the private instance lives in `{userData}/maus-runtime` (stable across
 * restarts, so daemon sessions survive app relaunch). Packaged binary resolution
 * prefers `resourcesPath/bin/jcode[.exe]` when the release pipeline bundles it
 * and falls back to the npm-bundled platform runtime otherwise.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import { app } from "electron"
import { clearPrivateCredentialFiles, clearPrivateCredentialFilesQuietly } from "./credential-files"
import { buildDaemonEndpointEnv, readEndpointSettings } from "./endpoints"
import { RuntimeManager } from "./manager"

export { clearPrivateCredentialFiles, privateCredentialDir } from "./credential-files"
export type { NativeCredentialRequest, NativeCredentialResult } from "./credentials"
export {
  applyNativeCredentials,
  getActiveAnthropicToken,
  NativeCredentialError,
  releaseNativeEphemeralCredentials,
} from "./credentials"
export type { NativeEndpoints } from "./endpoints"
export {
  buildDaemonEndpointEnv,
  endpointMatches,
  isHonoredEndpoint,
  normalizeEndpointUrl,
  probeEndpoint,
  readEndpointSettings,
  writeEndpointSettings,
} from "./endpoints"
export type { ManagerPaths, RuntimeStatus } from "./manager"
export { RuntimeManager } from "./manager"
export type { NativeMcpConfigError, NativeMcpServerView, NativeMcpSnapshot } from "./mcp-config"
export { resolveNativeMcpSnapshot } from "./mcp-config"
export { ensureNativeSession, getMappedNativeSession } from "./sessions"
export { NATIVE_ERROR_PREFIX, NATIVE_QUESTION_PREFIX, NativeTranslator } from "./translate"

let manager: RuntimeManager | null = null

function resolvePackagedBinary(): string | undefined {
  if (!app.isPackaged) return undefined
  const name = process.platform === "win32" ? "jcode.exe" : "jcode"
  const candidate = join(process.resourcesPath, "bin", name)
  return existsSync(candidate) ? candidate : undefined
}

export function getRuntimeManager(): RuntimeManager {
  if (!manager) {
    const jcodeHome = join(app.getPath("userData"), "maus-runtime")
    // The runtime writes a key it is handed as a plaintext file in this home.
    // Clear anything a previous run left before the daemon can read it; the app
    // applies the credential again for every turn, so nothing needs to survive.
    // This call fails closed: a file that cannot be removed stops the daemon
    // rather than letting it run beside a credential from an earlier session.
    const cleared = clearPrivateCredentialFiles(jcodeHome)
    if (cleared.length > 0) {
      console.log(
        `[NativeRuntime] Cleared ${cleared.length} plaintext runtime credential file(s) before starting the runtime`,
      )
    }
    manager = new RuntimeManager({
      jcodeHome,
      packagedBinary: resolvePackagedBinary(),
      env: buildDaemonEndpointEnv(readEndpointSettings()),
    })
    manager.on("failed", (error: unknown) => {
      console.error("[NativeRuntime] Daemon failed permanently:", error)
    })
  }
  return manager
}

/** Best-effort daemon shutdown for app quit. */
export async function shutdownRuntime(): Promise<void> {
  if (manager) {
    const home = manager.jcodeHome
    try {
      await manager.shutdown()
    } finally {
      // A failed or timed-out shutdown must not leave the plaintext files, or
      // a stale manager, behind.
      clearPrivateCredentialFilesQuietly(home, "after stopping the runtime")
      manager = null
    }
  }
}

/**
 * Relaunch the daemon so endpoint (or other launch-env) changes take effect.
 * In-flight native turns are aborted by the caller first; the next
 * `getRuntimeManager()` call builds a fresh manager with current settings.
 * Daemon sessions persist (stable jcodeHome) — only the process restarts.
 */
export async function restartRuntime(): Promise<void> {
  await shutdownRuntime()
}
