import { existsSync, readFileSync, readlinkSync, unlinkSync } from "node:fs"
import { createServer } from "node:http"
import { join } from "node:path"
import * as Sentry from "@sentry/electron/main"
import { app, BrowserWindow, dialog, Menu, nativeImage, session } from "electron"
import {
  type AuthManager,
  getAuthManager as getAuthManagerFromModule,
  initAuthManager,
} from "./auth-manager"
import { AUTH_SERVER_PORT, DEV_USER_DATA_NAME, IS_DEV, PROTOCOL } from "./constants"
import {
  identify,
  initAnalytics,
  setSubscriptionPlan,
  shutdown as shutdownAnalytics,
  trackAppOpened,
  trackAuthCompleted,
} from "./lib/analytics"
import {
  checkForUpdates,
  downloadUpdate,
  initAutoUpdater,
  setupFocusUpdateCheck,
} from "./lib/auto-updater"
import { installCli, isCliInstalled, parseLaunchDirectory, uninstallCli } from "./lib/cli"
import { getApiUrl } from "./lib/config"
import { closeDatabase, initDatabase } from "./lib/db"
import { cleanupGitWatchers } from "./lib/git/watcher"
import { cancelAllPendingOAuth, handleMcpOAuthCallback } from "./lib/mcp-auth"
import { recoverQueuedSends } from "./lib/queue"
import { recoverInterruptedRuns } from "./lib/runs"
import { shutdownRuntime } from "./lib/runtime"
import {
  abortAllClaudeSessions,
  getAllMcpConfigHandler,
  hasActiveClaudeSessions,
} from "./lib/trpc/routers/claude"
import {
  abortAllCodexStreams,
  getAllCodexMcpConfigHandler,
  hasActiveCodexStreams,
} from "./lib/trpc/routers/codex"
import { abortAllNativeTurns, hasActiveNativeTurns } from "./lib/trpc/routers/runtime"
import {
  createMainWindow,
  createWindow,
  getAllWindows,
  getWindow,
  setIsQuitting,
} from "./windows/main"
import { windowManager } from "./windows/window-manager"

// Set dev mode userData path BEFORE requestSingleInstanceLock()
// This ensures dev and prod have separate instance locks
if (IS_DEV) {
  const { join } = require("node:path")
  const devUserData = join(app.getPath("userData"), "..", DEV_USER_DATA_NAME)
  app.setPath("userData", devUserData)
  console.log("[Dev] Using separate userData path:", devUserData)
}

// Increase V8 old-space limit for renderer/main processes to reduce OOM frequency
// under heavy multi-chat workloads. Must be set before app readiness/window creation.
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=8192")

// Initialize Sentry before app is ready (production only)
if (app.isPackaged && !IS_DEV) {
  const sentryDsn = import.meta.env.MAIN_VITE_SENTRY_DSN
  if (sentryDsn) {
    try {
      Sentry.init({
        dsn: sentryDsn,
      })
      console.log("[App] Sentry initialized")
    } catch (error) {
      console.warn("[App] Failed to initialize Sentry:", error)
    }
  } else {
    console.log("[App] Skipping Sentry initialization (no DSN configured)")
  }
} else {
  console.log("[App] Skipping Sentry initialization (dev mode)")
}

// Control-plane base URL — single source of truth lives in lib/config.ts
// (MAIN_VITE_API_URL env override, empty by default = local-only mode).
// Kept under the historical name because windows/main.ts imports it.
export function getBaseUrl(): string {
  return getApiUrl()
}

// Auth manager singleton (use the one from auth-manager module)
let authManager: AuthManager

export function getAuthManager(): AuthManager {
  // First try to get from module, fallback to local variable for backwards compat
  return getAuthManagerFromModule() || authManager
}

// Handle auth code from deep link (exported for IPC handlers)
/**
 * Writes the control-plane token cookie for this run.
 *
 * With no `expirationDate` Electron keeps this a session cookie, so the token
 * is never written to the cookie store on disk. The app re-issues it at
 * startup from the encrypted session and again whenever the token refreshes,
 * so nothing needs to survive a restart. A token that has already expired is
 * not written, and any cookie an earlier version left behind is removed.
 */
async function setDesktopTokenCookie(token: string, expiresAt: string): Promise<boolean> {
  const apiBase = getBaseUrl()
  if (!apiBase) return false
  const expiry = new Date(expiresAt).getTime()
  if (Number.isFinite(expiry) && expiry <= Date.now()) {
    // The direct call: this runs inside the queued write when a token is
    // already expired, and the queued form would wait on its own task.
    await removeDesktopTokenCookieNow(apiBase)
    return false
  }
  try {
    await session.fromPartition("persist:main").cookies.set({
      url: apiBase,
      name: "x-desktop-token",
      value: token,
      httpOnly: false,
      secure: apiBase.startsWith("https"),
      sameSite: "lax" as const,
    })
    return true
  } catch (error) {
    // The cookie carries control-plane requests; the session itself is already
    // saved in the store, and the next refresh retries this. A caller that
    // reports what happened needs to know the store refused it.
    console.warn("[Auth] Desktop token cookie could not be set:", error)
    return false
  }
}

/** Drops the control-plane cookie. Callers inside a queued task use this one. */
async function removeDesktopTokenCookieNow(apiBase: string): Promise<void> {
  try {
    await session.fromPartition("persist:main").cookies.remove(apiBase, "x-desktop-token")
  } catch (error) {
    console.warn("[Auth] Desktop token cookie could not be removed:", error)
  }
}

/**
 * Cookie work runs one task at a time. A write, the check that follows it and
 * the fallback write are a single decision, and two of them interleaving their
 * removes and sets would leave whichever cookie store command happened to run
 * last, which is not necessarily the session that is saved. Tasks run through
 * `cookieTasks`, and the `...Now` helpers run inside one.
 */
let cookieTasks: Promise<unknown> = Promise.resolve()

function runCookieTask<T>(task: () => Promise<T>): Promise<T> {
  const result = cookieTasks.then(task, task)
  cookieTasks = result.then(
    () => {},
    () => {},
  )
  return result
}

/** Drops the control-plane cookie, so a rotated or expired token cannot linger. */
function removeDesktopTokenCookie(apiBase: string): Promise<void> {
  return runCookieTask(() => removeDesktopTokenCookieNow(apiBase))
}

/** How many times the pair of writes may chase a session change before giving up. */
const COOKIE_SETTLE_ROUNDS = 3

/**
 * Writes the control-plane cookie for the session that is saved right now, then
 * settles it against the store. A sign-out or a newer sign-in can land while the
 * cookie store is accepting a write, and no check before the write can see that.
 * Each round writes the cookie for whatever the store holds now and checks
 * again, so the cookie left in place is the saved session's. A session that kept
 * changing takes the cookie back instead of leaving one that may belong to an
 * account the app has left.
 *
 * Returns whether the cookie in place belongs to the session this call was for.
 */
async function writeDesktopTokenCookieNow(
  manager: AuthManager,
  token: string,
  expiresAt: string,
): Promise<boolean> {
  const apiBase = getBaseUrl()
  if (!apiBase) return false
  if (manager.getAuth()?.token !== token) return false
  await removeDesktopTokenCookieNow(apiBase)
  // The cookie store can refuse the write. Reporting success after that would
  // tell the caller an authenticated cookie is in place when none is.
  if (!(await setDesktopTokenCookie(token, expiresAt))) return false
  let written = token
  for (let round = 0; round < COOKIE_SETTLE_ROUNDS; round += 1) {
    const saved = manager.getAuth()
    if (saved?.token === written) return written === token
    await removeDesktopTokenCookieNow(apiBase)
    const expiry = manager.getTokenExpiry()
    if (!saved || !expiry) return false
    if (!(await setDesktopTokenCookie(saved.token, expiry))) return false
    written = saved.token
  }
  if (manager.getAuth()?.token !== written) await removeDesktopTokenCookieNow(apiBase)
  return false
}

/** The queued entry point, so this decision never overlaps another cookie task. */
function writeDesktopTokenCookie(
  manager: AuthManager,
  token: string,
  expiresAt: string,
): Promise<boolean> {
  return runCookieTask(() => writeDesktopTokenCookieNow(manager, token, expiresAt))
}

/**
 * Issues this run's cookie from the saved session. A previous run's session
 * cookie is not on disk, so this is what carries the control-plane token after
 * a restart, and a refresh inside `getValidToken` writes the new one again.
 */
function restoreDesktopTokenCookie(manager: AuthManager): void {
  const apiBase = getBaseUrl()
  if (!manager.isAuthenticated()) {
    // A session this run cannot use still leaves the cookie an earlier version
    // wrote with an expiry in the on-disk store, so it goes before anything else.
    if (apiBase) void removeDesktopTokenCookie(apiBase)
    return
  }
  void manager
    .getValidToken()
    .then(async (token) => {
      // Sign-out and a sign-in as another account can both land while the token
      // is being resolved, and again while the cookie is being written. The
      // store is the arbiter, so the cookie is only left in place while the
      // session this continuation started with is still the one saved.
      if (token === null) {
        // Resolving the token can fail into a sign-out, and the session that
        // started this run is gone. A cookie an earlier version wrote with an
        // expiry is still usable from disk, so it goes with the session.
        if (apiBase && !manager.isAuthenticated()) await removeDesktopTokenCookie(apiBase)
        return undefined
      }
      const expiresAt = manager.getTokenExpiry()
      if (!expiresAt) return undefined
      return writeDesktopTokenCookie(manager, token, expiresAt)
    })
    .catch((error) => {
      console.warn("[Auth] Could not restore the desktop token cookie:", error)
    })
}

export async function handleAuthCode(code: string): Promise<void> {
  console.log("[Auth] Handling auth code:", `${code.slice(0, 8)}...`)

  try {
    const authData = await authManager.exchangeCode(code)
    console.log("[Auth] Success for user:", authData.user.email)

    // Track successful authentication
    trackAuthCompleted(authData.user.id, authData.user.email)

    // Fetch and set subscription plan for analytics
    try {
      const planData = await authManager.fetchUserPlan()
      if (planData) {
        setSubscriptionPlan(planData.plan)
      }
    } catch (e) {
      console.warn("[Auth] Failed to fetch user plan for analytics:", e)
    }

    // Control-plane token for this run, in the persist:main partition. Remove
    // any cookie an earlier version wrote with an expiry first, so no stale
    // token stays behind in the on-disk cookie store.
    // Two sign-ins can overlap, and the older exchange can reach this point
    // after the newer one stored its session. The cookie belongs to the session
    // the manager kept, so a superseded exchange does not overwrite it with the
    // account that just signed out of the app's state.
    const cookieWritten = await writeDesktopTokenCookie(
      authManager,
      authData.token,
      authData.expiresAt,
    )
    if (cookieWritten) console.log("[Auth] Desktop token cookie set")

    // Notify all windows and reload them to show app
    const windows = getAllWindows()
    for (const win of windows) {
      try {
        if (win.isDestroyed()) continue
        win.webContents.send("auth:success", authData.user)

        // Use stable window ID (main, window-2, etc.) instead of Electron's numeric ID
        const stableId = windowManager.getStableId(win)

        if (process.env.ELECTRON_RENDERER_URL) {
          // Pass window ID via query param for dev mode
          const url = new URL(process.env.ELECTRON_RENDERER_URL)
          url.searchParams.set("windowId", stableId)
          win.loadURL(url.toString())
        } else {
          // Pass window ID via hash for production
          win.loadFile(join(__dirname, "../renderer/index.html"), {
            hash: `windowId=${stableId}`,
          })
        }
      } catch (error) {
        // Window may have been destroyed during iteration
        console.warn("[Auth] Failed to reload window:", error)
      }
    }
    // Focus the first window
    windows[0]?.focus()
  } catch (error) {
    console.error("[Auth] Exchange failed:", error)
    // Broadcast auth error to all windows (not just focused)
    for (const win of getAllWindows()) {
      try {
        if (!win.isDestroyed()) {
          win.webContents.send("auth:error", (error as Error).message)
        }
      } catch {
        // Window destroyed during iteration
      }
    }
  }
}

// Handle deep link
function handleDeepLink(url: string): void {
  console.log("[DeepLink] Received:", url)

  try {
    const parsed = new URL(url)

    // Handle auth callback: mauscode://auth?code=xxx
    if (parsed.pathname === "/auth" || parsed.host === "auth") {
      const code = parsed.searchParams.get("code")
      if (code) {
        handleAuthCode(code)
        return
      }
    }

    // Handle MCP OAuth callback: mauscode://mcp-oauth?code=xxx&state=yyy
    if (parsed.pathname === "/mcp-oauth" || parsed.host === "mcp-oauth") {
      const code = parsed.searchParams.get("code")
      const state = parsed.searchParams.get("state")
      if (code && state) {
        handleMcpOAuthCallback(code, state)
        return
      }
    }
  } catch (e) {
    console.error("[DeepLink] Failed to parse:", e)
  }
}

// Register protocol BEFORE app is ready
console.log("[Protocol] ========== PROTOCOL REGISTRATION ==========")
console.log("[Protocol] Protocol:", PROTOCOL)
console.log("[Protocol] Is dev mode (process.defaultApp):", process.defaultApp)
console.log("[Protocol] process.execPath:", process.execPath)
console.log("[Protocol] process.argv:", process.argv)

/**
 * Register the app as the handler for our custom protocol.
 * On macOS, this may not take effect immediately on first install -
 * Launch Services caches protocol handlers and may need time to update.
 */
function registerProtocol(): boolean {
  let success = false

  if (process.defaultApp) {
    // Dev mode: need to pass execPath and script path
    if (process.argv.length >= 2) {
      success = app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, process.argv.slice(1, 2))
      console.log(`[Protocol] Dev mode registration:`, success ? "success" : "failed")
    } else {
      console.warn("[Protocol] Dev mode: insufficient argv for registration")
    }
  } else {
    // Production mode
    success = app.setAsDefaultProtocolClient(PROTOCOL)
    console.log(`[Protocol] Production registration:`, success ? "success" : "failed")
  }

  return success
}

// Store initial registration result (set in app.whenReady())
let initialRegistration = false

// Verify registration (this checks if OS recognizes us as the handler)
function verifyProtocolRegistration(): void {
  const isDefault = process.defaultApp
    ? app.isDefaultProtocolClient(PROTOCOL, process.execPath, process.argv.slice(1, 2))
    : app.isDefaultProtocolClient(PROTOCOL)

  console.log(`[Protocol] Verification - isDefaultProtocolClient: ${isDefault}`)

  if (!isDefault && initialRegistration) {
    console.warn("[Protocol] Registration returned success but verification failed.")
    console.warn(
      "[Protocol] This is common on first install - macOS Launch Services may need time to update.",
    )
    console.warn("[Protocol] The protocol should work after app restart.")
  }
}

console.log("[Protocol] =============================================")

// Note: app.on("open-url") will be registered in app.whenReady()

// mausCode glyph favicon (64px PNG from the official brand asset) as data URI
// for auth callback pages and the local auth-callback server /favicon route.
const FAVICON_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAFVBMVEX///8ODg8ODQ4ODg4PDg8PDw8PDxBo6R6vAAACCUlEQVRIx+1UW3KjQAyEMgeICpQD7F4gFEm+l1pyABU1/vcH3P8I2y3N8HA4wH5ELjBmelqtlsZV9RP/ccgvxm9c8nK13vSyRX8F6CwtKSVdxOSK4iZYsyT4ErG3CwWmiv2mZkC8XRCYcrsZURcAQfpkfgHzHTCSO0USCnkGNH3s1tXvSZ+rEGxNXFwXai1V1EOJXqZx6mhRp9Bg9hLCGaPf2+JhS66UMgBPr+sCTWqHcqAmGFpVrISsAAiu3n86oJeoW1GZA26jA1iri+Qj2hMWOcEcDKkwGLtnTkPy2ycBHy4yGDScx7IDdA0AfJLMQG+FCAJqTSVFLjMeo0dSNdCyA0qKu/ubCKDbBMiyixz2IZSasDn6btmoU3xxXwBA9X3kapcyb5NzYqiH98FfKwHerOXPad4hgfZqYdBcZhlX892YOY0q7Cyy6TwpWLIGH6wDACNEO41Hos3+ZqMiAdvFhlPHXNp9KFOSKAdeOBRz+KsHAEYQx0DppUqKbh5F1iMTEGCiezdt0/DlJVIAB1ef2l1Vf5UDCg3RsL3d5eCMtIce8NDzTOapLgwD/JOUCTAcj+6cou6N5xRbkR8v71adATdVP6jqKXSJtx/pvuYyb6yYHuIDcx5SBcNaAM0areV/SvYZ8Y433SP6+Jq2QLJcejtNUx/z0sgOiLP1HGO7/YMMbfUTl/EP+zbExawQYEQAAAAASUVORK5CYII="

// Favicon PNG bytes (decoded from the data URI above) for the /favicon route
const FAVICON_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABABAMAAABYR2ztAAAAFVBMVEX///8ODg8ODQ4ODg4PDg8PDw8PDxBo6R6vAAACCUlEQVRIx+1UW3KjQAyEMgeICpQD7F4gFEm+l1pyABU1/vcH3P8I2y3N8HA4wH5ELjBmelqtlsZV9RP/ccgvxm9c8nK13vSyRX8F6CwtKSVdxOSK4iZYsyT4ErG3CwWmiv2mZkC8XRCYcrsZURcAQfpkfgHzHTCSO0USCnkGNH3s1tXvSZ+rEGxNXFwXai1V1EOJXqZx6mhRp9Bg9hLCGaPf2+JhS66UMgBPr+sCTWqHcqAmGFpVrISsAAiu3n86oJeoW1GZA26jA1iri+Qj2hMWOcEcDKkwGLtnTkPy2ycBHy4yGDScx7IDdA0AfJLMQG+FCAJqTSVFLjMeo0dSNdCyA0qKu/ubCKDbBMiyixz2IZSasDn6btmoU3xxXwBA9X3kapcyb5NzYqiH98FfKwHerOXPad4hgfZqYdBcZhlX892YOY0q7Cyy6TwpWLIGH6wDACNEO41Hos3+ZqMiAdvFhlPHXNp9KFOSKAdeOBRz+KsHAEYQx0DppUqKbh5F1iMTEGCiezdt0/DlJVIAB1ef2l1Vf5UDCg3RsL3d5eCMtIce8NDzTOapLgwD/JOUCTAcj+6cou6N5xRbkR8v71adATdVP6jqKXSJtx/pvuYyb6yYHuIDcx5SBcNaAM0areV/SvYZ8Y433SP6+Jq2QLJcejtNUx/z0sgOiLP1HGO7/YMMbfUTl/EP+zbExawQYEQAAAAASUVORK5CYII=",
  "base64",
)

// Start local HTTP server for auth callbacks
// This catches http://localhost:{AUTH_SERVER_PORT}/auth/callback?code=xxx and /callback (for MCP OAuth)
const server = createServer((req, res) => {
  const url = new URL(req.url || "", `http://localhost:${AUTH_SERVER_PORT}`)

  // Serve favicon
  if (url.pathname === "/favicon.ico" || url.pathname === "/favicon.svg") {
    res.writeHead(200, { "Content-Type": "image/png" })
    res.end(FAVICON_PNG)
    return
  }

  if (url.pathname === "/auth/callback") {
    const code = url.searchParams.get("code")
    console.log("[Auth Server] Received callback with code:", `${code?.slice(0, 8)}...`)

    if (code) {
      // Handle the auth code
      handleAuthCode(code)

      // Send success response and close the browser tab
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>mausCode - Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 24px;
      height: 24px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    p {
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M14.3333 0C15.2538 0 16 0.746192 16 1.66667V11.8333C16 11.9254 15.9254 12 15.8333 12H10.8333C10.7413 12 10.6667 12.0746 10.6667 12.1667V15.8333C10.6667 15.9254 10.592 16 10.5 16H1.66667C0.746192 16 0 15.2538 0 14.3333V12.1888C0 12.0717 0.0617409 11.9632 0.162081 11.903L6.15043 8.30986C6.28644 8.22833 6.24077 8.02716 6.09507 8.00256L6.06511 8H0.166667C0.0746186 8 0 7.92538 0 7.83333V4.16667C0 4.07462 0.0746193 4 0.166667 4H6.5C6.59205 4 6.66667 3.92538 6.66667 3.83333V0.166667C6.66667 0.0746193 6.74129 0 6.83333 0H14.3333ZM6.83333 4C6.74129 4 6.66667 4.07462 6.66667 4.16667V11.8333C6.66667 11.9254 6.74129 12 6.83333 12H10.5C10.592 12 10.6667 11.9254 10.6667 11.8333V4.16667C10.6667 4.07462 10.592 4 10.5 4H6.83333Z" fill="#0033FF"/>
    </svg>
    <h1>Authentication successful</h1>
    <p>You can close this tab</p>
  </div>
  <script>setTimeout(() => window.close(), 1000)</script>
</body>
</html>`)
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Missing code parameter")
    }
  } else if (url.pathname === "/callback") {
    // Handle MCP OAuth callback
    const code = url.searchParams.get("code")
    const state = url.searchParams.get("state")
    console.log(
      "[Auth Server] Received MCP OAuth callback with code:",
      `${code?.slice(0, 8)}...`,
      "state:",
      `${state?.slice(0, 8)}...`,
    )

    if (code && state) {
      // Handle the MCP OAuth callback
      handleMcpOAuthCallback(code, state)

      // Send success response and close the browser tab
      res.writeHead(200, { "Content-Type": "text/html" })
      res.end(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="icon" type="image/svg+xml" href="${FAVICON_DATA_URI}">
  <title>mausCode - MCP Authentication</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg: #09090b;
      --text: #fafafa;
      --text-muted: #71717a;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --text: #09090b;
        --text-muted: #71717a;
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
    }
    .container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .logo {
      width: 24px;
      height: 24px;
      margin-bottom: 8px;
    }
    h1 {
      font-size: 14px;
      font-weight: 500;
      margin-bottom: 4px;
    }
    p {
      font-size: 12px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <svg class="logo" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill-rule="evenodd" clip-rule="evenodd" d="M14.3333 0C15.2538 0 16 0.746192 16 1.66667V11.8333C16 11.9254 15.9254 12 15.8333 12H10.8333C10.7413 12 10.6667 12.0746 10.6667 12.1667V15.8333C10.6667 15.9254 10.592 16 10.5 16H1.66667C0.746192 16 0 15.2538 0 14.3333V12.1888C0 12.0717 0.0617409 11.9632 0.162081 11.903L6.15043 8.30986C6.28644 8.22833 6.24077 8.02716 6.09507 8.00256L6.06511 8H0.166667C0.0746186 8 0 7.92538 0 7.83333V4.16667C0 4.07462 0.0746193 4 0.166667 4H6.5C6.59205 4 6.66667 3.92538 6.66667 3.83333V0.166667C6.66667 0.0746193 6.74129 0 6.83333 0H14.3333ZM6.83333 4C6.74129 4 6.66667 4.07462 6.66667 4.16667V11.8333C6.66667 11.9254 6.74129 12 6.83333 12H10.5C10.592 12 10.6667 11.9254 10.6667 11.8333V4.16667C10.6667 4.07462 10.592 4 10.5 4H6.83333Z" fill="#0033FF"/>
    </svg>
    <h1>MCP Server authenticated</h1>
    <p>You can close this tab</p>
  </div>
  <script>setTimeout(() => window.close(), 1000)</script>
</body>
</html>`)
    } else {
      res.writeHead(400, { "Content-Type": "text/plain" })
      res.end("Missing code or state parameter")
    }
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" })
    res.end("Not found")
  }
})

server.listen(AUTH_SERVER_PORT, () => {
  console.log(`[Auth Server] Listening on http://localhost:${AUTH_SERVER_PORT}`)
})

// Clean up stale lock files from crashed instances
// Returns true if locks were cleaned, false otherwise
function cleanupStaleLocks(): boolean {
  const userDataPath = app.getPath("userData")
  const lockPath = join(userDataPath, "SingletonLock")

  if (!existsSync(lockPath)) return false

  try {
    // SingletonLock is a symlink like "hostname-pid"
    const lockTarget = readlinkSync(lockPath)
    const match = lockTarget.match(/-(\d+)$/)
    if (match) {
      const pid = parseInt(match[1], 10)
      try {
        // Check if process is running (signal 0 doesn't kill, just checks)
        process.kill(pid, 0)
        // Process exists, lock is valid
        console.log("[App] Lock held by running process:", pid)
        return false
      } catch {
        // Process doesn't exist, clean up stale locks
        console.log("[App] Cleaning stale locks (pid", pid, "not running)")
        const filesToRemove = ["SingletonLock", "SingletonSocket", "SingletonCookie"]
        for (const file of filesToRemove) {
          const filePath = join(userDataPath, file)
          if (existsSync(filePath)) {
            try {
              unlinkSync(filePath)
            } catch (e) {
              console.warn("[App] Failed to remove", file, e)
            }
          }
        }
        return true
      }
    }
  } catch (e) {
    console.warn("[App] Failed to check lock file:", e)
  }
  return false
}

// Prevent multiple instances
let gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  // Maybe stale lock - try cleanup and retry once
  const cleaned = cleanupStaleLocks()
  if (cleaned) {
    gotTheLock = app.requestSingleInstanceLock()
  }
  if (!gotTheLock) {
    app.quit()
  }
}

if (gotTheLock) {
  // Handle second instance launch (also handles deep links on Windows/Linux)
  app.on("second-instance", (_event, commandLine) => {
    // Check for deep link in command line args
    const url = commandLine.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) {
      handleDeepLink(url)
    }

    // Focus on the first available window
    const windows = getAllWindows()
    if (windows.length > 0) {
      const window = windows[0]
      if (window.isMinimized()) window.restore()
      window.focus()
    } else {
      // No windows open, create a new one
      createMainWindow()
    }
  })

  // App ready
  app.whenReady().then(async () => {
    // Set dev mode app name (userData path was already set before requestSingleInstanceLock)
    // if (IS_DEV) {
    //   app.name = "Agents Dev"
    // }

    // Register protocol handler (must be after app is ready)
    initialRegistration = registerProtocol()

    // Handle deep link on macOS (app already running)
    app.on("open-url", (event, url) => {
      console.log("[Protocol] open-url event received:", url)
      event.preventDefault()
      handleDeepLink(url)
    })

    // Set app user model ID for Windows (different in dev to avoid taskbar conflicts)
    if (process.platform === "win32") {
      app.setAppUserModelId(IS_DEV ? "com.maus-inc.mauscode.dev" : "com.maus-inc.mauscode")
    }

    console.log(`[App] Starting mausCode${IS_DEV ? " (DEV)" : ""}...`)

    // Verify protocol registration after app is ready
    // This helps diagnose first-install issues where the protocol isn't recognized yet
    verifyProtocolRegistration()

    // Get Claude Code version for About panel
    let claudeCodeVersion = "unknown"
    try {
      const isDev = !app.isPackaged
      const versionPath = isDev
        ? join(app.getAppPath(), "resources/bin/VERSION")
        : join(process.resourcesPath, "bin/VERSION")

      if (existsSync(versionPath)) {
        const versionContent = readFileSync(versionPath, "utf-8")
        claudeCodeVersion = versionContent.split("\n")[0]?.trim() || "unknown"
      }
    } catch (error) {
      console.warn("[App] Failed to read Claude Code version:", error)
    }

    // Set About panel options with Claude Code version
    app.setAboutPanelOptions({
      applicationName: "mausCode",
      applicationVersion: app.getVersion(),
      version: `Claude Code ${claudeCodeVersion}`,
      copyright: "Copyright © 2026 maus-inc",
    })

    // Track update availability for menu
    let updateAvailable = false
    let availableVersion: string | null = null
    // Track devtools unlock state (hidden feature - 5 clicks on Beta tab)
    let devToolsUnlocked = false

    // Menu icons: PNG template for settings (auto light/dark via "Template" suffix),
    // macOS native SF Symbol for terminal
    const settingsMenuIcon = nativeImage.createFromPath(
      join(__dirname, "../../build/settingsTemplate.png"),
    )
    const terminalMenuIcon =
      process.platform === "darwin"
        ? nativeImage.createFromNamedImage("terminal")?.resize({ width: 12, height: 12 })
        : null

    // Function to build and set application menu
    const buildMenu = () => {
      // Show devtools menu item only in dev mode or when unlocked
      const showDevTools = !app.isPackaged || devToolsUnlocked
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            {
              label: "About mausCode",
              click: () => app.showAboutPanel(),
            },
            {
              label: updateAvailable ? `Update to v${availableVersion}...` : "Check for Updates...",
              click: () => {
                // Send event to renderer to clear dismiss state
                const win = getWindow()
                if (win) {
                  win.webContents.send("update:manual-check")
                }
                // If update is already available, start downloading immediately
                if (updateAvailable) {
                  downloadUpdate()
                } else {
                  checkForUpdates(true)
                }
              },
            },
            { type: "separator" },
            {
              label: "Settings...",
              ...(settingsMenuIcon && { icon: settingsMenuIcon }),
              accelerator: "CmdOrCtrl+,",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.webContents.send("shortcut:open-settings")
                }
              },
            },
            { type: "separator" },
            {
              label: isCliInstalled()
                ? "Uninstall 'mauscode' Command..."
                : "Install 'mauscode' Command in PATH...",
              ...(terminalMenuIcon && { icon: terminalMenuIcon }),
              click: async () => {
                const { dialog } = await import("electron")
                if (isCliInstalled()) {
                  const result = await uninstallCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command uninstalled",
                      detail: "The 'mauscode' command has been removed from your PATH.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Uninstallation Failed", result.error || "Unknown error")
                  }
                } else {
                  const result = await installCli()
                  if (result.success) {
                    dialog.showMessageBox({
                      type: "info",
                      message: "CLI command installed",
                      detail:
                        "You can now use 'mauscode .' in any terminal to open mausCode in that directory.",
                    })
                    buildMenu()
                  } else {
                    dialog.showErrorBox("Installation Failed", result.error || "Unknown error")
                  }
                }
              },
            },
            { type: "separator" },
            { role: "services" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            {
              label: "Quit",
              accelerator: "CmdOrCtrl+Q",
              click: async () => {
                if (
                  hasActiveClaudeSessions() ||
                  hasActiveCodexStreams() ||
                  hasActiveNativeTurns()
                ) {
                  const { dialog } = await import("electron")
                  const { response } = await dialog.showMessageBox({
                    type: "warning",
                    buttons: ["Cancel", "Quit Anyway"],
                    defaultId: 0,
                    cancelId: 0,
                    title: "Active Sessions",
                    message: "There are active agent sessions running.",
                    detail: "Quitting now will interrupt them. Are you sure you want to quit?",
                  })
                  if (response === 1) {
                    abortAllClaudeSessions()
                    abortAllNativeTurns()
                    abortAllCodexStreams()
                    setIsQuitting(true)
                    app.quit()
                  }
                } else {
                  app.quit()
                }
              },
            },
          ],
        },
        {
          label: "File",
          submenu: [
            {
              label: "New Chat",
              accelerator: "CmdOrCtrl+N",
              click: () => {
                console.log("[Menu] New Chat clicked (Cmd+N)")
                const win = getWindow()
                if (win) {
                  console.log("[Menu] Sending shortcut:new-agent to renderer")
                  win.webContents.send("shortcut:new-agent")
                } else {
                  console.log("[Menu] No window found!")
                }
              },
            },
            {
              label: "New Window",
              accelerator: "CmdOrCtrl+Shift+N",
              click: () => {
                console.log("[Menu] New Window clicked (Cmd+Shift+N)")
                createWindow()
              },
            },
            { type: "separator" },
            {
              // No accelerator: Cmd+W belongs to the renderer's close-tab
              // shortcut, which the settings keyboard table advertises. The
              // menu item stays clickable and Cmd+Q still quits.
              label: "Close Window",
              click: () => {
                const win = getWindow()
                if (win) {
                  win.close()
                }
              },
            },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            // Cmd+R is disabled to prevent accidental page refresh
            // Cmd+Shift+R reloads but warns if there are active streams
            {
              label: "Force Reload",
              accelerator: "CmdOrCtrl+Shift+R",
              click: () => {
                const win = BrowserWindow.getFocusedWindow()
                if (!win) return
                if (
                  hasActiveClaudeSessions() ||
                  hasActiveCodexStreams() ||
                  hasActiveNativeTurns()
                ) {
                  dialog
                    .showMessageBox(win, {
                      type: "warning",
                      buttons: ["Cancel", "Reload Anyway"],
                      defaultId: 0,
                      cancelId: 0,
                      title: "Active Sessions",
                      message: "There are active agent sessions running.",
                      detail:
                        "Reloading will interrupt them. The current progress will be saved. Are you sure you want to reload?",
                    })
                    .then(({ response }) => {
                      if (response === 1) {
                        abortAllClaudeSessions()
                        abortAllNativeTurns()
                        abortAllCodexStreams()
                        win.webContents.reloadIgnoringCache()
                      }
                    })
                } else {
                  win.webContents.reloadIgnoringCache()
                }
              },
            },
            // Only show DevTools in dev mode or when unlocked via hidden feature
            ...(showDevTools ? [{ role: "toggleDevTools" as const }] : []),
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [
            { role: "minimize" },
            { role: "zoom" },
            { type: "separator" },
            { role: "front" },
          ],
        },
        {
          role: "help",
          submenu: [
            {
              label: "Learn More",
              click: async () => {
                const { shell } = await import("electron")
                await shell.openExternal("https://github.com/maus-inc/mausCode")
              },
            },
          ],
        },
      ]
      Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }

    // macOS: Set dock menu (right-click on dock icon)
    if (process.platform === "darwin") {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: "New Window",
          click: () => {
            console.log("[Dock] New Window clicked")
            createWindow()
          },
        },
      ])
      app.dock?.setMenu(dockMenu) // Transplanted from erenbertr/1code (Apache-2.0): dock is macOS-only
    }

    // Set update state and rebuild menu
    const setUpdateAvailable = (available: boolean, version?: string) => {
      updateAvailable = available
      availableVersion = version || null
      buildMenu()
    }

    // Unlock devtools and rebuild menu (called from renderer via IPC)
    const unlockDevTools = () => {
      if (!devToolsUnlocked) {
        devToolsUnlocked = true
        console.log("[App] DevTools unlocked via hidden feature")
        buildMenu()
      }
    }

    // Expose setUpdateAvailable globally for auto-updater
    global.__setUpdateAvailable = setUpdateAvailable
    // Expose unlockDevTools globally for IPC handler
    global.__unlockDevTools = unlockDevTools

    // Build initial menu
    buildMenu()

    // Initialize auth manager (uses singleton from auth-manager module)
    authManager = initAuthManager(!!process.env.ELECTRON_RENDERER_URL)
    console.log("[App] Auth manager initialized")

    // Initialize analytics after auth manager so we can identify user
    initAnalytics()

    // If user already authenticated from previous session, identify them
    if (authManager.isAuthenticated()) {
      const user = authManager.getUser()
      if (user) {
        identify(user.id, { email: user.email })
        console.log("[Analytics] User identified from saved session:", user.id)
      }
    }

    // Track app opened (now with correct user ID if authenticated)
    trackAppOpened()

    // Set up callback to update cookie when token is refreshed
    authManager.setOnTokenRefresh(async (authData) => {
      // The callback runs once the store accepted the refreshed token, and a
      // sign-out can still land while the cookie is written, so this path takes
      // the same settle-against-the-store step as the other two.
      const written = await writeDesktopTokenCookie(authManager, authData.token, authData.expiresAt)
      if (written) console.log("[Auth] Token refreshed, cookie updated")
    })

    // A session cookie from the previous run is gone, so issue this run's
    // cookie from the saved session as the app starts. When the saved token is
    // already near expiry this refreshes it and the callback above writes the
    // new value.
    restoreDesktopTokenCookie(authManager)

    // Initialize database
    try {
      initDatabase()
      console.log("[App] Database initialized")
      // Runs left active by a crash or force-quit have no live owner at this
      // point; move them to interrupted with the last event as evidence.
      recoverInterruptedRuns()
      // Queued items claimed by a window that did not survive a restart go
      // back to the queue.
      recoverQueuedSends()
    } catch (error) {
      console.error("[App] Failed to initialize database:", error)
    }

    // Create main window
    createMainWindow()

    // Initialize auto-updater (production only)
    if (app.isPackaged) {
      await initAutoUpdater(getAllWindows)
      // Setup update check on window focus (instead of periodic interval)
      setupFocusUpdateCheck(getAllWindows)
      // Check for updates 5 seconds after startup (force to bypass interval check)
      setTimeout(() => {
        checkForUpdates(true)
      }, 5000)
    }

    // Warm up MCP cache 3 seconds after startup (background, non-blocking)
    // This populates the cache so all future sessions can use filtered MCP servers
    setTimeout(async () => {
      try {
        const results = await Promise.allSettled([
          getAllMcpConfigHandler(),
          getAllCodexMcpConfigHandler(),
        ])

        if (results[0].status === "rejected") {
          console.error("[App] Claude MCP warmup failed:", results[0].reason)
        }
        if (results[1].status === "rejected") {
          console.error("[App] Codex MCP warmup failed:", results[1].reason)
        }
      } catch (error) {
        console.error("[App] MCP warmup failed:", error)
      }
    }, 3000)

    // Handle directory argument from CLI (e.g., `mauscode /path/to/project`)
    parseLaunchDirectory()

    // Handle deep link from app launch (Windows/Linux)
    const deepLinkUrl = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl)
    }

    // macOS: Re-create window when dock icon is clicked
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow()
      }
    })
  })

  // Quit when all windows are closed (except on macOS)
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Cleanup before quit
  app.on("before-quit", async () => {
    console.log("[App] Shutting down...")
    cancelAllPendingOAuth()
    abortAllNativeTurns()
    await shutdownRuntime().catch(() => {})
    await cleanupGitWatchers()
    await shutdownAnalytics()
    await closeDatabase()
  })

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("[App] Uncaught exception:", error)
  })

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[App] Unhandled rejection at:", promise, "reason:", reason)
  })
}
