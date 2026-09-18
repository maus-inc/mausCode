/**
 * NOTE (transplant): reasoning-effort model parsing (`model/effort` selection,
 * `buildCodexProviderArgs`, session fingerprinting), and text-delta chunk
 * coalescing in the stream loop were
 * transplanted from erenbertr/1code (Apache-2.0, © the 1Code contributors).
 *
 * Chat sessions spawn `codex app-server` (native JSON-RPC) via the ported T3
 * Effect client in `../../codex-app-server/session`. The legacy codex-acp
 * (Zed ACP adapter) path was removed in the app-server migration.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { app } from "electron"
import { z } from "zod"
import { agentModeSchema, DEFAULT_AGENT_MODE } from "../../../../shared/agent-mode"
import {
  CODEX_MODELS,
  CODEX_SUBSCRIPTION_ONLY_MODEL_IDS,
  DEFAULT_CODEX_UI_MODEL,
  isCodexReasoningEffort,
} from "../../../../shared/codex-model-id"
import { normalizeCodexAssistantMessage } from "../../../../shared/codex-tool-normalizer"
import { createChunkCoalescer } from "../../claude"
import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveProjectPathFromWorktree } from "../../claude-config"
import { resolveCliBinaryPath } from "../../cli-binaries"
import {
  type CodexAppServerSession,
  type CodexSessionChunk,
  type CodexTurnInput,
  createCodexAppServerSession,
} from "../../codex-app-server/session"
import { getDatabase, projects as projectsTable, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { fetchMcpTools, fetchMcpToolsStdio, type McpToolInfo } from "../../mcp-auth"
import {
  clearCodexDefaultModelCache,
  type KnownCodexModel,
  peekCodexDefaultModel,
  type ResolvedCodexDefault,
  resolveCodexDefaultModel,
} from "../../providers/codex-models"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type CodexProviderSession = {
  session: CodexAppServerSession
  cwd: string
  authFingerprint: string | null
  mcpFingerprint: string
  reasoningEffort: string | null
}

type CodexLoginSessionState = "running" | "success" | "error" | "cancelled"

type CodexLoginSession = {
  id: string
  process: ChildProcess | null
  state: CodexLoginSessionState
  output: string
  url: string | null
  error: string | null
  exitCode: number | null
}

type CodexIntegrationState = "connected_chatgpt" | "connected_api_key" | "not_logged_in" | "unknown"

type CodexMcpServerForSession =
  | {
      name: string
      type: "stdio"
      command: string
      args: string[]
      env: Array<{ name: string; value: string }>
    }
  | {
      name: string
      type: "http"
      url: string
      headers: Array<{ name: string; value: string }>
    }

type CodexMcpServerForSettings = {
  name: string
  status: "connected" | "failed" | "pending" | "needs-auth"
  tools: McpToolInfo[]
  needsAuth: boolean
  config: Record<string, unknown>
  serverInfo?: { name: string; version: string; icons?: Array<{ src: string }> }
  error?: string
}

type CodexMcpSnapshot = {
  mcpServersForSession: CodexMcpServerForSession[]
  groups: Array<{
    groupName: string
    projectPath: string | null
    mcpServers: CodexMcpServerForSettings[]
  }>
  fingerprint: string
  fetchedAt: number
  toolsResolved: boolean
}

const providerSessions = new Map<string, CodexProviderSession>()
type ActiveCodexStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveCodexStream>()

/** Check if there are any active Codex streaming sessions */
export function hasActiveCodexStreams(): boolean {
  return activeStreams.size > 0
}

/** Abort all active Codex streams so their cleanup saves partial state */
export function abortAllCodexStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[codex] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}
const loginSessions = new Map<string, CodexLoginSession>()
const codexMcpCache = new Map<string, CodexMcpSnapshot>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape parsing.
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape parsing.
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

const AUTH_HINTS = [
  "not logged in",
  "authentication required",
  "auth required",
  "login required",
  "missing credentials",
  "no credentials",
  "unauthorized",
  "forbidden",
  "codex login",
  "401",
  "403",
]
const CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS = 40_000
const CODEX_USAGE_POLL_ATTEMPTS = 3
const CODEX_USAGE_POLL_INTERVAL_MS = 200

type CodexTokenUsage = {
  input_tokens?: number
  cached_input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

type CodexTokenCountInfo = {
  last_token_usage?: CodexTokenUsage
  model_context_window?: number
}

type CodexUsageMetadata = {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  modelContextWindow?: number
}

const codexMcpListEntrySchema = z
  .object({
    name: z.string(),
    enabled: z.boolean(),
    disabled_reason: z.string().nullable().optional(),
    transport: z
      .object({
        type: z.string(),
        command: z.string().nullable().optional(),
        args: z.array(z.string()).nullable().optional(),
        env: z.record(z.string()).nullable().optional(),
        env_vars: z.array(z.string()).nullable().optional(),
        cwd: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        bearer_token_env_var: z.string().nullable().optional(),
        http_headers: z.record(z.string()).nullable().optional(),
        env_http_headers: z.record(z.string()).nullable().optional(),
      })
      .passthrough(),
    auth_status: z.string().nullable().optional(),
  })
  .passthrough()

type CodexMcpListEntry = z.infer<typeof codexMcpListEntrySchema>

function resolveBundledCodexCliPath(): string {
  const binaryName = process.platform === "win32" ? "codex.exe" : "codex"
  const resourcesDir = app.isPackaged
    ? join(process.resourcesPath, "bin")
    : join(app.getAppPath(), "resources", "bin", `${process.platform}-${process.arch}`)

  const binaryPath = join(resourcesDir, binaryName)

  // NOTE (transplant): PATH fallback via resolveCliBinaryPath from
  // SamSammane/1code-ui (Apache-2.0) — dev boxes and global installs work
  // without a bundled binary.
  const downloadHint = app.isPackaged
    ? "Binary is missing from bundled resources."
    : "Run `bun run codex:download` or install Codex CLI globally."

  const resolved = resolveCliBinaryPath({
    bundledPath: binaryPath,
    commandName: "codex",
    downloadHint,
  })
  if (resolved !== binaryPath) {
    console.log(`[codex] Using Codex CLI from PATH: ${resolved}`)
  }
  return resolved
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function isLocalhostHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized.endsWith(".localhost")
  )
}

function extractFirstNonLocalhostUrl(output: string): string | null {
  const matches = stripAnsi(output).match(URL_CANDIDATE_REGEX)
  if (!matches) return null

  for (const match of matches) {
    try {
      const parsedUrl = new URL(match.trim().replace(/[),.;!?]+$/, ""))
      if (!isLocalhostHostname(parsedUrl.hostname)) {
        return parsedUrl.toString()
      }
    } catch {
      // Ignore invalid URL candidates.
    }
  }

  return null
}

function appendLoginOutput(session: CodexLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
}

function toLoginSessionResponse(session: CodexLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): CodexLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }

  return null
}

interface CodexErrorShape {
  data?: { message?: unknown; code?: unknown }
  errorText?: unknown
  message?: unknown
  error?: unknown
  code?: unknown
}

function extractCodexError(error: unknown): { message: string; code?: string } {
  const anyError = error as CodexErrorShape
  const message =
    anyError?.data?.message ||
    anyError?.errorText ||
    anyError?.message ||
    anyError?.error ||
    String(error)
  const code = anyError?.data?.code || anyError?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isCodexAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

type RunCodexCliOptions = {
  cwd?: string
}

async function runCodexCli(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const codexCliPath = resolveBundledCodexCliPath()
  const cwd = options?.cwd?.trim()

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(codexCliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: process.env,
      windowsHide: true,
    })

    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.once("error", (error) => {
      rejectPromise(
        new Error(`[codex] Failed to execute \`codex ${args.join(" ")}\`: ${error.message}`),
      )
    })

    child.once("close", (exitCode) => {
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode,
      })
    })
  })
}

async function runCodexCliChecked(
  args: string[],
  options?: RunCodexCliOptions,
): Promise<{
  stdout: string
  stderr: string
}> {
  const result = await runCodexCli(args, options)
  if (result.exitCode === 0) {
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }

  const message =
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Codex command failed with exit code ${result.exitCode ?? "unknown"}`
  throw new Error(message)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

function toNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return Math.trunc(value)
}

function toTimestampMs(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined
  }
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) {
    return undefined
  }
  return parsed
}

function resolveSessionsRoot(): string {
  // Match provider env precedence: shell-derived env overrides process.env.
  const shellCodexHome = getClaudeShellEnvironment().CODEX_HOME?.trim()
  if (shellCodexHome) {
    return join(shellCodexHome, "sessions")
  }

  const processCodexHome = process.env.CODEX_HOME?.trim()
  if (processCodexHome) {
    return join(processCodexHome, "sessions")
  }

  return join(homedir(), ".codex", "sessions")
}

async function findSessionFileById(sessionId: string): Promise<string | null> {
  const sessionsRoot = resolveSessionsRoot()
  const fileSuffix = `-${sessionId}.jsonl`
  const sortDesc = (values: string[]) =>
    values.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  const listNames = async (dirPath: string): Promise<string[]> => {
    try {
      return await readdir(dirPath, { encoding: "utf8" })
    } catch {
      return []
    }
  }
  const years = sortDesc((await listNames(sessionsRoot)).filter((name) => /^\d{4}$/.test(name)))

  for (const year of years) {
    const yearPath = join(sessionsRoot, year)
    const months = sortDesc((await listNames(yearPath)).filter((name) => /^\d{2}$/.test(name)))
    for (const month of months) {
      const monthPath = join(yearPath, month)
      const days = sortDesc((await listNames(monthPath)).filter((name) => /^\d{2}$/.test(name)))
      for (const day of days) {
        const dayPath = join(monthPath, day)
        const fileName = (await listNames(dayPath)).find((name) => name.endsWith(fileSuffix))
        if (fileName) {
          return join(dayPath, fileName)
        }
      }
    }
  }

  return null
}

async function readLatestTokenCountInfo(
  filePath: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexTokenCountInfo | null> {
  let rawContent = ""
  try {
    rawContent = await readFile(filePath, "utf8")
  } catch {
    return null
  }

  const lines = rawContent.split("\n")
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const rawLine = lines[index]?.trim()
    if (!rawLine) continue

    let parsedLine: unknown
    try {
      parsedLine = JSON.parse(rawLine)
    } catch {
      continue
    }

    if (typeof parsedLine !== "object" || parsedLine === null) continue
    const line = parsedLine as { type?: unknown; timestamp?: unknown; payload?: unknown }
    if (line.type !== "event_msg") continue
    if (typeof line.payload !== "object" || line.payload === null) continue
    const payload = line.payload as { type?: unknown; info?: unknown }
    if (payload.type !== "token_count") continue

    const eventTimestampMs = toTimestampMs(line.timestamp)
    const notBeforeTimestampMs = options?.notBeforeTimestampMs
    if (
      notBeforeTimestampMs !== undefined &&
      (eventTimestampMs === undefined || eventTimestampMs < notBeforeTimestampMs)
    ) {
      continue
    }

    const rawInfo = payload.info
    if (!rawInfo || typeof rawInfo !== "object") continue
    const infoRecord = rawInfo as { last_token_usage?: unknown; model_context_window?: unknown }

    const rawTokenUsage = infoRecord.last_token_usage
    let lastTokenUsage: CodexTokenUsage | undefined
    if (rawTokenUsage && typeof rawTokenUsage === "object") {
      const tokenUsage = rawTokenUsage as Record<string, unknown>
      const parsedTokenUsage: CodexTokenUsage = {
        input_tokens: toNonNegativeInt(tokenUsage.input_tokens),
        cached_input_tokens: toNonNegativeInt(tokenUsage.cached_input_tokens),
        output_tokens: toNonNegativeInt(tokenUsage.output_tokens),
        total_tokens: toNonNegativeInt(tokenUsage.total_tokens),
      }
      if (Object.values(parsedTokenUsage).some((tokenCount) => tokenCount !== undefined)) {
        lastTokenUsage = parsedTokenUsage
      }
    }

    const modelContextWindow = toNonNegativeInt(infoRecord.model_context_window)

    const info: CodexTokenCountInfo = {
      last_token_usage: lastTokenUsage,
      model_context_window: modelContextWindow,
    }
    if (!info.last_token_usage && info.model_context_window === undefined) continue

    return info
  }

  return null
}

function mapToUsageMetadata(info: CodexTokenCountInfo): CodexUsageMetadata | null {
  const perMessageUsage = info.last_token_usage

  if (!perMessageUsage && info.model_context_window === undefined) {
    return null
  }

  const inputTokens =
    perMessageUsage?.input_tokens !== undefined
      ? Math.max(0, perMessageUsage.input_tokens - (perMessageUsage.cached_input_tokens ?? 0))
      : undefined
  const outputTokens = perMessageUsage?.output_tokens
  const totalTokens =
    perMessageUsage?.total_tokens ??
    (perMessageUsage?.input_tokens !== undefined || perMessageUsage?.output_tokens !== undefined
      ? (perMessageUsage?.input_tokens ?? 0) + (perMessageUsage?.output_tokens ?? 0)
      : undefined)

  const usageMetadata: CodexUsageMetadata = {}
  if (inputTokens !== undefined) usageMetadata.inputTokens = inputTokens
  if (outputTokens !== undefined) usageMetadata.outputTokens = outputTokens
  if (totalTokens !== undefined) usageMetadata.totalTokens = totalTokens
  if (info.model_context_window !== undefined) {
    usageMetadata.modelContextWindow = info.model_context_window
  }

  return Object.keys(usageMetadata).length > 0 ? usageMetadata : null
}

async function pollUsage(
  sessionId: string,
  options?: { notBeforeTimestampMs?: number },
): Promise<CodexUsageMetadata | null> {
  let sessionFilePath: string | null = null

  for (let attempt = 0; attempt < CODEX_USAGE_POLL_ATTEMPTS; attempt += 1) {
    if (!sessionFilePath) {
      sessionFilePath = await findSessionFileById(sessionId)
    }

    if (sessionFilePath) {
      const latestInfo = await readLatestTokenCountInfo(sessionFilePath, options)
      if (latestInfo) {
        const usageMetadata = mapToUsageMetadata(latestInfo)
        if (usageMetadata) {
          return usageMetadata
        }
      }
    }

    if (attempt < CODEX_USAGE_POLL_ATTEMPTS - 1) {
      await sleep(CODEX_USAGE_POLL_INTERVAL_MS)
    }
  }

  return null
}

function getCodexMcpAuthState(authStatus: string | null | undefined): {
  supportsAuth: boolean
  authenticated: boolean
  needsAuth: boolean
} {
  const normalized = (authStatus || "").trim().toLowerCase()

  // Exact CLI values from codex-rs/protocol/src/protocol.rs (McpAuthStatus):
  // unsupported | not_logged_in | bearer_token | o_auth
  switch (normalized) {
    case "":
    case "none":
    case "unsupported":
      return { supportsAuth: false, authenticated: false, needsAuth: false }
    case "not_logged_in":
      return { supportsAuth: true, authenticated: false, needsAuth: true }
    case "bearer_token":
    case "o_auth":
      return { supportsAuth: true, authenticated: true, needsAuth: false }
    default:
      // Unknown/forward-compatible value: don't force needs-auth.
      return { supportsAuth: true, authenticated: false, needsAuth: false }
  }
}

function objectToPairs(
  value: Record<string, string> | null | undefined,
): Array<{ name: string; value: string }> | undefined {
  if (!value) return undefined
  const pairs = Object.entries(value)
    .filter(([name, val]) => typeof name === "string" && typeof val === "string")
    .map(([name, val]) => ({ name, value: val }))

  return pairs.length > 0 ? pairs : undefined
}

function resolveCodexStdioEnv(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.env) {
    for (const [name, value] of Object.entries(transport.env)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (Array.isArray(transport.env_vars)) {
    for (const envName of transport.env_vars) {
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0 && !merged[envName]) {
        merged[envName] = value
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function resolveCodexHttpHeaders(
  transport: CodexMcpListEntry["transport"],
): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  if (transport.http_headers) {
    for (const [name, value] of Object.entries(transport.http_headers)) {
      if (typeof name === "string" && typeof value === "string") {
        merged[name] = value
      }
    }
  }

  if (transport.env_http_headers) {
    for (const [headerName, envName] of Object.entries(transport.env_http_headers)) {
      if (typeof headerName !== "string" || typeof envName !== "string") continue
      const value = process.env[envName]
      if (typeof value === "string" && value.length > 0) {
        merged[headerName] = value
      }
    }
  }

  const bearerEnvVar = transport.bearer_token_env_var?.trim()
  if (bearerEnvVar && !merged.Authorization) {
    const token = process.env[bearerEnvVar]?.trim()
    if (token) {
      merged.Authorization = `Bearer ${token}`
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeCodexTools(tools: McpToolInfo[]): McpToolInfo[] {
  const unique = new Map<string, McpToolInfo>()
  for (const tool of tools) {
    if (typeof tool?.name === "string" && tool.name.trim()) {
      const name = tool.name.trim()
      unique.set(name, {
        name,
        ...(tool.description ? { description: tool.description } : {}),
      })
    }
  }
  return [...unique.values()]
}

async function fetchCodexMcpTools(entry: CodexMcpListEntry): Promise<McpToolInfo[]> {
  const transportType = entry.transport.type.trim().toLowerCase()
  const timeoutPromise = new Promise<McpToolInfo[]>((_, reject) =>
    setTimeout(() => reject(new Error("Timeout")), CODEX_MCP_TOOLS_FETCH_TIMEOUT_MS),
  )

  const fetchPromise = (async (): Promise<McpToolInfo[]> => {
    if (transportType === "stdio") {
      const command = entry.transport.command?.trim()
      if (!command) return []
      return await fetchMcpToolsStdio({
        command,
        args: entry.transport.args || undefined,
        env: resolveCodexStdioEnv(entry.transport),
      })
    }

    if (
      transportType === "streamable_http" ||
      transportType === "http" ||
      transportType === "sse"
    ) {
      const url = entry.transport.url?.trim()
      if (!url) return []
      return await fetchMcpTools(url, resolveCodexHttpHeaders(entry.transport))
    }

    return []
  })()

  try {
    const tools = await Promise.race([fetchPromise, timeoutPromise])
    return normalizeCodexTools(tools)
  } catch {
    return []
  }
}

function resolveCodexLookupPath(pathCandidate: string | null | undefined): string {
  return pathCandidate?.trim() ? pathCandidate.trim() : "__global__"
}

function getCodexMcpFingerprint(servers: CodexMcpServerForSession[]): string {
  return createHash("sha256").update(JSON.stringify(servers)).digest("hex")
}

async function resolveCodexMcpSnapshot(params: {
  lookupPath?: string | null
  forceRefresh?: boolean
  includeTools?: boolean
}): Promise<CodexMcpSnapshot> {
  const lookupPath = resolveCodexLookupPath(params.lookupPath)
  const cached = codexMcpCache.get(lookupPath)
  const shouldIncludeTools = Boolean(params.includeTools)
  if (cached && !params.forceRefresh && (!shouldIncludeTools || cached.toolsResolved)) {
    return cached
  }

  const result = await runCodexCliChecked(["mcp", "list", "--json"], {
    cwd: lookupPath === "__global__" ? undefined : lookupPath,
  })

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error("Failed to parse Codex MCP list JSON output.")
  }

  const entries = z.array(codexMcpListEntrySchema).parse(parsed)
  const mcpServersForSession: CodexMcpServerForSession[] = []
  const mcpServersForSettings: CodexMcpServerForSettings[] = []

  const convertedEntries = await Promise.all(
    entries.map(async (entry) => {
      const transportType = entry.transport.type.trim().toLowerCase()
      const authState = getCodexMcpAuthState(entry.auth_status)
      const includeInSession = entry.enabled
      const resolvedStdioEnv = resolveCodexStdioEnv(entry.transport)
      const resolvedHttpHeaders = resolveCodexHttpHeaders(entry.transport)
      let status: CodexMcpServerForSettings["status"] = !entry.enabled
        ? "failed"
        : authState.needsAuth
          ? "needs-auth"
          : "connected"

      const settingsConfig: Record<string, unknown> = {
        transportType: entry.transport.type,
        authStatus: entry.auth_status ?? "unknown",
        enabled: entry.enabled,
        disabledReason: entry.disabled_reason ?? undefined,
      }

      let sessionServer: CodexMcpServerForSession | null = null
      if (transportType === "stdio") {
        const command = entry.transport.command || undefined
        const args = entry.transport.args || undefined
        if (includeInSession && command) {
          const envPairs = objectToPairs(resolvedStdioEnv) || []
          sessionServer = {
            name: entry.name,
            type: "stdio",
            command,
            args: Array.isArray(args) ? args : [],
            env: envPairs,
          }
        }

        settingsConfig.command = command
        settingsConfig.args = args
        settingsConfig.env = entry.transport.env || undefined
        settingsConfig.envVars = entry.transport.env_vars || undefined
      } else if (
        transportType === "streamable_http" ||
        transportType === "http" ||
        transportType === "sse"
      ) {
        const url = entry.transport.url || undefined
        const headers = objectToPairs(resolvedHttpHeaders)
        if (includeInSession && url) {
          sessionServer = {
            name: entry.name,
            type: "http",
            url,
            headers: headers || [],
          }
        }

        settingsConfig.url = url
        settingsConfig.headers = entry.transport.http_headers || undefined
        settingsConfig.envHttpHeaders = entry.transport.env_http_headers || undefined
        settingsConfig.bearerTokenEnvVar = entry.transport.bearer_token_env_var || undefined
      }

      const shouldProbeTools =
        shouldIncludeTools &&
        includeInSession &&
        !authState.needsAuth &&
        // Probe unauthenticated/public servers and stdio servers.
        (!authState.supportsAuth ||
          transportType === "stdio" ||
          // For auth-capable HTTP, only probe if explicit auth header is available.
          Boolean(resolvedHttpHeaders?.Authorization))
      const tools = shouldProbeTools ? await fetchCodexMcpTools(entry) : []
      if (shouldProbeTools && tools.length === 0) {
        status = "failed"
      }

      return {
        sessionServer,
        settingsServer: {
          name: entry.name,
          status,
          tools,
          needsAuth: authState.needsAuth,
          config: settingsConfig,
        } satisfies CodexMcpServerForSettings,
      }
    }),
  )

  for (const converted of convertedEntries) {
    if (converted.sessionServer) {
      mcpServersForSession.push(converted.sessionServer)
    }
    mcpServersForSettings.push(converted.settingsServer)
  }

  const snapshot: CodexMcpSnapshot = {
    mcpServersForSession,
    groups: [
      {
        groupName: "Global",
        projectPath: null,
        mcpServers: mcpServersForSettings,
      },
    ],
    fingerprint: getCodexMcpFingerprint(mcpServersForSession),
    fetchedAt: Date.now(),
    toolsResolved: shouldIncludeTools,
  }

  codexMcpCache.set(lookupPath, snapshot)
  return snapshot
}

function clearCodexMcpCache(): void {
  codexMcpCache.clear()
}

function getCodexServerIdentity(server: CodexMcpServerForSettings): string {
  const config = server.config as Record<string, unknown>
  return JSON.stringify({
    enabled: config.enabled ?? null,
    disabledReason: config.disabledReason ?? null,
    transportType: config.transportType ?? null,
    command: config.command ?? null,
    args: config.args ?? null,
    env: config.env ?? null,
    envVars: config.envVars ?? null,
    url: config.url ?? null,
    headers: config.headers ?? null,
    envHttpHeaders: config.envHttpHeaders ?? null,
    bearerTokenEnvVar: config.bearerTokenEnvVar ?? null,
    authStatus: config.authStatus ?? null,
  })
}

export async function getAllCodexMcpConfigHandler() {
  const globalSnapshot = await resolveCodexMcpSnapshot({ includeTools: true })
  const globalServers = globalSnapshot.groups[0]?.mcpServers || []
  const globalByName = new Map(
    globalServers.map((server) => [server.name, getCodexServerIdentity(server)]),
  )

  const groups: CodexMcpSnapshot["groups"] = [...globalSnapshot.groups]

  // Only enumerate projects the app knows about (DB-backed projects).
  // Do not scan ~/.codex/config.toml project entries.
  const projectPathSet = new Set<string>()

  try {
    const db = getDatabase()
    const dbProjects = db.select({ path: projectsTable.path }).from(projectsTable).all()
    for (const project of dbProjects) {
      if (typeof project.path === "string" && project.path.trim().length > 0) {
        projectPathSet.add(project.path)
      }
    }
  } catch (error) {
    console.error("[codex.getAllMcpConfig] Failed to read projects from DB:", error)
  }

  const projectPaths = [...projectPathSet].sort((a, b) => a.localeCompare(b))
  const projectResults = await Promise.allSettled(
    projectPaths.map(async (projectPath) => {
      const projectSnapshot = await resolveCodexMcpSnapshot({
        lookupPath: projectPath,
        includeTools: true,
      })
      const effectiveServers = projectSnapshot.groups[0]?.mcpServers || []
      const projectOnlyServers = effectiveServers.filter((server) => {
        const globalIdentity = globalByName.get(server.name)
        if (!globalIdentity) return true
        return globalIdentity !== getCodexServerIdentity(server)
      })

      if (projectOnlyServers.length === 0) {
        return null
      }

      return {
        groupName: basename(projectPath) || projectPath,
        projectPath,
        mcpServers: projectOnlyServers,
      }
    }),
  )

  for (const result of projectResults) {
    if (result.status === "fulfilled" && result.value) {
      groups.push(result.value)
      continue
    }
    if (result.status === "rejected") {
      console.error(
        "[codex.getAllMcpConfig] Failed to resolve project MCP snapshot:",
        result.reason,
      )
    }
  }

  return { groups }
}

function normalizeCodexIntegrationState(rawOutput: string): CodexIntegrationState {
  const normalizedOutput = rawOutput.toLowerCase()

  if (normalizedOutput.includes("logged in using chatgpt")) {
    return "connected_chatgpt"
  }

  if (
    normalizedOutput.includes("logged in using an api key") ||
    normalizedOutput.includes("logged in using api key")
  ) {
    return "connected_api_key"
  }

  if (normalizedOutput.includes("not logged in")) {
    return "not_logged_in"
  }

  return "unknown"
}

/** Loose shape of a persisted chat message part (stored as JSON in subChats.messages). */
export interface StoredMessagePart {
  type?: string
  text?: unknown
  state?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  data?: unknown
  filePath?: string
  content?: unknown
  result?: unknown
  startedAt?: number
}

/** Loose shape of a persisted chat message (stored as JSON in subChats.messages). */
export interface StoredChatMessage {
  id?: string
  role?: string
  parts?: StoredMessagePart[]
  metadata?: unknown
}

export function parseStoredMessages(raw: string | null | undefined): StoredChatMessage[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function extractPromptFromStoredMessage(message: StoredChatMessage): string {
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath = typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

export function getLastSessionId(messages: StoredChatMessage[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant")
  const metadata: unknown = lastAssistant?.metadata
  if (metadata && typeof metadata === "object" && "sessionId" in metadata) {
    const sessionId: unknown = metadata.sessionId
    return typeof sessionId === "string" ? sessionId : undefined
  }
  return undefined
}

function getLastThreadId(messages: StoredChatMessage[]): string | undefined {
  const lastAssistant = [...messages].reverse().find((message) => message?.role === "assistant")
  const metadata: unknown = lastAssistant?.metadata
  if (metadata && typeof metadata === "object" && "threadId" in metadata) {
    const threadId: unknown = metadata.threadId
    return typeof threadId === "string" ? threadId : undefined
  }
  return undefined
}

function extractCodexModelId(rawModel: unknown): string | undefined {
  if (typeof rawModel !== "string" || rawModel.length === 0) {
    return undefined
  }

  const normalizedModel = rawModel.trim()

  if (!normalizedModel || normalizedModel === "codex") {
    return undefined
  }

  return normalizedModel
}

function parseCodexModelSelection(rawModel: unknown): {
  modelId?: string
  reasoningEffort?: string
} {
  const rawModelId = extractCodexModelId(rawModel)
  if (!rawModelId) {
    return {}
  }

  const [modelId, reasoningEffort, ...extraParts] = rawModelId.split("/")
  if (
    modelId &&
    reasoningEffort &&
    extraParts.length === 0 &&
    isCodexReasoningEffort(reasoningEffort)
  ) {
    return { modelId, reasoningEffort }
  }

  return { modelId: rawModelId }
}

function preprocessCodexModelName(params: {
  modelId: string
  authConfig?: { apiKey: string }
}): string {
  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  if (!hasAppManagedApiKey) {
    return params.modelId
  }

  // All model IDs now match the real API; pass through as-is
  return params.modelId
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildCodexProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
  // Prefer shell-derived values (notably PATH) so stdio MCP dependencies
  // like pipx/npx resolve the same way as in MCP tool probing.
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  const shellEnv = getClaudeShellEnvironment()
  for (const [key, value] of Object.entries(shellEnv)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) {
    return env
  }

  return {
    ...env,
    CODEX_API_KEY: apiKey,
  }
}

// `-c key=value` config overrides, placed before the `app-server` subcommand.
function buildCodexProviderArgs(reasoningEffort?: string): string[] {
  const args: string[] = []

  if (reasoningEffort && isCodexReasoningEffort(reasoningEffort)) {
    args.push("-c", `model_reasoning_effort="${reasoningEffort}"`)
  }

  return args
}

/**
 * The static list the CLI's catalog is validated against before use. An
 * API-key chat drops the ChatGPT-only ids, so the probe cannot hand back a
 * default the caller's credential cannot run. This mirrors the filter the
 * picker applies over the same list.
 */
function codexKnownModels(authConfig?: { apiKey: string }): KnownCodexModel[] {
  const apiKeyAuth = Boolean(authConfig?.apiKey?.trim())
  const subscriptionOnly = new Set<string>(CODEX_SUBSCRIPTION_ONLY_MODEL_IDS)
  return CODEX_MODELS.filter((model) => !apiKeyAuth || !subscriptionOnly.has(model.id)).map(
    (model) => ({ id: model.id, efforts: [...model.thinkings] }),
  )
}

/**
 * The default for a chat that names no model. The pinned CLI's catalog is the
 * answer, validated against the static picker list, with the shared static
 * values behind it, so this router and the renderer transport cannot drift
 * onto two different defaults again.
 */
function resolveCodexDefault(
  cwd: string,
  authConfig?: { apiKey: string },
): Promise<ResolvedCodexDefault> {
  return resolveCodexDefaultModel({
    binaryPath: resolveBundledCodexCliPath(),
    argv: ["app-server"],
    cwd,
    env: buildCodexProviderEnv(authConfig),
    knownModels: codexKnownModels(authConfig),
    // A different key can be shown a different catalog, so it must not be
    // served the answer another key produced.
    cacheKey: getAuthFingerprint(authConfig) ?? undefined,
  })
}

export function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): StoredMessagePart[] {
  const parts: StoredMessagePart[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      parts.push({
        type: "data-image",
        data: {
          base64Data: image.base64Data,
          mediaType: image.mediaType,
          filename: image.filename,
        },
      })
    }
  }

  return parts
}

async function getOrCreateSession(params: {
  subChatId: string
  cwd: string
  mcpFingerprint: string
  existingThreadId?: string
  legacySessionId?: string
  reasoningEffort?: string
  model?: string
  authConfig?: {
    apiKey: string
  }
  onChunk: (chunk: CodexSessionChunk) => void
}): Promise<CodexAppServerSession> {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.mcpFingerprint === params.mcpFingerprint &&
    existing.reasoningEffort === (params.reasoningEffort || null)
  ) {
    existing.session.setOnChunk(params.onChunk)
    return existing.session
  }

  if (existing) {
    await cleanupProvider(params.subChatId)
  }

  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  // When app-managed key auth is used, avoid resuming older persisted threads.
  // Those can be tied to unauthenticated/CLI-auth state and trigger auth loops.
  const resumeIds = hasAppManagedApiKey
    ? {}
    : {
        ...(params.existingThreadId ? { existingThreadId: params.existingThreadId } : {}),
        ...(params.legacySessionId ? { legacySessionId: params.legacySessionId } : {}),
      }

  const session = await createCodexAppServerSession({
    binaryPath: resolveBundledCodexCliPath(),
    argv: [...buildCodexProviderArgs(params.reasoningEffort), "app-server"],
    cwd: params.cwd,
    env: buildCodexProviderEnv(params.authConfig),
    model: params.model,
    onChunk: params.onChunk,
    ...resumeIds,
  })

  providerSessions.set(params.subChatId, {
    session,
    cwd: params.cwd,
    authFingerprint,
    mcpFingerprint: params.mcpFingerprint,
    reasoningEffort: params.reasoningEffort || null,
  })

  return session
}

async function cleanupProvider(subChatId: string): Promise<void> {
  const existing = providerSessions.get(subChatId)
  if (!existing) return

  providerSessions.delete(subChatId)
  try {
    await existing.session.dispose()
  } catch (error) {
    console.error("[codex] Failed to dispose app-server session:", error)
  }
}

export const codexRouter = router({
  getIntegration: publicProcedure.query(async () => {
    const result = await runCodexCli(["login", "status"])
    const combinedOutput = [result.stdout, result.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(combinedOutput)

    return {
      state,
      isConnected: state === "connected_chatgpt" || state === "connected_api_key",
      rawOutput: combinedOutput,
      exitCode: result.exitCode,
    }
  }),

  /**
   * The default a chat with no model chosen will run. `source` says whether
   * the pinned CLI answered or the shared static fallback did, so the
   * renderer can show a stale default instead of passing it off as current.
   */
  getDefaultModel: publicProcedure
    .input(
      z
        .object({
          cwd: z.string().optional(),
          authConfig: z.object({ apiKey: z.string().min(1) }).optional(),
        })
        .optional(),
    )
    .query(({ input }) => resolveCodexDefault(input?.cwd ?? process.cwd(), input?.authConfig)),

  logout: publicProcedure.mutation(async () => {
    clearCodexDefaultModelCache()
    const logoutResult = await runCodexCli(["logout"])
    const statusResult = await runCodexCli(["login", "status"])

    const statusOutput = [statusResult.stdout, statusResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    const state = normalizeCodexIntegrationState(statusOutput)
    const isConnected = state === "connected_chatgpt" || state === "connected_api_key"

    if (isConnected) {
      throw new Error("Failed to log out from Codex. Please try again.")
    }

    const logoutOutput = [logoutResult.stdout, logoutResult.stderr]
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n")
      .trim()

    return {
      success: true,
      state,
      isConnected: false,
      logoutExitCode: logoutResult.exitCode,
      logoutOutput,
      statusOutput,
    }
  }),

  startLogin: publicProcedure.mutation(() => {
    clearCodexDefaultModelCache()
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const codexCliPath = resolveBundledCodexCliPath()
    const sessionId = crypto.randomUUID()

    const child = spawn(codexCliPath, ["login"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    const session: CodexLoginSession = {
      id: sessionId,
      process: child,
      state: "running",
      output: "",
      url: null,
      error: null,
      exitCode: null,
    }

    const handleChunk = (chunk: Buffer | string) => {
      appendLoginOutput(session, chunk.toString("utf8"))
    }

    child.stdout.on("data", handleChunk)
    child.stderr.on("data", handleChunk)

    child.once("error", (error) => {
      session.state = "error"
      session.error = `[codex] Failed to start login flow: ${error.message}`
      session.process = null
    })

    child.once("close", (exitCode) => {
      session.exitCode = exitCode
      session.process = null

      if (session.state === "cancelled") {
        return
      }

      if (exitCode === 0) {
        session.state = "success"
        session.error = null
      } else {
        session.state = "error"
        session.error = session.error || `Codex login exited with code ${exitCode ?? "unknown"}`
      }
    })

    loginSessions.set(sessionId, session)

    return toLoginSessionResponse(session)
  }),

  getLoginSession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .query(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        throw new Error("Codex login session not found")
      }

      return toLoginSessionResponse(session)
    }),

  cancelLogin: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const session = loginSessions.get(input.sessionId)
      if (!session) {
        return { success: true, found: false }
      }

      session.state = "cancelled"
      session.error = null

      if (session.process && !session.process.killed) {
        session.process.kill("SIGTERM")
      }

      return { success: true, found: true, session: toLoginSessionResponse(session) }
    }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllCodexMcpConfigHandler()
    } catch (error) {
      console.error("[codex.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: extractCodexError(error).message,
      }
    }
  }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCodexMcpCache()
    return { success: true }
  }),

  addMcpServer: publicProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .regex(
            /^[a-zA-Z0-9_-]+$/,
            "Name must contain only letters, numbers, underscores, and hyphens",
          ),
        scope: z.enum(["global", "project"]),
        transport: z.enum(["stdio", "http"]),
        command: z.string().optional(),
        args: z.array(z.string()).optional(),
        url: z.string().url().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      const args = ["mcp", "add", input.name.trim()]
      if (input.transport === "http") {
        const url = input.url?.trim()
        if (!url) {
          throw new Error("URL is required for HTTP servers.")
        }
        args.push("--url", url)
      } else {
        const command = input.command?.trim()
        if (!command) {
          throw new Error("Command is required for stdio servers.")
        }

        args.push("--", command, ...(input.args || []))
      }

      await runCodexCliChecked(args)
      clearCodexMcpCache()
      return { success: true }
    }),

  removeMcpServer: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        scope: z.enum(["global", "project"]).default("global"),
      }),
    )
    .mutation(async ({ input }) => {
      if (input.scope !== "global") {
        throw new Error("Codex MCP currently supports global scope only.")
      }

      await runCodexCliChecked(["mcp", "remove", input.name.trim()])
      clearCodexMcpCache()
      return { success: true }
    }),

  startMcpOAuth: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "login", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  logoutMcpServer: publicProcedure
    .input(
      z.object({
        serverName: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const projectPath = input.projectPath?.trim()
        await runCodexCliChecked(["mcp", "logout", input.serverName.trim()], {
          cwd: projectPath && projectPath.length > 0 ? projectPath : undefined,
        })
        clearCodexMcpCache()
        return { success: true as const }
      } catch (error) {
        return {
          success: false as const,
          error: extractCodexError(error).message,
        }
      }
    }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        runId: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        mode: agentModeSchema.default(DEFAULT_AGENT_MODE),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
        authConfig: z
          .object({
            apiKey: z.string().min(1),
          })
          .optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<CodexSessionChunk>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
          // Ensure old run cannot continue emitting after supersede.
          void cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true

        const safeEmit = (chunk: CodexSessionChunk) => {
          if (!isActive) return
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }

        const safeComplete = () => {
          if (!isActive) return
          isActive = false
          try {
            emit.complete()
          } catch {
            // Ignore double completion
          }
        }

        // Coalesce high-frequency text-delta chunks into fewer IPC emits.
        // Non-text chunks flush the buffer first (ordering preserved); the buffer
        // is drained explicitly on stream end / error / abort below.
        const coalescer = createChunkCoalescer<CodexSessionChunk>(
          (chunk) => {
            safeEmit(chunk)
            return isActive
          },
          { flushIntervalMs: 40 },
        )

        ;(async () => {
          try {
            const db = getDatabase()

            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const parsedModelSelection = parseCodexModelSelection(input.model)
            // A turn never waits on a catalog read; it takes the resolved
            // default the app already holds, or the shared static one.
            //
            // Open follow-up. Nothing reaches this branch from the app today.
            // `getSelectedCodexModel` in
            // `src/renderer/features/agents/lib/acp-chat-transport.ts` always
            // returns `id/effort`, falling back to `CODEX_MODELS[0]` when the
            // atom holds nothing, so `parsedModelSelection.modelId` is always
            // set. To let the CLI-resolved default actually reach a chat, the
            // transport must omit `model` until the user picks one and the
            // picker must show `codex.getDefaultModel`, which no caller uses
            // yet. Step 05 forbade re-plumbing the picker, so it stopped here.
            const resolvedDefault = parsedModelSelection.modelId ? null : peekCodexDefaultModel()
            const requestedModelId =
              parsedModelSelection.modelId || resolvedDefault?.modelId || DEFAULT_CODEX_UI_MODEL
            const selectedModelId = preprocessCodexModelName({
              modelId: requestedModelId,
              authConfig: input.authConfig,
            })
            const selectedReasoningEffort =
              parsedModelSelection.reasoningEffort ?? resolvedDefault?.reasoningEffort
            console.info(
              `[codex] model selection: subChatId=${input.subChatId} model=${selectedModelId} effort=${selectedReasoningEffort ?? "provider default"} source=${
                parsedModelSelection.modelId ? "chat selection" : resolvedDefault?.source
              }`,
            )
            const metadataModel = selectedReasoningEffort
              ? `${selectedModelId}/${selectedReasoningEffort}`
              : selectedModelId
            // app-server takes model and reasoning effort as separate fields
            // (thread/start + turn/start) — no `model/effort` concat needed.

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream: StoredChatMessage[] = existingMessages
            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return !currentStream || currentStream.runId === input.runId
            }

            const persistSubChatMessages = (messages: StoredChatMessage[]) => {
              if (!isAuthoritativeRun()) {
                return false
              }

              db.update(subChats)
                .set({
                  messages: JSON.stringify(messages),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            const cleanAssistantMessageForPersistence = (
              message: StoredChatMessage,
            ): StoredChatMessage | null => {
              if (message?.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message

              const cleanedParts = message.parts.filter(
                (part: StoredMessagePart) => part?.state !== "input-streaming",
              )

              if (cleanedParts.length === 0) {
                return null
              }

              const cleanedMessage = {
                ...message,
                parts: cleanedParts,
              }

              return normalizeCodexAssistantMessage(cleanedMessage, {
                normalizeState: true,
              }) as StoredChatMessage
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: metadataModel },
              }

              messagesForStream = [...existingMessages, userMessage]

              db.update(subChats)
                .set({
                  messages: JSON.stringify(messagesForStream),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
            }

            if (input.forceNewSession) {
              await cleanupProvider(input.subChatId)
            }

            let mcpSnapshot: CodexMcpSnapshot = {
              mcpServersForSession: [],
              groups: [],
              fingerprint: getCodexMcpFingerprint([]),
              fetchedAt: Date.now(),
              toolsResolved: false,
            }
            try {
              const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(input.cwd)
              const mcpLookupPath = input.projectPath || resolvedProjectPathFromCwd || input.cwd
              mcpSnapshot = await resolveCodexMcpSnapshot({
                lookupPath: mcpLookupPath,
              })
            } catch (mcpError) {
              console.error("[codex] Failed to resolve MCP servers:", mcpError)
            }

            // Accumulate the assistant message from app-server chunks while also
            // forwarding chunks to the renderer. Shape mirrors the AI-SDK
            // UIMessage parts the ACP path produced, so persistence and the
            // renderer stay untouched.
            const accumulatedParts: StoredMessagePart[] = []
            const accumulatedText: Record<string, string> = {}
            const toolPartIndexByCallId: Record<string, number> = {}
            const startedAt = Date.now()
            let latestSessionId: string | undefined =
              input.sessionId || getLastSessionId(existingMessages)
            let latestThreadId: string | undefined = getLastThreadId(existingMessages)
            let usagePromise: Promise<CodexUsageMetadata | null> | null = null

            const resolveUsageOnce = (): Promise<CodexUsageMetadata | null> => {
              if (usagePromise) return usagePromise

              const sessionId = latestSessionId
              if (!sessionId) {
                return Promise.resolve(null)
              }

              usagePromise = pollUsage(sessionId, {
                notBeforeTimestampMs: startedAt,
              }).catch(() => null)
              return usagePromise
            }

            const handleSessionChunk = (chunk: CodexSessionChunk) => {
              if (chunk?.type === "error") {
                // Drain buffered text before the error chunk (ordering).
                coalescer.flush()
                const normalized = extractCodexError(chunk)
                if (isCodexAuthError(normalized)) {
                  safeEmit({
                    ...chunk,
                    type: "auth-error",
                    errorText: normalized.message,
                  })
                } else {
                  safeEmit({ ...chunk, errorText: normalized.message })
                }
                return
              }

              if (chunk?.type === "text-start" && typeof chunk.id === "string") {
                accumulatedText[chunk.id] = ""
              } else if (
                chunk?.type === "text-delta" &&
                typeof chunk.id === "string" &&
                typeof chunk.delta === "string"
              ) {
                accumulatedText[chunk.id] = (accumulatedText[chunk.id] ?? "") + chunk.delta
              } else if (chunk?.type === "text-end" && typeof chunk.id === "string") {
                accumulatedParts.push({
                  type: "text",
                  text: accumulatedText[chunk.id] ?? "",
                })
                delete accumulatedText[chunk.id]
              } else if (
                chunk?.type === "tool-input-available" &&
                typeof chunk.toolCallId === "string"
              ) {
                const part = {
                  type: `tool-${chunk.toolName}`,
                  toolCallId: chunk.toolCallId,
                  toolName: chunk.toolName,
                  input: chunk.input,
                  state: "call",
                  startedAt: Date.now(),
                }
                toolPartIndexByCallId[chunk.toolCallId] = accumulatedParts.length
                accumulatedParts.push(part)
              } else if (
                chunk?.type === "tool-output-available" &&
                typeof chunk.toolCallId === "string"
              ) {
                const index = toolPartIndexByCallId[chunk.toolCallId]
                if (index !== undefined && accumulatedParts[index]) {
                  accumulatedParts[index] = {
                    ...accumulatedParts[index],
                    result: chunk.output,
                    output: chunk.output,
                    state: "result",
                  }
                }
              }

              coalescer.push(chunk)
            }

            const session = await getOrCreateSession({
              subChatId: input.subChatId,
              cwd: input.cwd,
              mcpFingerprint: mcpSnapshot.fingerprint,
              existingThreadId: input.forceNewSession
                ? undefined
                : getLastThreadId(existingMessages),
              legacySessionId: input.forceNewSession
                ? undefined
                : (input.sessionId ?? getLastSessionId(existingMessages)),
              reasoningEffort: selectedReasoningEffort,
              model: selectedModelId,
              authConfig: input.authConfig,
              onChunk: handleSessionChunk,
            })
            latestSessionId = session.sessionId
            latestThreadId = session.threadId

            if (abortController.signal.aborted) {
              // Cancelled while spawning: the finally below disposes the
              // session (aborted runs always clean up).
              safeComplete()
              return
            }
            abortController.signal.addEventListener(
              "abort",
              () => {
                void session.interrupt()
              },
              { once: true },
            )

            const turnInput: CodexTurnInput[] = [{ type: "text", text: input.prompt }]
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `codex-${input.runId}`,
            )
            for (const imagePath of imagePaths) {
              turnInput.push({ type: "localImage", path: imagePath })
            }

            let turnResult: Awaited<ReturnType<CodexAppServerSession["startTurn"]>>
            if (abortController.signal.aborted) {
              await cleanupImageFiles()
              turnResult = { status: "interrupted" }
            } else {
              try {
                turnResult = await session.startTurn(turnInput, {
                  model: selectedModelId,
                  effort: selectedReasoningEffort,
                })
              } finally {
                await cleanupImageFiles()
              }
            }

            // Drain any buffered text-delta before the post-stream emits.
            coalescer.flush()

            const usageMetadata = await resolveUsageOnce()
            if (usageMetadata) {
              safeEmit({
                type: "message-metadata",
                messageMetadata: usageMetadata,
              })
            }

            const finishMetadata = {
              model: metadataModel,
              sessionId: latestSessionId,
              threadId: latestThreadId,
              durationMs: Date.now() - startedAt,
              // Mirror the ACP/AI-SDK routers: only true errors fail; user
              // interrupts render without the "Failed" badge.
              resultSubtype: turnResult.status === "error" ? "error" : "success",
            }
            safeEmit({ type: "message-metadata", messageMetadata: finishMetadata })

            safeEmit({ type: "finish" })

            try {
              const responseMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                parts: accumulatedParts,
                metadata: {
                  ...finishMetadata,
                  ...(usageMetadata ?? {}),
                },
              }
              const cleanedResponseMessage = cleanAssistantMessageForPersistence(responseMessage)

              if (!cleanedResponseMessage) {
                persistSubChatMessages(messagesForStream)
              } else {
                persistSubChatMessages([...messagesForStream, cleanedResponseMessage])
              }
            } catch (error) {
              console.error("[codex] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            coalescer.flush()
            const normalized = extractCodexError(error)

            console.error("[codex] chat stream error:", error)
            if (isCodexAuthError(normalized)) {
              safeEmit({ type: "auth-error", errorText: normalized.message })
            } else {
              safeEmit({ type: "error", errorText: normalized.message })
            }
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              const shouldCleanupProvider =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanupProvider) {
                await cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
          coalescer.dispose() // Clear flush timer (flush is a no-op once inactive)
          abortController.abort()

          const activeStream = activeStreams.get(input.subChatId)
          if (activeStream?.runId === input.runId) {
            activeStream.cancelRequested = true
          }
        }
      })
    }),

  cancel: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
      }),
    )
    .mutation(({ input }) => {
      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) {
        return { cancelled: false, ignoredStale: false }
      }

      if (activeStream.runId !== input.runId) {
        return { cancelled: false, ignoredStale: true }
      }

      activeStream.cancelRequested = true
      activeStream.controller.abort()

      return { cancelled: true, ignoredStale: false }
    }),

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(async ({ input }) => {
      await cleanupProvider(input.subChatId)

      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }

      return { success: true }
    }),
})
