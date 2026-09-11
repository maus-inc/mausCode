/**
 * NOTE (transplant): Cursor CLI provider router: login, chat, cancel, cleanup, MCP.
 * Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
 * UPGRADED (mausCode 2026-09-11): chat transport replaced ACP with native
 * `agent -p --output-format stream-json` print turns; login + MCP kept.
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
import { resolveCursorAgentCliLaunch, resolveCursorAgentLaunch } from "../../cursor-agent-binary"
import {
  clearCursorMcpCache,
  getAllCursorMcpConfigHandler,
  getCursorMcpConfigForProject,
} from "../../cursor-mcp"
import {
  buildCursorPrintArgs,
  buildCursorPrintFallbackArgs,
  isCursorInvalidModelError,
  isCursorResumeError,
  isCursorUnknownFlagError,
} from "../../cursor-print/args"
import { runCursorPrintTurn } from "../../cursor-print/session"
import { getDatabase, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type CursorPrintState = {
  cwd: string
  authFingerprint: string | null
  model: string | null
  threadId: string | undefined
}

type ActiveCursorStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const providerSessions = new Map<string, CursorPrintState>()
const activeStreams = new Map<string, ActiveCursorStream>()

type CursorLoginSessionState = "running" | "success" | "error" | "cancelled"

type CursorLoginSession = {
  id: string
  process: ChildProcess | null
  state: CursorLoginSessionState
  output: string
  url: string | null
  error: string | null
  exitCode: number | null
}

const loginSessions = new Map<string, CursorLoginSession>()

const URL_CANDIDATE_REGEX = /https?:\/\/[^\s]+/g
const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
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
  "agent login",
  "cursor_api_key",
  "401",
  "403",
]

export function hasActiveCursorStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllCursorStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[cursor] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function extractCursorError(error: unknown): { message: string; code?: string } {
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

function isCursorAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

async function runCursorCli(
  args: string[],
  options?: { cwd?: string },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const launch = resolveCursorAgentCliLaunch(args)
  const cwd = options?.cwd?.trim()

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
      rejectPromise(new Error(`[cursor] Timed out executing \`agent ${args.join(" ")}\` after 15s`))
    }, 15000)
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
        new Error(`[cursor] Failed to execute \`agent ${args.join(" ")}\`: ${error.message}`),
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

function buildCursorProviderEnv(authConfig?: { apiKey: string }): Record<string, string> {
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
    env.CURSOR_API_KEY = apiKey
  }

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
}): CursorPrintState {
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

  // Fingerprint mismatch (or first run): drop the cached thread so the next
  // turn starts fresh. MCP needs no fingerprint: every print turn spawns a
  // fresh process that re-reads mcp.json.
  const state: CursorPrintState = {
    cwd: params.cwd,
    authFingerprint,
    model,
    threadId: undefined,
  }
  providerSessions.set(params.subChatId, state)
  return state
}

function cleanupProvider(subChatId: string): void {
  // Print turns own their processes per-run; cleanup drops the cached
  // thread id. In-flight turns die via the run's AbortController.
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

function appendLoginOutput(session: CursorLoginSession, chunk: string): void {
  const cleanChunk = stripAnsi(chunk)
  if (!cleanChunk) return

  session.output += cleanChunk

  if (!session.url) {
    session.url = extractFirstNonLocalhostUrl(session.output)
  }
}

function toLoginSessionResponse(session: CursorLoginSession) {
  return {
    sessionId: session.id,
    state: session.state,
    url: session.url,
    output: session.output,
    error: session.error,
    exitCode: session.exitCode,
  }
}

function getActiveLoginSession(): CursorLoginSession | null {
  for (const session of loginSessions.values()) {
    if (session.state === "running" && session.process && !session.process.killed) {
      return session
    }
  }
  return null
}

function normalizeCursorIntegrationState(rawOutput: string): {
  state: "connected" | "not_logged_in" | "unknown"
  isConnected: boolean
} {
  const normalized = rawOutput.toLowerCase()

  // Negative markers first: several contain positive phrases as substrings
  // ("not signed in" contains "signed in").
  if (
    normalized.includes("not logged in") ||
    normalized.includes("not authenticated") ||
    normalized.includes("not_authenticated") ||
    normalized.includes("not signed in") ||
    normalized.includes("logged out") ||
    normalized.includes("signed out") ||
    normalized.includes("authentication required") ||
    normalized.includes("run 'agent login'") ||
    normalized.includes("run `agent login`")
  ) {
    return { state: "not_logged_in", isConnected: false }
  }

  // `status` displays account information when authenticated (per the CLI
  // auth docs), so an email address in clean output is positive evidence
  // even if the exact status wording drifts.
  if (
    normalized.includes("logged in") ||
    normalized.includes("authenticated") ||
    normalized.includes("signed in") ||
    /[\w.+-]+@[\w-]+\.[\w.]+/.test(rawOutput)
  ) {
    return { state: "connected", isConnected: true }
  }

  return { state: "unknown", isConnected: false }
}

export const cursorRouter = router({
  startLogin: publicProcedure.mutation(() => {
    const existingSession = getActiveLoginSession()
    if (existingSession) {
      return toLoginSessionResponse(existingSession)
    }

    const launch = resolveCursorAgentCliLaunch(["login"])
    const sessionId = crypto.randomUUID()

    const child = spawn(launch.command, launch.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
      windowsHide: true,
    })

    const session: CursorLoginSession = {
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
      session.error = `[cursor] Failed to start login flow: ${error.message}`
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
        session.error = session.error || `Cursor login exited with code ${exitCode ?? "unknown"}`
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
        throw new Error("Cursor login session not found")
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
    try {
      const result = await runCursorCli(["status"])
      const combinedOutput = [result.stdout, result.stderr]
        .filter((chunk) => chunk.trim().length > 0)
        .join("\n")
        .trim()

      const { state, isConnected } = normalizeCursorIntegrationState(combinedOutput)

      return {
        state,
        isConnected,
        rawOutput: combinedOutput,
        exitCode: result.exitCode,
      }
    } catch (error) {
      const message = extractCursorError(error).message
      const { state, isConnected } = normalizeCursorIntegrationState(message)
      return {
        state,
        isConnected,
        rawOutput: message,
        exitCode: null,
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
            // Native --model takes the id verbatim (no static map).
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
              input.sessionId ?? getLastSessionId(existingMessages) ?? printState.threadId

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
              const normalized = extractCursorError(chunk)
              if (isCursorAuthError(normalized)) {
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
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `cursor-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            const invocation = buildCursorPrintArgs({
              model: selectedModel,
              mode: input.mode,
              resumeId: latestSessionId,
              prompt: promptWithImages,
            })

            if (abortController.signal.aborted) {
              // Cancelled while staging: never spawn; the finally below
              // clears the run.
              await cleanupImageFiles()
              safeComplete()
              return
            }

            // Pre-run failures are idempotent-safe (the CLI errors before
            // doing anything), so each downgrade retries at most once:
            // stale --resume ids restart as a fresh turn, and unknown
            // flags (older `agent` builds) fall back to the stable subset.
            let attemptArgs = invocation.args
            let resumeDropped = false
            let modelDropped = false
            let flagsDowngraded = false
            let turnResult!: Awaited<ReturnType<typeof runCursorPrintTurn>["done"]>
            let activeTurn: ReturnType<typeof runCursorPrintTurn> | null = null
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn?.interrupt()
              },
              { once: true },
            )
            try {
              for (;;) {
                const launch = resolveCursorAgentCliLaunch(attemptArgs)
                activeTurn = runCursorPrintTurn({
                  command: launch.command,
                  args: launch.args,
                  cwd: input.cwd,
                  env: buildCursorProviderEnv(input.authConfig),
                  stdinText: invocation.stdinText,
                  onChunk: handlePrintChunk,
                  onSessionId: (id) => {
                    latestSessionId = id
                    printState.threadId = id
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
                  isCursorResumeError(turnResult.errorMessage)
                ) {
                  // Stale thread id (chat deleted, cache cleared, or another
                  // machine): retry once as a fresh turn.
                  resumeDropped = true
                  heldErrorChunk = null
                  latestSessionId = undefined
                  printState.threadId = undefined
                  attemptArgs = buildCursorPrintArgs({
                    model: selectedModel,
                    mode: input.mode,
                    prompt: promptWithImages,
                  }).args
                  continue
                }
                if (
                  !modelDropped &&
                  selectedModel &&
                  isCursorInvalidModelError(turnResult.errorMessage)
                ) {
                  // Stale/unknown model slug (model list drifted): retry
                  // once with the CLI default model.
                  modelDropped = true
                  heldErrorChunk = null
                  attemptArgs = buildCursorPrintArgs({
                    mode: input.mode,
                    resumeId: latestSessionId,
                    prompt: promptWithImages,
                  }).args
                  continue
                }
                if (!flagsDowngraded && isCursorUnknownFlagError(turnResult.errorMessage)) {
                  flagsDowngraded = true
                  heldErrorChunk = null
                  attemptArgs = buildCursorPrintFallbackArgs({
                    args: attemptArgs,
                    stdinText: invocation.stdinText,
                  })
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
              console.error("[cursor] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractCursorError(error)

            console.error("[cursor] chat stream error:", error)
            if (isCursorAuthError(normalized)) {
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
      return await getAllCursorMcpConfigHandler()
    } catch (error) {
      console.error("[cursor.getAllMcpConfig] Error:", error)
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
        const group = await getCursorMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[cursor.getMcpConfig] Error:", error)
        return {
          groups: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    clearCursorMcpCache()
    return { success: true }
  }),
})
