/**
 * mausCode product identity — single source of truth for identity constants
 * shared by the main process and the renderer.
 *
 * Display name is always "mausCode" (capital C). Lowercase "mauscode"
 * appears only in technical identifiers (commands, schemes, directory names).
 */

export const APP_NAME = "mausCode"
export const APP_VENDOR = "maus-inc"
export const DEFAULT_API_BASE_URL = ""
export const DEFAULT_UPDATE_FEED_URL = ""
export const CLI_COMMAND = "mauscode"
export const APP_DATA_DIRNAME = ".mauscode"
export const WORKTREE_CONFIG_PATH = ".mauscode/worktree.json"
export const LEGACY_WORKTREE_CONFIG_PATH = ".1code/worktree.json"
export const LEGACY_APP_DATA_DIRNAME = ".21st"
export const REPO_URL = "https://github.com/maus-inc/mausCode"
export const RELEASES_URL = `${REPO_URL}/releases`
