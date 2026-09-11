/**
 * NOTE (transplant): dev-server terminal pane constants.
 * Source: sylvaindiv/1code (Apache-2.0). UI strings translated FR->EN on port.
 */
export const DEV_SERVER_TERMINAL_ID = "dev-server"
export const DEV_SERVER_TERMINAL_NAME = "Dev Server"

export function getDevServerPaneId(scopeKey: string): string {
  return `${scopeKey}:term:${DEV_SERVER_TERMINAL_ID}`
}
