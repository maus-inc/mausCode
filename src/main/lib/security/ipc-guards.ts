/**
 * Pure input guards for values the renderer sends to the main process.
 *
 * Threat model: a compromised renderer (XSS in a rendered markdown block, a
 * malicious preview page reaching the preload bridge) is assumed to be able to
 * invoke any exposed IPC channel with arbitrary arguments. Anything the main
 * process then does with those arguments — attaching credentials, opening a
 * socket, naming an IPC channel — happens with the user's privileges, so the
 * renderer must never be the only thing deciding those arguments.
 *
 * Kept free of Electron imports so the rules are unit-testable outside a
 * packaged app. Callers supply the configured backend themselves.
 */

/**
 * True when `rawUrl` is an absolute http(s) URL on the same origin as the
 * configured backend.
 *
 * The main process proxies authenticated requests on behalf of the renderer so
 * CORS does not apply, and that proxy attaches `X-Desktop-Token`. Without an
 * origin check a compromised renderer can point the proxy at any host and have
 * the main process hand it the user's auth token.
 */
export function isSameApiOrigin(rawUrl: unknown, apiBaseUrl: string): boolean {
  if (typeof rawUrl !== "string") return false
  let parsed: URL
  let base: URL
  try {
    parsed = new URL(rawUrl)
    base = new URL(apiBaseUrl)
  } catch {
    return false
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false
  return parsed.origin === base.origin
}

/**
 * Stream ids are interpolated into IPC channel names (`stream:${id}:chunk`).
 * Restrict them to a URL-safe token charset so a crafted id cannot collide
 * with, or be smuggled into, another channel name.
 *
 * Matches the ids `remote-chat-transport.ts` generates
 * (`stream_<timestamp>_<base36>`).
 */
const SAFE_IPC_TOKEN = /^[A-Za-z0-9_-]{1,64}$/

export function isSafeIpcToken(value: unknown): value is string {
  return typeof value === "string" && SAFE_IPC_TOKEN.test(value)
}
