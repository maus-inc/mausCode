/**
 * Platform detection utilities for Agents Desktop
 *
 * Detects whether the app is running in Electron desktop app
 * and provides platform detection helpers
 */

/**
 * Check if running inside Electron desktop app
 */
export function isDesktopApp(): boolean {
  if (typeof window === "undefined") return false
  return !!window.desktopApi
}

/**
 * Get the current platform
 */
export function getPlatform(): "darwin" | "win32" | "linux" | "unknown" {
  if (typeof window !== "undefined" && window.desktopApi?.platform) {
    return window.desktopApi.platform as "darwin" | "win32" | "linux"
  }
  return "unknown"
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  return getPlatform() === "darwin"
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return getPlatform() === "win32"
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return getPlatform() === "linux"
}
