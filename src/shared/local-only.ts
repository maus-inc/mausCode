/**
 * Local-only mode: pure helpers shared by main and renderer.
 *
 * Local-only is a product-hosted-services guard, NOT an air-gap mode. It
 * blocks mausCode/1Code hosted clouds and remote sandbox infrastructure
 * while leaving user-owned endpoints (AI provider APIs, Anthropic
 * credentials, local Ollama, git remotes) untouched. Fully offline use
 * should run through Ollama.
 */
export const LOCAL_ONLY_BLOCKED_MESSAGE = "Local-only mode blocks hosted upstream services"

const BLOCKED_ROOTS = [
  // mausCode/1Code hosted app services.
  "21st.dev",
  "1code.dev",
  "21st.sh",
  // Remote sandbox infrastructure.
  "e2b.app",
  "csb.app",
  "codesandbox.io",
]

export function isOfficialCloudHostname(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return BLOCKED_ROOTS.some((root) => host === root || host.endsWith(`.${root}`))
}

export function isOfficialCloudUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false
    }
    return isOfficialCloudHostname(parsed.hostname)
  } catch {
    return false
  }
}
