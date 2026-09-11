/**
 * mausCode product identity — single source of truth for identity constants
 * shared by the main process and the renderer.
 *
 * Naming system: .dump/rebrand/decisions/naming-system.md
 *
 * Display name is always "mausCode" (capital C). Lowercase "mauscode"
 * appears only in technical identifiers (commands, schemes, directory names).
 */

/** Product display name. Use exactly this in user-facing text. */
export const APP_NAME = "mausCode"

/** Company name (legal / copyright / package metadata contexts). */
export const APP_VENDOR = "maus-inc"

/**
 * API base URL of the mausCode control plane.
 *
 * Empty by default: the app runs in local-only mode (no sign-in, no hosted
 * changelog, no auto-updates) and is fully functional for local agent work.
 * Override with MAIN_VITE_API_URL at build time once the control plane exists.
 * Never hardcode a host here — the public domain is a maus-inc decision.
 */
export const DEFAULT_API_BASE_URL = ""

/**
 * Update feed URL for electron-updater.
 *
 * Empty by default: auto-update is disabled. Override with
 * MAIN_VITE_UPDATE_FEED_URL at build time once mausCode has its own CDN.
 * (The inherited 21st.dev CDN was removed — it serves 1Code's release
 * manifests and must never be an update source for mausCode.)
 */
export const DEFAULT_UPDATE_FEED_URL = ""

/** Terminal launcher command (technical identifier — lowercase). */
export const CLI_COMMAND = "mauscode"

/** Home-relative directory for mausCode data (worktrees, cloned repos). */
export const APP_DATA_DIRNAME = ".mauscode"

/** Project-local worktree setup config (current format). */
export const WORKTREE_CONFIG_PATH = ".mauscode/worktree.json"

/** Legacy 1Code worktree config — detected only, never written. */
export const LEGACY_WORKTREE_CONFIG_PATH = ".1code/worktree.json"

/** Legacy 1Code home data directory — detected only, never written. */
export const LEGACY_APP_DATA_DIRNAME = ".21st"

/** GitHub repository (homepage + changelog target until a hosted one exists). */
export const REPO_URL = "https://github.com/maus-inc/mausCode"

/** Releases page used as the changelog target for now. */
export const RELEASES_URL = `${REPO_URL}/releases`
