/**
 * Plaintext credential files the runtime writes inside the app's private
 * instance home.
 *
 * The runtime persists a key passed through `set_api_key` as
 * `$JCODE_HOME/config/jcode/<provider>.env`, and the app cannot yet ask the
 * runtime to keep it in memory (see `.dump/app/research/2026-09-13-secret-owners.md`).
 * Until a runtime release carries that capability, the app clears these files
 * before the daemon starts and after it stops, so a key lives on disk only
 * while the daemon that needs it is running.
 */
import { existsSync, lstatSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"

/** Mirrors `storage::app_config_dir` with `JCODE_HOME` set. */
export function privateCredentialDir(jcodeHome: string): string {
  return join(jcodeHome, "config", "jcode")
}

/** How one file is removed. Injected so a test can exercise a failure. */
export type CredentialFileRemover = (path: string) => void

/**
 * Removes the runtime's provider credential files. Returns the file names it
 * removed, never their contents. A path that is not a plain directory is left
 * alone. Throws when a targeted file could not be removed, so a caller that
 * must not run the daemon beside a stale credential can fail closed.
 */
export function clearPrivateCredentialFiles(
  jcodeHome: string,
  remove: CredentialFileRemover = (path) => unlinkSync(path),
): string[] {
  const dir = privateCredentialDir(jcodeHome)
  const removed: string[] = []
  const failed: string[] = []
  try {
    if (!existsSync(dir)) return removed
    const stats = lstatSync(dir)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      console.warn(
        "[NativeRuntime] Refusing to clean a credential path that is not a directory:",
        dir,
      )
      return removed
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.name.endsWith(".env")) continue
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      const path = join(dir, entry.name)
      try {
        remove(path)
        removed.push(entry.name)
      } catch (error) {
        failed.push(entry.name)
        console.warn(`[NativeRuntime] Could not remove ${entry.name}:`, error)
      }
    }
  } catch (error) {
    console.warn("[NativeRuntime] Could not inspect the credential directory:", error)
  }
  if (failed.length > 0) {
    throw new Error(
      `A plaintext runtime credential could not be removed (${failed.join(", ")}). ` +
        "Remove it from the runtime home and try again.",
    )
  }
  return removed
}

/**
 * Teardown cleanup: removes the plaintext credentials and says how many were
 * removed, without naming a provider or a value in the log. Never throws, so a
 * quit path cannot fail on it.
 */
export function clearPrivateCredentialFilesQuietly(jcodeHome: string, when: string): void {
  let removed: string[]
  try {
    removed = clearPrivateCredentialFiles(jcodeHome)
  } catch (error) {
    console.warn(`[NativeRuntime] Credential cleanup did not finish ${when}:`, error)
    return
  }
  if (removed.length > 0) {
    console.log(
      `[NativeRuntime] Cleared ${removed.length} plaintext runtime credential file(s) ${when}`,
    )
  }
}
