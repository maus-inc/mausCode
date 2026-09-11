/**
 * Native runtime host facade: app-wide singleton manager plus teardown hook.
 *
 * Paths: the private instance lives in `{userData}/maus-runtime` (stable across
 * restarts, so daemon sessions survive app relaunch). Packaged binary resolution
 * prefers `resourcesPath/bin/jcode[.exe]` when the release pipeline bundles it
 * and falls back to the npm-bundled platform runtime otherwise.
 */
import { app } from "electron"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { buildDaemonEndpointEnv, readEndpointSettings } from "./endpoints"
import { RuntimeManager } from "./manager"

export { RuntimeManager } from "./manager"
export type { ManagerPaths, RuntimeStatus } from "./manager"
export { NativeTranslator, NATIVE_ERROR_PREFIX, NATIVE_QUESTION_PREFIX } from "./translate"
export { ensureNativeSession, getMappedNativeSession } from "./sessions"
export { applyNativeCredentials, getActiveAnthropicToken, NativeCredentialError } from "./credentials"
export type { NativeCredentialRequest, NativeCredentialResult } from "./credentials"
export { resolveNativeMcpSnapshot } from "./mcp-config"
export type { NativeMcpSnapshot, NativeMcpServerView, NativeMcpConfigError } from "./mcp-config"
export {
  buildDaemonEndpointEnv,
  endpointMatches,
  isHonoredEndpoint,
  normalizeEndpointUrl,
  probeEndpoint,
  readEndpointSettings,
  writeEndpointSettings,
} from "./endpoints"
export type { NativeEndpoints } from "./endpoints"

let manager: RuntimeManager | null = null

function resolvePackagedBinary(): string | undefined {
  if (!app.isPackaged) return undefined
  const name = process.platform === "win32" ? "jcode.exe" : "jcode"
  const candidate = join(process.resourcesPath, "bin", name)
  return existsSync(candidate) ? candidate : undefined
}

export function getRuntimeManager(): RuntimeManager {
  if (!manager) {
    manager = new RuntimeManager({
      jcodeHome: join(app.getPath("userData"), "maus-runtime"),
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
    await manager.shutdown()
    manager = null
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
