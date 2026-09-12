/**
 * Themes module exports
 *
 * This module provides full VS Code theme support for the application.
 */

// Builtin themes
export {
  BUILTIN_THEMES,
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getBuiltinThemeById,
  getBuiltinThemesByType,
} from "./builtin-themes"
// Cursor themes (with full tokenColors)
export { CURSOR_DARK, CURSOR_LIGHT, CURSOR_MIDNIGHT } from "./cursor-themes"
// Shiki theme loader
export {
  ensureThemeLoaded,
  getHighlighter,
  getLoadedThemes,
  highlightCode,
  loadFullTheme,
} from "./shiki-theme-loader"
// Terminal theme mapping
export { extractTerminalTheme, hasTerminalColors } from "./terminal-theme-mapper"
// Theme provider
export {
  useShikiTheme,
  useTerminalTheme,
  useVSCodeTheme,
  VSCodeThemeProvider,
} from "./theme-provider"
// CSS variable mapping
export {
  applyCSSVariables,
  generateCSSVariables,
  getThemeTypeFromColors,
  hexToHSL,
  isLightColor,
  removeCSSVariables,
} from "./vscode-to-css-mapping"
