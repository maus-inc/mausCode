/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/ci/research/fork-network-harvest-catalog.md.
 */
import { createACPProvider, type ACPProvider } from "@mcpc-tech/acp-ai-provider"
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, subChats } from "../../db"
import {
  clearGeminiApiKey,
  getGeminiAuthStatus,
  loadGeminiApiKey,
  saveGeminiApiKey,
  type GeminiAuthStatus,
} from "../../gemini-auth-store"
import { appendGeminiUsage } from "../../gemini-usage"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type ActiveGeminiStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

type GeminiProviderSession = {
  provider: ACPProvider
  cwd: string
  binaryPath: string
  modelId: string
}

const activeStreams = new Map<string, ActiveGeminiStream>()
const providerSessions = new Map<string, GeminiProviderSession>()

const COMMON_GEMINI_BINARY_PATHS = [
  "/opt/homebrew/bin/gemini",
  "/usr/local/bin/gemini",
  join(homedir(), ".local/bin/gemini"),
  join(homedir(), ".npm-global/bin/gemini"),
]

let cachedGeminiBinaryPath: string | null = null

function resolveGeminiBinaryPath(): string | null {
  if (cachedGeminiBinaryPath && existsSync(cachedGeminiBinaryPath)) {
    return cachedGeminiBinaryPath
  }

  const binaryName = process.platform === "win32" ? "gemini.exe" : "gemini"

  try {
    const shellEnv = getClaudeShellEnvironment()
    const pathEnv = shellEnv.PATH || process.env.PATH || ""
    for (const dir of pathEnv.split(delimiter)) {
      if (!dir) continue
      const candidate = join(dir, binaryName)
      if (existsSync(candidate)) {
        cachedGeminiBinaryPath = candidate
        return candidate
      }
    }
  } catch {
    // fall through to common paths
  }

  for (const candidate of COMMON_GEMINI_BINARY_PATHS) {
    if (existsSync(candidate)) {
      cachedGeminiBinaryPath = candidate
      return candidate
    }
  }

  return null
}

function buildGeminiSpawnEnv(): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value
  }

  try {
    // Prefer the user's login-shell environment so Gemini can find Homebrew,
    // npm, rg, and MCP dependencies when the app is launched from Finder.
    const shellEnv = getClaudeShellEnvironment()
    for (const [key, value] of Object.entries(shellEnv)) {
      if (typeof value === "string") env[key] = value
    }
  } catch {
    // process.env was already copied above
  }

  return env
}

function getOrCreateProvider(params: {
  subChatId: string
  cwd: string
  binaryPath: string
  modelId: string
  existingSessionId?: string
}): ACPProvider {
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.binaryPath === params.binaryPath &&
    existing.modelId === params.modelId
  ) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const provider = createACPProvider({
    command: params.binaryPath,
    args: ["--acp"],
    env: buildGeminiSpawnEnv(),
    authMethodId: "oauth-personal",
    session: {
      cwd: params.cwd,
      mcpServers: [],
    },
    ...(params.existingSessionId
      ? { existingSessionId: params.existingSessionId }
      : {}),
    persistSession: true,
  })

  providerSessions.set(params.subChatId, {
    provider,
    cwd: params.cwd,
    binaryPath: params.binaryPath,
    modelId: params.modelId,
  })

  return provider
}

function cleanupProvider(subChatId: string): void {
  const existing = providerSessions.get(subChatId)
  if (!existing) return
  existing.provider.cleanup()
  providerSessions.delete(subChatId)
}

export function hasActiveGeminiStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllGeminiStreams(): void {
  for (const stream of activeStreams.values()) {
    stream.controller.abort()
  }
  activeStreams.clear()
  for (const subChatId of [...providerSessions.keys()]) {
    cleanupProvider(subChatId)
  }
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
  if (!message || !Array.isArray(message.parts)) return ""

  const textParts: string[] = []
  const fileContents: string[] = []

  for (const part of message.parts) {
    if (part?.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
    } else if (part?.type === "file-content") {
      const filePath =
        typeof part.filePath === "string" ? part.filePath : undefined
      const fileName = filePath?.split("/").pop() || filePath || "file"
      const content = typeof part.content === "string" ? part.content : ""
      fileContents.push(`\n--- ${fileName} ---\n${content}`)
    }
  }

  return textParts.join("\n") + fileContents.join("")
}

function getLastSessionId(messages: any[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const meta = messages[i]?.metadata
    if (meta && typeof meta.sessionId === "string" && meta.sessionId) {
      return meta.sessionId
    }
  }
  return undefined
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

const GEMINI_CAPACITY_ERROR_PATTERN =
  /MODEL_CAPACITY_EXHAUSTED|No capacity available for model|RESOURCE_EXHAUSTED/i

function isGeminiCapacityError(rawMessage: string): boolean {
  return GEMINI_CAPACITY_ERROR_PATTERN.test(rawMessage)
}

function getGeminiFallbackModelIds(modelId: string): string[] {
  const fallbackByModel: Record<string, string[]> = {
    "gemini-2.5-pro": [
      "auto-gemini-2.5",
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "auto-gemini-3",
      "gemini-3-flash-preview",
    ],
    "gemini-3.1-pro-preview": [
      "auto-gemini-3",
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "auto-gemini-2.5",
      "gemini-2.5-flash",
    ],
    "auto-gemini-3": [
      "gemini-3-flash-preview",
      "gemini-3.1-flash-lite-preview",
      "auto-gemini-2.5",
      "gemini-2.5-flash",
    ],
    "auto-gemini-2.5": [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "auto-gemini-3",
      "gemini-3-flash-preview",
    ],
    "gemini-2.5-flash": [
      "gemini-2.5-flash-lite",
      "auto-gemini-2.5",
      "auto-gemini-3",
    ],
    "gemini-3-flash-preview": [
      "gemini-3.1-flash-lite-preview",
      "auto-gemini-3",
      "auto-gemini-2.5",
    ],
  }

  const fallbacks = fallbackByModel[modelId] ?? [
    "auto-gemini-3",
    "auto-gemini-2.5",
    "gemini-2.5-flash",
  ]

  return [...new Set(fallbacks.filter((fallback) => fallback !== modelId))]
}

function getGeminiPrimaryModelId(modelId: string): string {
  // Gemini CLI can spend a long time internally retrying Pro models after a
  // capacity 429. Use the CLI's auto aliases first so it can pick a live model.
  const primaryByModel: Record<string, string> = {
    "gemini-3.1-pro-preview": "auto-gemini-3",
    "gemini-2.5-pro": "auto-gemini-2.5",
  }

  return primaryByModel[modelId] ?? modelId
}

function humanizeGeminiError(rawMessage: string, triedModels?: string[]): string {
  if (!rawMessage) return "Stream failed"

  if (isGeminiCapacityError(rawMessage)) {
    const modelMatch = rawMessage.match(/model ([\w.-]+)/i)
    const which = modelMatch ? `"${modelMatch[1]}"` : "this Gemini model"
    const tried = triedModels?.length
      ? ` Tried: ${triedModels.join(", ")}.`
      : ""
    return `Google is currently at capacity for ${which}.${tried} Try an Auto or Flash Gemini model, or retry in a few minutes.`
  }

  if (/EPIPE|stream prematurely closed|aborted/i.test(rawMessage)) {
    return "Gemini CLI connection was lost. Pick a different model or retry."
  }

  if (/quota|rate ?limit/i.test(rawMessage)) {
    return `Gemini quota/rate limit hit: ${rawMessage}`
  }

  return rawMessage
}

function isGeminiPreludeChunk(chunk: any): boolean {
  return (
    chunk?.type === "start" ||
    chunk?.type === "start-step" ||
    chunk?.type === "message-metadata"
  )
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

export const geminiRouter = router({
  getAuthStatus: publicProcedure.query((): GeminiAuthStatus => {
    return getGeminiAuthStatus()
  }),

  getCliStatus: publicProcedure.query(() => {
    const binaryPath = resolveGeminiBinaryPath()
    const geminiHome = join(homedir(), ".gemini")
    const homeExists = existsSync(geminiHome)
    const hasOauthCreds = existsSync(join(geminiHome, "oauth_creds.json"))
    const hasStoredApiKey = Boolean(loadGeminiApiKey())
    return {
      installed: Boolean(binaryPath),
      binaryPath,
      loggedIn: hasOauthCreds || hasStoredApiKey,
      authSource: hasOauthCreds
        ? ("oauth" as const)
        : hasStoredApiKey
          ? ("api-key" as const)
          : null,
      geminiHome: homeExists ? geminiHome : null,
    }
  }),

  setApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(({ input }) => {
      saveGeminiApiKey(input.apiKey)
      return getGeminiAuthStatus()
    }),

  clearApiKey: publicProcedure.mutation(() => {
    clearGeminiApiKey()
    return getGeminiAuthStatus()
  }),

  testApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const provider = createGoogleGenerativeAI({ apiKey: input.apiKey })
        const model = provider("gemini-2.0-flash-lite")
        const result = streamText({
          model,
          messages: [{ role: "user", content: "ping" }],
          maxOutputTokens: 4,
        })
        for await (const _ of result.textStream) {
          break
        }
        await result.finishReason
        return { ok: true as const }
      } catch (error) {
        return {
          ok: false as const,
          error:
            error instanceof Error ? error.message : "Unable to validate key",
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
        modelId: z.string().min(1),
        cwd: z.string().optional(),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
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
            // ignore double completion
          }
        }

        ;(async () => {
          try {
            const binaryPath = resolveGeminiBinaryPath()
            if (!binaryPath) {
              safeEmit({
                type: "error",
                errorText:
                  "Gemini CLI not found. Install it with `npm install -g @google/gemini-cli` (or `brew install gemini-cli`) and run `gemini` once to log in.",
              })
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }

            const db = getDatabase()
            const existingSubChat = db
              .select()
              .from(subChats)
              .where(eq(subChats.id, input.subChatId))
              .get()

            if (!existingSubChat) {
              throw new Error("Sub-chat not found")
            }

            const existingMessages = parseStoredMessages(
              existingSubChat.messages,
            )

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
              if (!isAuthoritativeRun()) return false
              db.update(subChats)
                .set({
                  messages: JSON.stringify(messages),
                  updatedAt: new Date(),
                })
                .where(eq(subChats.id, input.subChatId))
                .run()
              return true
            }

            if (!isDuplicatePrompt) {
              const userMessage = {
                id: crypto.randomUUID(),
                role: "user",
                parts: buildUserParts(input.prompt, input.images),
                metadata: { model: input.modelId },
              }
              messagesForStream = [...existingMessages, userMessage]
              persistSubChatMessages(messagesForStream)
            }

            if (input.forceNewSession) {
              cleanupProvider(input.subChatId)
            }

            const cwd = input.cwd && input.cwd.trim() ? input.cwd : process.cwd()

            const startedAt = Date.now()
            let providerSessionIdForResume =
              input.forceNewSession
                ? undefined
                : input.sessionId ?? getLastSessionId(existingMessages)
            let latestSessionId =
              providerSessionIdForResume || randomUUID()

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message
              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )
              if (cleanedParts.length === 0) return null
              return { ...message, parts: cleanedParts }
            }

            const streamWithModel = async (
              modelId: string,
            ): Promise<{
              ok: boolean
              errorText?: string
              capacityError?: boolean
              emittedContent?: boolean
            }> => {
              const provider = getOrCreateProvider({
                subChatId: input.subChatId,
                cwd,
                binaryPath,
                modelId,
                existingSessionId: providerSessionIdForResume,
              })

              const activeProviderSessionId = provider.getSessionId()
              if (activeProviderSessionId) {
                latestSessionId = activeProviderSessionId
                providerSessionIdForResume = activeProviderSessionId
              }
              const model = provider.languageModel(modelId)
              const result = streamText({
                model,
                messages: [
                  {
                    role: "user",
                    content: buildModelMessageContent(
                      input.prompt,
                      input.images,
                    ),
                  },
                ],
                tools: provider.tools,
                abortSignal: abortController.signal,
              })

              const uiStream = result.toUIMessageStream({
                originalMessages: messagesForStream,
                generateMessageId: () => crypto.randomUUID(),
                messageMetadata: ({ part }) => {
                  const sessionId = provider.getSessionId() || latestSessionId
                  if (sessionId) latestSessionId = sessionId

                  const baseMetadata = {
                    model: modelId,
                    sessionId,
                    ...(modelId !== input.modelId
                      ? { requestedModel: input.modelId }
                      : {}),
                  }

                  if (part.type === "finish") {
                    return {
                      ...baseMetadata,
                      durationMs: Date.now() - startedAt,
                      resultSubtype:
                        part.finishReason === "error" ? "error" : "success",
                    }
                  }
                  return baseMetadata
                },
                onFinish: async ({ responseMessage, isContinuation }) => {
                  try {
                    const cleaned =
                      cleanAssistantMessageForPersistence(responseMessage)
                    if (!cleaned) {
                      persistSubChatMessages(messagesForStream)
                      return
                    }
                    const messagesToPersist = [
                      ...(isContinuation
                        ? messagesForStream.slice(0, -1)
                        : messagesForStream),
                      cleaned,
                    ]
                    persistSubChatMessages(messagesToPersist)
                  } catch (error) {
                    console.error(
                      "[gemini] Failed to persist messages:",
                      error,
                    )
                  }
                },
                onError: (error) =>
                  error instanceof Error
                    ? error.message
                    : String(error ?? "Stream failed"),
              })

              const reader = uiStream.getReader()
              let pendingFinishChunk: any | null = null
              let emittedContent = false
              const preludeChunks: any[] = []
              const flushPrelude = () => {
                for (const chunk of preludeChunks) {
                  safeEmit(chunk)
                }
                preludeChunks.length = 0
              }

              while (true) {
                const { done, value } = await reader.read()
                if (done) break

                if (value?.type === "error") {
                  const rawText =
                    typeof (value as any).errorText === "string"
                      ? (value as any).errorText
                      : "Stream failed"
                  const capacityError = isGeminiCapacityError(rawText)

                  if (capacityError && !emittedContent) {
                    const sessionId = provider.getSessionId()
                    if (sessionId) {
                      latestSessionId = sessionId
                      providerSessionIdForResume = sessionId
                    }
                    return {
                      ok: false,
                      errorText: rawText,
                      capacityError: true,
                      emittedContent: false,
                    }
                  }

                  flushPrelude()
                  safeEmit({
                    ...value,
                    errorText: humanizeGeminiError(rawText),
                  })
                  return {
                    ok: false,
                    errorText: rawText,
                    capacityError,
                    emittedContent: true,
                  }
                }

                if (value?.type === "finish") {
                  pendingFinishChunk = value
                  continue
                }

                if (!emittedContent && isGeminiPreludeChunk(value)) {
                  preludeChunks.push(value)
                  continue
                }

                flushPrelude()
                emittedContent = true
                safeEmit(value)
              }

              flushPrelude()

              const sessionId = provider.getSessionId()
              if (sessionId) {
                latestSessionId = sessionId
                providerSessionIdForResume = sessionId
              }

              try {
                const usage = await result.usage
                const inputTokens = usage?.inputTokens ?? 0
                const outputTokens = usage?.outputTokens ?? 0
                const totalTokens =
                  usage?.totalTokens ?? inputTokens + outputTokens

                if (inputTokens || outputTokens) {
                  try {
                    await appendGeminiUsage({
                      sessionId: latestSessionId,
                      modelId,
                      inputTokens,
                      outputTokens,
                      totalTokens,
                      timestamp: new Date().toISOString(),
                    })
                  } catch (error) {
                    console.error("[gemini] failed to append usage", error)
                  }

                  safeEmit({
                    type: "message-metadata",
                    messageMetadata: {
                      model: modelId,
                      ...(modelId !== input.modelId
                        ? { requestedModel: input.modelId }
                        : {}),
                      sessionId: latestSessionId,
                      inputTokens,
                      outputTokens,
                      totalTokens,
                      durationMs: Date.now() - startedAt,
                    },
                  })
                }
              } catch (error) {
                console.error("[gemini] failed to read usage", error)
              }

              if (pendingFinishChunk) {
                safeEmit(pendingFinishChunk)
              } else {
                safeEmit({ type: "finish" })
              }

              return { ok: true }
            }

            const primaryModelId = getGeminiPrimaryModelId(input.modelId)
            const attemptedModels = [
              primaryModelId,
              ...getGeminiFallbackModelIds(input.modelId),
              ...getGeminiFallbackModelIds(primaryModelId),
            ].filter((modelId, index, allModels) => {
              const isSkippedOriginalModel =
                modelId === input.modelId && modelId !== primaryModelId
              return (
                !isSkippedOriginalModel &&
                allModels.indexOf(modelId) === index
              )
            })
            let lastCapacityError: string | undefined

            for (let index = 0; index < attemptedModels.length; index++) {
              const modelId = attemptedModels[index]!
              const result = await streamWithModel(modelId)
              if (result.ok) {
                safeComplete()
                return
              }

              if (
                result.capacityError &&
                !result.emittedContent &&
                !abortController.signal.aborted &&
                index < attemptedModels.length - 1
              ) {
                lastCapacityError = result.errorText
                console.warn(
                  `[gemini] ${modelId} is at capacity; retrying with ${attemptedModels[index + 1]}`,
                )
                cleanupProvider(input.subChatId)
                continue
              }

              safeEmit({
                type: "error",
                errorText: humanizeGeminiError(
                  result.errorText || "Stream failed",
                  attemptedModels.slice(0, index + 1),
                ),
              })
              safeEmit({ type: "finish" })
              safeComplete()
              return
            }

            safeEmit({
              type: "error",
              errorText: humanizeGeminiError(
                lastCapacityError || "No capacity available for Gemini",
                attemptedModels,
              ),
            })
            safeEmit({ type: "finish" })
            safeComplete()
          } catch (error) {
            const rawMessage =
              error instanceof Error ? error.message : String(error ?? "")
            console.error("[gemini] chat stream error:", error)
            safeEmit({
              type: "error",
              errorText: humanizeGeminiError(rawMessage || "Stream failed"),
            })
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
              const shouldCleanup =
                abortController.signal.aborted || activeStream.cancelRequested
              if (shouldCleanup) {
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
    .input(z.object({ subChatId: z.string(), runId: z.string() }))
    .mutation(({ input }) => {
      const activeStream = activeStreams.get(input.subChatId)
      if (!activeStream) return { cancelled: false, ignoredStale: false }
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
})
