// Dev mode detection
export const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

// Auth server port - use different port in dev to allow running alongside production
export const AUTH_SERVER_PORT = IS_DEV ? 21322 : 21321

// Deep link protocol (must match package.json build.protocols.schemes in prod).
// A separate protocol in dev avoids conflicts with the production app.
// Single source of truth — was previously duplicated in index.ts and the debug router.
export const PROTOCOL = IS_DEV ? "mauscode-dev" : "mauscode"

// Dev mode userData folder (keeps dev data isolated from production installs)
export const DEV_USER_DATA_NAME = "mausCode Dev"
