/**
 * Shared configuration for the desktop app.
 *
 * Control plane: mausCode's hosted backend (sign-in, changelog, hosted voice,
 * sandbox mode) does not have a public URL yet. The app runs in local-only
 * mode when the base URL is empty — all local agent features work without it.
 * Set MAIN_VITE_API_URL at build time to point at the control plane once it
 * ships. See .dump/rebrand/decisions/open-decisions.md (D4).
 */
import { DEFAULT_API_BASE_URL } from "../../shared/app-identity"

const IS_DEV = !!process.env.ELECTRON_RENDERER_URL

/**
 * Get the control-plane API base URL.
 * MAIN_VITE_API_URL is a build-time variable (inlined by electron-vite), so
 * the same code path serves dev and packaged builds — no runtime env leaking.
 * Empty string = local-only mode (no control plane configured).
 */
export function getApiUrl(): string {
  return import.meta.env.MAIN_VITE_API_URL || DEFAULT_API_BASE_URL
}

/** True when a control plane is configured (sign-in/hosted features available). */
export function isControlPlaneConfigured(): boolean {
  return getApiUrl().length > 0
}

/**
 * Check if running in development mode
 */
export function isDev(): boolean {
  return IS_DEV
}
