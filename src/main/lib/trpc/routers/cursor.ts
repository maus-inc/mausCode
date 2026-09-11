/**
 * NOTE (transplant): Cursor CLI provider router: login, chat, cancel, cleanup, MCP.
 * Source: SamSammane/1code-ui (Apache-2.0), commits 51b79a5 + 12f0676.
 */
import { createACPProvider, type ACPProvider } from "@mcpc-tech/acp-ai-provider"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import {
  DEFAULT_CURSOR_UI_MODEL,
  pickCursorModelForSession,
  resolveCursorAcpModelId,
} from "../../../../shared/cursor-model-id"
import { getClaudeShellEnvironment } from "../../claude/env"
import {
  clearCursorMcpCache,
  getAllCursorMcpConfigHandler,
  getCursorMcpConfigForProject,
} from "../../cursor-mcp"
import {
  resolveCursorAgentCliLaunch,
  resolveCursorAgentLaunch,
} from "../../cursor-agent-binary"
import { getDatabase, subChats } from "../../db"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type CursorProviderSession = {
  provider: ACPProvider
  cwd: string
  authFingerprint: string | null
}

type ActiveCursorStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const providerSessions = new Map<string, CursorProviderSession>()
const activeStreams = new Map<string, ActiveCursorStream>()

type CursorLoginSessionState =
  | "running"
  | "success"
  | "error"
  | "cancelled"

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

function isCursorAuthError(params: {
  message?: string | null
  code?: string | null
}): boolean {
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
        new Error(
          `[cursor] Failed to execute \`agent ${args.join(" ")}\`: ${error.message}`,
        ),
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

function buildCursorProviderEnv(authConfig?: {
  apiKey: string
}): Record<string, string> {
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

function getCursorAuthMethodId(authConfig?: {
  apiKey: string
}): string | undefined {
  if (authConfig?.apiKey?.trim()) {
    return undefined
  }
  return "cursor_login"
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

function buildModelMessageContent(
  prompt: string,
  images:
    | Array<{
        base64Data?: string
        mediaType?: string
        filename?: string
      }>
    | undefined,
): any[] {
  const content: any[] = [{ type: "text", text: prompt }]

  if (images && images.length > 0) {
    for (const image of images) {
      if (!image.base64Data || !image.mediaType) continue
      content.push({
        type: "file",
        mediaType: image.mediaType,
        data: image.base64Data,
        ...(image.filename ? { filename: image.filename } : {}),
      })
    }
  }

  return content
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  existingSessionId?: string
  authConfig?: {
    apiKey: string
  }
}): ACPProvider {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const hasAppManagedApiKey = Boolean(params.authConfig?.apiKey?.trim())
  const existingSessionIdForProvider = hasAppManagedApiKey
    ? undefined
    : params.existingSessionId

  const launch = resolveCursorAgentLaunch()

  const provider = createACPProvider({
    command: launch.command,
    ...(launch.args.length > 0 ? { args: launch.args } : {}),
    env: buildCursorProviderEnv(params.authConfig),
    authMethodId: getCursorAuthMethodId(params.authConfig),
    session: {
      cwd: params.cwd,
      mcpServers: [],
    },
    ...(existingSessionIdForProvider
      ? { existingSessionId: existingSessionIdForProvider }
      : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    authFingerprint,
  })

  return provider
}

function cleanupProvider(subChatId: string): void {
  const existing = providerSessions.get(subChatId)
  if (!existing) return

  existing.provider.cleanup()
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

  if (
    normalized.includes("not logged in") ||
    normalized.includes("authentication required") ||
    normalized.includes("run 'agent login'") ||
    normalized.includes("run `agent login`")
  ) {
    return { state: "not_logged_in", isConnected: false }
  }

  if (normalized.includes("logged in")) {
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
        session.error =
          session.error || `Cursor login exited with code ${exitCode ?? "unknown"}`
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
      const result = await runCursorCli(["whoami"])
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
            const uiModelId = input.model?.trim() || DEFAULT_CURSOR_UI_MODEL
            const metadataModel = uiModelId

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
              cleanupProvider(input.subChatId)
            }

            const provider = getOrCreateProvider({
              subChatId: input.subChatId,
              cwd: input.cwd,
              existingSessionId:
                input.forceNewSession
                  ? undefined
                  : input.sessionId ?? getLastSessionId(existingMessages),
              authConfig: input.authConfig,
            })

            let acpModelId = resolveCursorAcpModelId(uiModelId)
            try {
              const sessionInfo = await provider.initSession()
              const available =
                sessionInfo?.models?.availableModels?.map((m) => m.modelId) ?? []
              acpModelId = pickCursorModelForSession(uiModelId, sessionInfo?.models ?? undefined)

              if (available.length > 0) {
                try {
                  await provider.setModel(acpModelId)
                } catch (setModelError) {
                  const fallback =
                    sessionInfo?.models?.currentModelId ?? available[0]!
                  console.warn(
                    `[cursor] setModel("${acpModelId}") failed, using "${fallback}"`,
                    setModelError,
                  )
                  acpModelId = fallback
                  await provider.setModel(acpModelId)
                }
              }

              console.log(
                `[cursor] model ui="${uiModelId}" acp="${acpModelId}" available=[${available.join(", ")}]`,
              )
            } catch (sessionError) {
              console.warn(
                `[cursor] session init / model resolution failed, using static map for "${uiModelId}"`,
                sessionError,
              )
              acpModelId = resolveCursorAcpModelId(uiModelId)
            }

            const startedAt = Date.now()
            let latestSessionId =
              provider.getSessionId() ||
              input.sessionId ||
              getLastSessionId(existingMessages)

            const result = streamText({
              model: provider.languageModel(acpModelId),
              messages: [
                {
                  role: "user",
                  content: buildModelMessageContent(input.prompt, input.images),
                },
              ],
              tools: provider.tools,
              abortSignal: abortController.signal,
            })

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                const sessionId = provider.getSessionId() || undefined
                if (sessionId) {
                  latestSessionId = sessionId
                }

                if (part.type === "finish") {
                  return {
                    model: metadataModel,
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype: part.finishReason === "error" ? "error" : "success",
                  }
                }

                if (sessionId) {
                  return {
                    model: metadataModel,
                    sessionId,
                  }
                }

                return { model: metadataModel }
              },
              onFinish: async ({ responseMessage, isContinuation }) => {
                try {
                  const cleanedResponseMessage =
                    cleanAssistantMessageForPersistence(responseMessage)

                  if (!cleanedResponseMessage) {
                    persistSubChatMessages(messagesForStream)
                    return
                  }

                  const messagesToPersist = [
                    ...(isContinuation
                      ? messagesForStream.slice(0, -1)
                      : messagesForStream),
                    cleanedResponseMessage,
                  ]

                  persistSubChatMessages(messagesToPersist)
                } catch (error) {
                  console.error("[cursor] Failed to persist messages:", error)
                }
              },
              onError: (error) => extractCursorError(error).message,
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                const normalized = extractCursorError(value)

                if (isCursorAuthError(normalized)) {
                  safeEmit({ ...value, type: "auth-error", errorText: normalized.message })
                } else {
                  safeEmit({ ...value, errorText: normalized.message })
                }
                continue
              }

              if (value?.type === "finish") {
                pendingFinishChunk = value
                continue
              }

              safeEmit(value)
            }

            if (pendingFinishChunk) {
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
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

  cleanup: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(({ input }) => {
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
