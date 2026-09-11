/**
 * Local-only mode guard (main process).
 *
 * The flag is owned by the renderer's persisted setting and pushed here
 * via the `local-only:set` IPC channel (mirrors the analytics opt-out
 * sync). Default off.
 */
import {
  isOfficialCloudUrl,
  LOCAL_ONLY_BLOCKED_MESSAGE,
} from "../../shared/local-only"

export { isOfficialCloudUrl, LOCAL_ONLY_BLOCKED_MESSAGE }

let localOnlyEnabled = false

export function setLocalOnlyMode(enabled: boolean): void {
  localOnlyEnabled = enabled
}

export function isLocalOnlyMode(): boolean {
  return localOnlyEnabled
}

export class LocalOnlyBlockedError extends Error {
  code = "LOCAL_ONLY_BLOCKED"

  constructor(operation: string, url?: string | null) {
    super(
      url
        ? `${LOCAL_ONLY_BLOCKED_MESSAGE}: ${operation} (${url})`
        : `${LOCAL_ONLY_BLOCKED_MESSAGE}: ${operation}`,
    )
    this.name = "LocalOnlyBlockedError"
  }
}

/**
 * Throw when local-only mode forbids this remote operation. A missing URL
 * is treated as hosted (callers that cannot prove a user-owned endpoint
 * must pass the URL they are about to hit).
 */
export function assertRemoteAllowed(
  operation: string,
  url?: string | null,
): void {
  if (!isLocalOnlyMode()) return
  if (!url || isOfficialCloudUrl(url)) {
    let diagnosticUrl = url
    if (url) {
      try {
        diagnosticUrl = new URL(url).origin
      } catch {
        diagnosticUrl = null
      }
    }
    throw new LocalOnlyBlockedError(operation, diagnosticUrl)
  }
}
