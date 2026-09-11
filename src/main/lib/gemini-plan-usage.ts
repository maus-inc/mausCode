/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/ci/research/fork-network-harvest-catalog.md.
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"

const QUOTA_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota"
const LOAD_CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
const PROJECTS_ENDPOINT = "https://cloudresourcemanager.googleapis.com/v1/projects"
const TOKEN_REFRESH_ENDPOINT = "https://oauth2.googleapis.com/token"
const CREDENTIALS_RELATIVE_PATH = ".gemini/oauth_creds.json"
const SETTINGS_RELATIVE_PATH = ".gemini/settings.json"
const REQUEST_TIMEOUT_MS = 10_000

export type GeminiRateWindow = {
  utilization: number | null
  resetsAt: string | null
  windowMinutes: number | null
}

export type GeminiPlanUsage = {
  primary: GeminiRateWindow | null
  secondary: GeminiRateWindow | null
  tertiary: GeminiRateWindow | null
  accountEmail: string | null
  accountPlan: string | null
}

export type GeminiPlanFetchResult =
  | { ok: true; usage: GeminiPlanUsage }
  | {
      ok: false
      reason: "not_logged_in" | "unsupported_auth" | "error"
      message?: string
    }

type StoredCreds = {
  accessToken: string | null
  idToken: string | null
  refreshToken: string | null
  expiryDate: Date | null
}

type OAuthClientCreds = {
  clientId: string
  clientSecret: string
}

type CodeAssistStatus = {
  tier: "free-tier" | "legacy-tier" | "standard-tier" | null
  projectId: string | null
}

type QuotaBucket = {
  remainingFraction?: number
  resetTime?: string
  modelId?: string
  tokenType?: string
}

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function readFileSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function readCredentialsFile(home: string): StoredCreds | null {
  const credsPath = join(home, CREDENTIALS_RELATIVE_PATH)
  const raw = readFileSafe(credsPath)
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const o = parsed as Record<string, unknown>

  const accessToken = typeof o.access_token === "string" ? o.access_token : null
  const idToken = typeof o.id_token === "string" ? o.id_token : null
  const refreshToken = typeof o.refresh_token === "string" ? o.refresh_token : null
  let expiryDate: Date | null = null
  if (typeof o.expiry_date === "number" && Number.isFinite(o.expiry_date)) {
    expiryDate = new Date(o.expiry_date)
  }
  return { accessToken, idToken, refreshToken, expiryDate }
}

function readAuthTypeFromSettings(home: string): string | null {
  const raw = readFileSafe(join(home, SETTINGS_RELATIVE_PATH))
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  if (typeof parsed !== "object" || parsed === null) return null
  const security = (parsed as Record<string, unknown>).security
  if (typeof security !== "object" || security === null) return null
  const auth = (security as Record<string, unknown>).auth
  if (typeof auth !== "object" || auth === null) return null
  const selectedType = (auth as Record<string, unknown>).selectedType
  return typeof selectedType === "string" ? selectedType : null
}

function locateGeminiBinary(): string | null {
  try {
    const out = execFileSync("which", ["gemini"], {
      encoding: "utf8",
      timeout: 2000,
    })
    const trimmed = out.split("\n")[0]?.trim() ?? ""
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

function resolveSymlink(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

function tryParseOAuthCreds(content: string): OAuthClientCreds | null {
  const idMatch = content.match(/OAUTH_CLIENT_ID\s*=\s*['"]([\w\-.]+)['"]/)
  const secretMatch = content.match(/OAUTH_CLIENT_SECRET\s*=\s*['"]([\w-]+)['"]/)
  if (!idMatch || !secretMatch) return null
  return { clientId: idMatch[1], clientSecret: secretMatch[1] }
}

function findGeminiPackageRoot(startPath: string): string | null {
  let current: string
  try {
    const stat = statSync(startPath)
    current = stat.isDirectory() ? startPath : dirname(startPath)
  } catch {
    current = dirname(startPath)
  }

  for (let i = 0; i <= 8; i += 1) {
    const pkgPath = join(current, "package.json")
    const raw = readFileSafe(pkgPath)
    if (raw) {
      try {
        const pkg = JSON.parse(raw) as { name?: string }
        if (pkg.name === "@google/gemini-cli") return current
      } catch {
        // ignore
      }
    }

    const globalPkgPath = join(
      current,
      "lib",
      "node_modules",
      "@google",
      "gemini-cli",
      "package.json",
    )
    const globalRaw = readFileSafe(globalPkgPath)
    if (globalRaw) {
      try {
        const pkg = JSON.parse(globalRaw) as { name?: string }
        if (pkg.name === "@google/gemini-cli") {
          return dirname(globalPkgPath)
        }
      } catch {
        // ignore
      }
    }

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
  return null
}

function extractOAuthCredsFromPackageRoot(packageRoot: string): OAuthClientCreds | null {
  const oauthRel = "dist/src/code_assist/oauth2.js"
  const candidates = [
    join(packageRoot, oauthRel),
    join(packageRoot, "node_modules", "@google", "gemini-cli-core", oauthRel),
  ]
  for (const candidate of candidates) {
    const content = readFileSafe(candidate)
    if (content) {
      const parsed = tryParseOAuthCreds(content)
      if (parsed) return parsed
    }
  }
  return null
}

function extractOAuthCredsFromLegacyPaths(realBinaryPath: string): OAuthClientCreds | null {
  const binDir = dirname(realBinaryPath)
  const baseDir = dirname(binDir)
  const oauthRel = "dist/src/code_assist/oauth2.js"
  const nestedRel =
    "node_modules/@google/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"
  const nixRel =
    "share/gemini-cli/node_modules/@google/gemini-cli-core/dist/src/code_assist/oauth2.js"

  const candidates = [
    join(baseDir, "libexec/lib", nestedRel),
    join(baseDir, "lib", nestedRel),
    join(baseDir, nixRel),
    resolve(baseDir, "..", "gemini-cli-core", oauthRel),
    join(baseDir, "node_modules/@google/gemini-cli-core", oauthRel),
  ]
  for (const candidate of candidates) {
    const content = readFileSafe(candidate)
    if (content) {
      const parsed = tryParseOAuthCreds(content)
      if (parsed) return parsed
    }
  }
  return null
}

function extractOAuthClientCreds(): OAuthClientCreds | null {
  const binary = locateGeminiBinary()
  if (!binary) return null
  const real = resolveSymlink(binary)

  const fromLegacy = extractOAuthCredsFromLegacyPaths(real)
  if (fromLegacy) return fromLegacy

  const root = findGeminiPackageRoot(real)
  if (root) {
    const fromRoot = extractOAuthCredsFromPackageRoot(root)
    if (fromRoot) return fromRoot
  }
  return null
}

function decodeJwtClaims(idToken: string | null): {
  email: string | null
  hostedDomain: string | null
} {
  if (!idToken) return { email: null, hostedDomain: null }
  const parts = idToken.split(".")
  if (parts.length < 2) return { email: null, hostedDomain: null }

  let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/")
  const remainder = payload.length % 4
  if (remainder > 0) payload += "=".repeat(4 - remainder)

  let json: unknown
  try {
    const buf = Buffer.from(payload, "base64")
    json = JSON.parse(buf.toString("utf8"))
  } catch {
    return { email: null, hostedDomain: null }
  }
  if (typeof json !== "object" || json === null) {
    return { email: null, hostedDomain: null }
  }
  const o = json as Record<string, unknown>
  return {
    email: typeof o.email === "string" ? o.email : null,
    hostedDomain: typeof o.hd === "string" ? o.hd : null,
  }
}

async function refreshAccessToken(refreshToken: string, home: string): Promise<string> {
  const clientCreds = extractOAuthClientCreds()
  if (!clientCreds) {
    throw new Error("Could not find Gemini CLI OAuth client credentials")
  }
  const body = new URLSearchParams({
    client_id: clientCreds.clientId,
    client_secret: clientCreds.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  })
  const response = await fetchWithTimeout(TOKEN_REFRESH_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  })
  if (!response.ok) {
    throw new Error(`Token refresh HTTP ${response.status}`)
  }
  const json = (await response.json()) as Record<string, unknown>
  const newAccess = json.access_token
  if (typeof newAccess !== "string") {
    throw new Error("Refresh response missing access_token")
  }
  await persistRefreshedCreds(json, home)
  return newAccess
}

async function persistRefreshedCreds(
  refreshResponse: Record<string, unknown>,
  home: string,
): Promise<void> {
  const credsPath = join(home, CREDENTIALS_RELATIVE_PATH)
  let existing: Record<string, unknown>
  try {
    const raw = await readFile(credsPath, "utf8")
    const parsed = JSON.parse(raw)
    if (typeof parsed !== "object" || parsed === null) return
    existing = parsed as Record<string, unknown>
  } catch {
    return
  }

  const next = { ...existing }
  if (typeof refreshResponse.access_token === "string") {
    next.access_token = refreshResponse.access_token
  }
  if (
    typeof refreshResponse.expires_in === "number" &&
    Number.isFinite(refreshResponse.expires_in)
  ) {
    next.expiry_date = (Date.now() / 1000 + refreshResponse.expires_in) * 1000
  }
  if (typeof refreshResponse.id_token === "string") {
    next.id_token = refreshResponse.id_token
  }
  try {
    await writeFile(credsPath, JSON.stringify(next, null, 2), "utf8")
  } catch {
    // best effort
  }
}

async function loadCodeAssistStatus(accessToken: string): Promise<CodeAssistStatus> {
  let response: Response
  try {
    response = await fetchWithTimeout(LOAD_CODE_ASSIST_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" },
      }),
    })
  } catch {
    return { tier: null, projectId: null }
  }

  if (!response.ok) return { tier: null, projectId: null }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return { tier: null, projectId: null }
  }
  if (typeof json !== "object" || json === null) {
    return { tier: null, projectId: null }
  }
  const o = json as Record<string, unknown>

  let projectId: string | null = null
  const proj = o.cloudaicompanionProject
  if (typeof proj === "string") {
    projectId = proj.trim().length > 0 ? proj.trim() : null
  } else if (typeof proj === "object" && proj !== null) {
    const p = proj as Record<string, unknown>
    if (typeof p.id === "string" && p.id.trim().length > 0) {
      projectId = p.id.trim()
    } else if (typeof p.projectId === "string" && p.projectId.trim().length > 0) {
      projectId = p.projectId.trim()
    }
  }

  let tier: CodeAssistStatus["tier"] = null
  const currentTier = o.currentTier
  if (typeof currentTier === "object" && currentTier !== null) {
    const tierId = (currentTier as Record<string, unknown>).id
    if (tierId === "free-tier" || tierId === "legacy-tier" || tierId === "standard-tier") {
      tier = tierId
    }
  }

  return { tier, projectId }
}

async function discoverGeminiProjectId(accessToken: string): Promise<string | null> {
  let response: Response
  try {
    response = await fetchWithTimeout(PROJECTS_ENDPOINT, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let json: unknown
  try {
    json = await response.json()
  } catch {
    return null
  }
  if (typeof json !== "object" || json === null) return null
  const projects = (json as Record<string, unknown>).projects
  if (!Array.isArray(projects)) return null

  for (const proj of projects) {
    if (typeof proj !== "object" || proj === null) continue
    const p = proj as Record<string, unknown>
    const projectId = typeof p.projectId === "string" ? p.projectId : null
    if (!projectId) continue
    if (projectId.startsWith("gen-lang-client")) return projectId
    const labels = p.labels
    if (
      typeof labels === "object" &&
      labels !== null &&
      typeof (labels as Record<string, unknown>)["generative-language"] === "string"
    ) {
      return projectId
    }
  }
  return null
}

function classifyModel(modelId: string): "pro" | "flash" | "flash-lite" | null {
  const lower = modelId.toLowerCase()
  if (lower.includes("flash-lite")) return "flash-lite"
  if (lower.includes("flash")) return "flash"
  if (lower.includes("pro")) return "pro"
  return null
}

function bucketsToWindow(
  buckets: { fraction: number; resetTime: string | null }[],
): GeminiRateWindow | null {
  if (buckets.length === 0) return null
  let lowest = buckets[0]
  for (const b of buckets) {
    if (b.fraction < lowest.fraction) lowest = b
  }
  return {
    utilization: Math.max(0, Math.min(100, (1 - lowest.fraction) * 100)),
    resetsAt: lowest.resetTime,
    windowMinutes: 1440,
  }
}

async function callRetrieveUserQuota(
  accessToken: string,
  projectId: string | null,
): Promise<QuotaBucket[]> {
  const body = projectId ? JSON.stringify({ project: projectId }) : "{}"
  const response = await fetchWithTimeout(QUOTA_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body,
  })
  if (response.status === 401) {
    throw new Error("not_logged_in")
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  const json = (await response.json()) as Record<string, unknown>
  const buckets = json.buckets
  if (!Array.isArray(buckets)) return []
  return buckets.filter((b): b is QuotaBucket => typeof b === "object" && b !== null)
}

function tierToPlan(tier: CodeAssistStatus["tier"], hostedDomain: string | null): string | null {
  if (tier === "standard-tier") return "Paid"
  if (tier === "free-tier" && hostedDomain) return "Workspace"
  if (tier === "free-tier") return "Free"
  if (tier === "legacy-tier") return "Legacy"
  return null
}

export async function fetchGeminiPlanUsage(
  options: { homeDirectory?: string } = {},
): Promise<GeminiPlanFetchResult> {
  const home = options.homeDirectory ?? homedir()

  const authType = readAuthTypeFromSettings(home)
  if (authType === "api-key") {
    return { ok: false, reason: "unsupported_auth", message: "API key auth" }
  }
  if (authType === "vertex-ai") {
    return { ok: false, reason: "unsupported_auth", message: "Vertex AI auth" }
  }

  const creds = readCredentialsFile(home)
  if (!creds || !creds.accessToken) {
    return { ok: false, reason: "not_logged_in" }
  }

  let accessToken = creds.accessToken
  if (creds.expiryDate && creds.expiryDate < new Date()) {
    if (!creds.refreshToken) {
      return { ok: false, reason: "not_logged_in" }
    }
    try {
      accessToken = await refreshAccessToken(creds.refreshToken, home)
    } catch (error) {
      return {
        ok: false,
        reason: "error",
        message: error instanceof Error ? error.message : "refresh failed",
      }
    }
  }

  const claims = decodeJwtClaims(creds.idToken)
  const status = await loadCodeAssistStatus(accessToken)

  let projectId = status.projectId
  if (!projectId) {
    projectId = await discoverGeminiProjectId(accessToken)
  }

  let buckets: QuotaBucket[]
  try {
    buckets = await callRetrieveUserQuota(accessToken, projectId)
  } catch (error) {
    if (error instanceof Error && error.message === "not_logged_in") {
      return { ok: false, reason: "not_logged_in" }
    }
    return {
      ok: false,
      reason: "error",
      message: error instanceof Error ? error.message : "quota fetch failed",
    }
  }

  const groups: Record<
    "pro" | "flash" | "flash-lite",
    { fraction: number; resetTime: string | null }[]
  > = {
    pro: [],
    flash: [],
    "flash-lite": [],
  }

  for (const bucket of buckets) {
    if (typeof bucket.modelId !== "string" || typeof bucket.remainingFraction !== "number") {
      continue
    }
    const tier = classifyModel(bucket.modelId)
    if (!tier) continue
    const reset =
      typeof bucket.resetTime === "string" && bucket.resetTime.length > 0 ? bucket.resetTime : null
    groups[tier].push({ fraction: bucket.remainingFraction, resetTime: reset })
  }

  const usage: GeminiPlanUsage = {
    primary: bucketsToWindow(groups.pro),
    secondary: bucketsToWindow(groups.flash),
    tertiary: bucketsToWindow(groups["flash-lite"]),
    accountEmail: claims.email,
    accountPlan: tierToPlan(status.tier, claims.hostedDomain),
  }

  return { ok: true, usage }
}

export function isGeminiOAuthCredsAvailable(): boolean {
  return existsSync(join(homedir(), CREDENTIALS_RELATIVE_PATH))
}
