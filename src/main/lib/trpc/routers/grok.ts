/**
 * mausCode Grok Build provider router: login, chat, cancel, cleanup, MCP.
 * Ours (no upstream port): chat runs native `grok -p --output-format
 * streaming-json` print turns via grok-print/session.
 */

import { type ChildProcess, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, subChats } from "../../db"
import { resolveGrokCliLaunch } from "../../grok-binary"
import {
  clearGrokMcpCache,
  getAllGrokMcpConfigHandler,
  getGrokMcpConfigForProject,
} from "../../grok-mcp"
import {
  buildGrokPrintArgs,
  buildGrokPrintFallbackArgs,
  isGrokInvalidModelError,
  isGrokResumeError,
  isGrokUnknownFlagError,
} from "../../grok-print/args"
import { runGrokPrintTurn } from "../../grok-print/session"
import { writeImageTempFiles } from "../../image-staging"
import { probeGrok, probeGrokAuthHome } from "../../providers/grok"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type GrokPrintState = {
  cwd: string
  authFingerprint: string | null
  model: string | null
  sessionId: string | undefined
}

type ActiveGrokStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const providerSessions = new Map<string, GrokPrintState>()
const activeStreams = new Map<string, ActiveGrokStream>()

type GrokLoginSessionState = "running" | "success" | "error" | "cancelled"

type GrokLoginSession = {
  id: string
  process: ChildProcess | null
  state: GrokLoginSessionState
  output: string
  url: string | null
  code: string | null
  error: string | null
  exitCode: number | null
  fellBackToBrowserLogin: boolean
}

const loginSessions = new Map<string, GrokLoginSession>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

// `grok login --device-auth` prints a URL plus a user code; the exact
// wording is not pinned by the docs, so match the common shapes and
// always keep the raw output for the modal to display. Loose captures
// are only trusted under a strong label (user/verification/device
// code, enter-code, otp); bare "code ..." matches must look like a real
// device code (uppercase/digits/dashes) so prose never shows as a code.
const DEVICE_CODE_PATTERNS: Array<{ pattern: RegExp; strict: boolean }> = [
  { pattern: /user[\s_-]*code\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: false },
  { pattern: /verification\s*code\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: false },
  { pattern: /device\s*code\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: false },
  { pattern: /enter\s+(?:the\s+)?code\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: false },
  { pattern: /\botp\s*[:=-]?\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: false },
  { pattern: /\bcode\s*[:=-]\s*([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: true },
  { pattern: /\bcode\s+is\s+([A-Za-z0-9][A-Za-z0-9-]{3,})/i, strict: true },
]
const STRICT_CODE_SHAPE = /^[A-Z0-9][A-Z0-9-]{3,}$/

const AUTH_HINTS = [
  "not logged in",
  "authentication required",
  "auth required",
  "login required",
  "missing credentials",
  "no credentials",
  "unauthorized",
  "invalid api key",
  "invalid_api_key",
  "incorrect api key",
  "api key",
  "xai_api_key",
  "grok login",
  "401",
  "403",
]

export function hasActiveGrokStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllGrokStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[grok] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function extractGrokError(error: unknown): { message: string; code?: string } {
  const anyError = error as any
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

function isGrokAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  // Quota/billing/rate-limit failures mention keys and 403s but are not
  // fixed by logging in: never route them to the login modal.
  if (
    /quota|rate[ -]?limit|too many requests|\b429\b|insufficient (credit|balance|funds|quota)|billing|payment|plan limit|usage limit/i.test(
      searchableText,
    )
  ) {
    return false
  }
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

async function runGrokCli(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const launch = resolveGrokCliLaunch(args)
  const cwd = options?.cwd?.trim()
  const timeoutMs = options?.timeoutMs ?? 15000

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: cwd && cwd.length > 0 ? cwd : undefined,
      env: process.env,
      windowsHide: true,
    })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill("SIGKILL")
      } catch {
        // Already gone.
      }
      rejectPromise(
        new Error(
          `[grok] Timed out executing \`grok ${args.join(" ")}\` after ${Math.round(timeoutMs / 1000)}s`,
        ),
      )
    }, timeoutMs)
    timer.unref?.()

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8")
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8")
    })

    child.once("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      rejectPromise(
        new Error(`[grok] Failed to execute \`grok ${args.join(" ")}\`: ${error.message}`),
      )
    })

    child.once("close", (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        stdout: stripAnsi(stdout),
        stderr: stripAnsi(stderr),
        exitCode,
      })
    })
  })
}

function parseStoredMessages(raw: string | null | undefined): any[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function extractPromptFromStoredMessage(message: any): string {
  if (!message || message.role !== "user" || !Array.isArray(message.parts)) {
    return ""
  }

  return message.parts
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("\n")
}

function getLastSessionId(messages: any[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionId = messages[index]?.metadata?.sessionId
    if (typeof sessionId === "string" && sessionId.length > 0) {
      return sessionId
    }
  }
  return undefined
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildGrokProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
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
  if (apiKey) {
    // Documented headless auth: session token otherwise wins, per the
    // auth precedence (session > XAI_API_KEY; per-model key wins all).
    env.XAI_API_KEY = apiKey
  }
  // Belt and suspenders with --no-auto-update: updater checks must never
  // stall or mutate mid-turn (documented env var).
  env.GROK_DISABLE_AUTOUPDATER = "1"

  return env
}

function buildUserParts(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const parts: any[] = [{ type: "text", text: prompt }]

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

function getOrCreatePrintState(params: {
  subChatId: string
  cwd: string
  model?: string
  authConfig?: {
    apiKey: string
  }
}): GrokPrintState {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const model = params.model || null
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.model === model
  ) {
    return existing
  }

  // Fingerprint mismatch (or first run): drop the cached session so the
  // next turn starts fresh with a new client-chosen -s UUID.
  const state: GrokPrintState = {
    cwd: params.cwd,
    authFingerprint,
    model,
    sessionId: undefined,
  }
  providerSessions.set(params.subChatId, state)
  return state
}

function cleanupProvider(subChatId: string): void {
  // Print turns own their processes per-run; cleanup drops the cached
  // session id. In-flight turns die via the run's AbortController.
  providerSessions.delete(subChatId)
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

function extractDeviceCode(output: string): string | null {
  const clean = stripAnsi(output)
  for (const { pattern, strict } of DEVICE_CODE_PATTERNS) {
    const match = clean.match(pattern)
    const code = match?.[1]?.trim()
    // Guard against matching prose ("code" mentions without a value) and
    // against swallowing the login URL (codes never contain . or /).
    if (!code || code.length < 4 || /[./]/.test(code)) continue
    if (strict && !STRICT_CODE_SHAPE.test(code)) continue
    return code
  }
  return null
}

function appendLoginOutput(session: GrokLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
  if (!session.code) {
    session.code = extractDeviceCode(session.output)
  }
}

function toLoginSessionResponse(session: GrokLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    code: session.code,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): GrokLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }
  return null
}

function startLoginProcess(
  session: GrokLoginSession,
  args: string[],
  options?: { fellBackToBrowserLogin?: boolean },
): void {
  const launch = resolveGrokCliLaunch(args)
  const child = spawn(launch.command, launch.args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    windowsHide: true,
  })

  session.process = child
  session.state = "running"
  if (options?.fellBackToBrowserLogin) {
    session.fellBackToBrowserLogin = true
  }

  const handleChunk = (chunk: Buffer | string) => {
    appendLoginOutput(session, chunk.toString("utf8"))
  }

  child.stdout.on("data", handleChunk)
  child.stderr.on("data", handleChunk)

  child.once("error", (error) => {
    session.state = "error"
    session.error = `[grok] Failed to start login flow: ${error.message}`
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
      return
    }

    // Older builds may not know --device-auth: retry once as plain
    // browser login (same URL-capture flow, no code).
    if (
      !session.fellBackToBrowserLogin &&
      isGrokUnknownFlagError(`${session.output} exit ${exitCode ?? "?"}`)
    ) {
      session.output += "\n[grok] --device-auth unsupported; retrying browser login...\n"
      try {
        startLoginProcess(session, ["login"], { fellBackToBrowserLogin: true })
      } catch (error) {
        session.state = "error"
        session.error = extractGrokError(error).message
      }
      return
    }

    session.state = "error"
    session.error = session.error || `Grok login exited with code ${exitCode ?? "unknown"}`
  })
}

export const grokRouter = router({
  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const sessionId = crypto.randomUUID()
    const session: GrokLoginSession = {
      id: sessionId,
      process: null,
      state: "running",
      output: "",
      url: null,
      code: null,
      error: null,
      exitCode: null,
      fellBackToBrowserLogin: false,
    }

    // Device auth is the headless-friendly flow (prints URL + user code,
    // polls); falls back to plain browser login on older CLIs.
    startLoginProcess(session, ["login", "--device-auth"])
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
        throw new Error("Grok login session not found")
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

  getIntegration: publicProcedure.query(async () => {
    // No `status` subcommand exists: availability comes from `version`
    // (official-CLI check) and auth from credential locations. A stale
    // cached token reports connected until a turn fails; the chat flow
    // then surfaces auth-error and the login modal.
    try {
      const probe = await probeGrok()
      if (!probe.available) {
        return {
          state: "not_found" as const,
          isConnected: false,
          rawOutput: probe.detail ?? "grok CLI not found",
          exitCode: null as number | null,
        }
      }
      const auth = probeGrokAuthHome()
      return {
        state: (auth.authenticated ? "connected" : "not_logged_in") as
          | "connected"
          | "not_logged_in",
        isConnected: auth.authenticated,
        rawOutput: `${probe.version ?? ""}\n${auth.detail}`.trim(),
        exitCode: 0,
      }
    } catch (error) {
      const message = extractGrokError(error).message
      return {
        state: "unknown" as const,
        isConnected: false,
        rawOutput: message,
        exitCode: null as number | null,
      }
    }
  }),

  listModels: publicProcedure.query(async () => {
    try {
      const result = await runGrokCli(["models"], { timeoutMs: 30000 })
      if (result.exitCode !== 0) {
        const detail = [result.stdout, result.stderr]
          .filter((chunk) => chunk.trim().length > 0)
          .join("\n")
          .trim()
        return {
          models: [] as Array<{ id: string; name: string }>,
          defaultModel: null as string | null,
          error: detail || `grok models exited with code ${result.exitCode}`,
        }
      }
      return parseGrokModelsOutput(`${result.stdout}\n${result.stderr}`)
    } catch (error) {
      return {
        models: [] as Array<{ id: string; name: string }>,
        defaultModel: null as string | null,
        error: extractGrokError(error).message,
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
        mode: z.enum(["plan", "ask", "edit", "agent", "turbo"]).default("agent"),
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
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
          cleanupProvider(input.subChatId)
        }

        const abortController = new AbortController()
        activeStreams.set(input.subChatId, {
          runId: input.runId,
          controller: abortController,
          cancelRequested: false,
        })

        let isActive = true

        const safeEmit = (chunk: any) => {
          if (!isActive) return
          try {
            emit.next(normalizeCodexStreamChunk(chunk))
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
            // Native -m takes the id verbatim (no static map).
            const selectedModel = input.model?.trim() || undefined

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" &&
              extractPromptFromStoredMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
            const isAuthoritativeRun = () => {
              const currentStream = activeStreams.get(input.subChatId)
              return !currentStream || currentStream.runId === input.runId
            }

            const persistSubChatMessages = (messages: any[]) => {
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

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message

              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )

              if (cleanedParts.length === 0) {
                return null
              }

              return normalizeCodexAssistantMessage(
                {
                  ...message,
                  parts: cleanedParts,
                },
                { normalizeState: true },
              )
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { ...(selectedModel ? { model: selectedModel } : {}) },
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
              cleanupProvider(input.subChatId)
            }

            const printState = getOrCreatePrintState({
              subChatId: input.subChatId,
              cwd: input.cwd,
              model: selectedModel,
              authConfig: input.authConfig,
            })
            let latestSessionId =
              input.sessionId ?? getLastSessionId(existingMessages) ?? printState.sessionId

            const startedAt = Date.now()
            const accumulatedParts: any[] = []
            const accumulatedText: Record<string, string> = {}
            const toolPartIndexByCallId: Record<string, number> = {}

            // Error chunks are held until the turn settles: pre-run
            // failures may retry with downgraded args, and a recovered
            // turn must not have flashed a false failure. Flushed by
            // emitHeldErrorChunk once retries are exhausted.
            let heldErrorChunk: any = null
            const emitHeldErrorChunk = () => {
              if (!heldErrorChunk) return
              const chunk = heldErrorChunk
              heldErrorChunk = null
              const normalized = extractGrokError(chunk)
              if (isGrokAuthError(normalized)) {
                safeEmit({
                  ...chunk,
                  type: "auth-error",
                  errorText: normalized.message,
                })
              } else {
                safeEmit({ ...chunk, errorText: normalized.message })
              }
            }

            const handlePrintChunk = (chunk: any) => {
              if (chunk?.type === "error") {
                heldErrorChunk = chunk
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
              } else if (chunk?.type === "tool-input-available") {
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
              } else if (chunk?.type === "tool-output-available") {
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

              safeEmit(chunk)
            }

            // Images travel as prompt path references (the agent reads them
            // via tools); stage base64 attachments to temp files per turn.
            // Headless grok has no image-input flags, so this is the only
            // posture (same as the cursor backend).
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `grok-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            // First turns carry a client-chosen -s UUID: it is known even
            // when the run is interrupted before `end` (the only event
            // carrying the server-side id), so cancel-resume keeps working.
            const freshSessionId = () => crypto.randomUUID()
            const buildInvocation = (sessionId: string | undefined) =>
              buildGrokPrintArgs({
                model: selectedModel,
                mode: input.mode,
                resumeId: sessionId,
                newSessionId: sessionId ? undefined : freshSessionId(),
                cwd: input.cwd,
                prompt: promptWithImages,
              })

            let invocation = buildInvocation(latestSessionId)

            if (abortController.signal.aborted) {
              // Cancelled while staging: never spawn; the finally below
              // clears the run.
              await cleanupImageFiles()
              safeComplete()
              return
            }

            // Pre-run failures are idempotent-safe (the CLI errors before
            // doing anything), so each downgrade retries at most once:
            // stale -r ids restart as a fresh turn with a new -s uuid,
            // unknown models drop -m, and unknown flags (older `grok`
            // builds) fall back to the stable subset.
            let attemptArgs = invocation.args
            let attemptPromptFileText = invocation.promptFileText
            let resumeDropped = false
            let modelDropped = false
            let flagsDowngraded = false
            let turnResult!: Awaited<ReturnType<typeof runGrokPrintTurn>["done"]>
            let activeTurn: ReturnType<typeof runGrokPrintTurn> | null = null
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn?.interrupt()
              },
              { once: true },
            )
            try {
              for (;;) {
                const launch = resolveGrokCliLaunch(attemptArgs)
                activeTurn = runGrokPrintTurn({
                  command: launch.command,
                  args: launch.args,
                  cwd: input.cwd,
                  env: buildGrokProviderEnv(input.authConfig),
                  promptFileText: attemptPromptFileText,
                  onChunk: handlePrintChunk,
                  onSessionId: (id) => {
                    latestSessionId = id
                    printState.sessionId = id
                  },
                })
                turnResult = await activeTurn.done
                activeTurn = null
                if (turnResult.status !== "error" || abortController.signal.aborted) {
                  break
                }
                if (
                  !resumeDropped &&
                  latestSessionId &&
                  isGrokResumeError(turnResult.errorMessage)
                ) {
                  // Stale session id (session deleted or expired): retry
                  // once as a fresh turn with a new client UUID.
                  resumeDropped = true
                  heldErrorChunk = null
                  latestSessionId = undefined
                  printState.sessionId = undefined
                  invocation = buildInvocation(undefined)
                  attemptArgs = invocation.args
                  attemptPromptFileText = invocation.promptFileText
                  continue
                }
                if (
                  !modelDropped &&
                  selectedModel &&
                  isGrokInvalidModelError(turnResult.errorMessage)
                ) {
                  // Stale/unknown model slug (model list drifted): retry
                  // once with the CLI default model.
                  modelDropped = true
                  heldErrorChunk = null
                  invocation = buildGrokPrintArgs({
                    mode: input.mode,
                    resumeId: latestSessionId,
                    newSessionId: latestSessionId ? undefined : freshSessionId(),
                    cwd: input.cwd,
                    prompt: promptWithImages,
                  })
                  attemptArgs = invocation.args
                  attemptPromptFileText = invocation.promptFileText
                  continue
                }
                if (!flagsDowngraded && isGrokUnknownFlagError(turnResult.errorMessage)) {
                  flagsDowngraded = true
                  heldErrorChunk = null
                  // Ancient builds: prompt-file is rewritten to inline -p.
                  attemptArgs = buildGrokPrintFallbackArgs(attemptArgs, promptWithImages)
                  attemptPromptFileText = undefined
                  continue
                }
                break
              }
            } finally {
              await cleanupImageFiles()
            }
            emitHeldErrorChunk()

            const finishMetadata = {
              ...(selectedModel ? { model: selectedModel } : {}),
              sessionId: latestSessionId,
              durationMs: turnResult.durationMs,
              // Mirror the sibling routers: only true errors fail; user
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
                metadata: finishMetadata,
              }
              const cleanedResponseMessage = cleanAssistantMessageForPersistence(responseMessage)

              if (!cleanedResponseMessage) {
                persistSubChatMessages(messagesForStream)
              } else {
                persistSubChatMessages([...messagesForStream, cleanedResponseMessage])
              }
            } catch (error) {
              console.error("[grok] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractGrokError(error)

            console.error("[grok] chat stream error:", error)
            if (isGrokAuthError(normalized)) {
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
                cleanupProvider(input.subChatId)
              }
              activeStreams.delete(input.subChatId)
            }
          }
        })()

        return () => {
          isActive = false
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

  cleanup: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    cleanupProvider(input.subChatId)

    const activeStream = activeStreams.get(input.subChatId)
    if (activeStream) {
      activeStream.controller.abort()
      activeStreams.delete(input.subChatId)
    }

    return { success: true }
  }),

  getAllMcpConfig: publicProcedure.query(async () => {
    try {
      return await getAllGrokMcpConfigHandler()
    } catch (error) {
      console.error("[grok.getAllMcpConfig] Error:", error)
      return {
        groups: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }),

  getMcpConfig: publicProcedure
    .input(z.object({ projectPath: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const group = await getGrokMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[grok.getMcpConfig] Error:", error)
        return {
          groups: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearGrokMcpCache()
    return { success: true }
  }),
})

type ParsedGrokModels = {
  models: Array<{ id: string; name: string }>
  defaultModel: string | null
  error: string | null
}

/**
 * Defensive parse of `grok models` output. The exact shape is not pinned
 * by the docs: accept JSON (array / {models} envelope) or line-oriented
 * text (first slug-like token per line, headers skipped).
 */
function parseGrokModelsOutput(combinedOutput: string): ParsedGrokModels {
  const text = combinedOutput.trim()
  if (!text) return { models: [], defaultModel: null, error: "empty output" }
  if (
    /unknown (command|subcommand)|unrecognized (command|subcommand)|invalid (command|subcommand)|no such command/i.test(
      text,
    )
  ) {
    return {
      models: [],
      defaultModel: null,
      error: text.slice(0, 500),
    }
  }

  const fromEntries = (entries: unknown, defaultModel: unknown): ParsedGrokModels | null => {
    if (!Array.isArray(entries)) return null
    const models: Array<{ id: string; name: string }> = []
    for (const entry of entries) {
      if (typeof entry === "string" && entry.trim()) {
        models.push({ id: entry.trim(), name: entry.trim() })
      } else if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>
        const id =
          typeof record.id === "string"
            ? record.id
            : typeof record.name === "string"
              ? record.name
              : typeof record.slug === "string"
                ? record.slug
                : null
        if (id?.trim()) {
          const name =
            typeof record.name === "string" && record.name.trim() ? record.name.trim() : id.trim()
          models.push({ id: id.trim(), name })
        }
      }
    }
    if (models.length === 0) return null
    return {
      models,
      defaultModel:
        typeof defaultModel === "string" && defaultModel.trim() ? defaultModel.trim() : null,
      error: null,
    }
  }

  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return (
        fromEntries(parsed, null) ?? {
          models: [],
          defaultModel: null,
          error: "no models in output",
        }
      )
    }
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>
      for (const key of ["models", "available", "data"]) {
        const parsedModels = fromEntries(record[key], record.default ?? record.defaultModel)
        if (parsedModels) return parsedModels
      }
    }
  } catch {
    // Not JSON: fall through to line parsing.
  }

  const models: Array<{ id: string; name: string }> = []
  let defaultModel: string | null = null
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const lowered = line.toLowerCase()
    if (
      lowered.startsWith("available") ||
      lowered.startsWith("models") ||
      lowered.startsWith("default:") ||
      lowered.startsWith("name") ||
      lowered.startsWith("id") ||
      /^[─═*#>|-]/.test(line)
    ) {
      const defaultMatch = line.match(/default\s*[:=]\s*([\w][\w.-]*)/i)
      if (defaultMatch?.[1]) defaultModel = defaultMatch[1]
      continue
    }
    const token = line.split(/\s+/)[0] ?? ""
    const cleaned = token.replace(/^[*>\-•]+\s*/, "").replace(/[,;:*]+$/, "")
    if (/^[A-Za-z0-9][\w.-]*$/.test(cleaned)) {
      const isDefault = /\bdefault\b/i.test(line) || /^[*]/.test(rawLine.trim())
      if (isDefault && !defaultModel) defaultModel = cleaned
      models.push({ id: cleaned, name: cleaned })
    }
  }
  // Dedupe while preserving order (headers/footers can repeat slugs).
  const seen = new Set<string>()
  const deduped = models.filter((model) => {
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
  return {
    models: deduped,
    defaultModel,
    error: deduped.length > 0 ? null : "no models in output",
  }
}
