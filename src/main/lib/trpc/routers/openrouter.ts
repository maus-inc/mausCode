/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * — file-level port, not a merge. See .dump/tasks/transplant/from-1code/forks/erenbertr-backend-core/tasks.md.
 */
import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { z } from "zod"
import { getDatabase, subChats } from "../../db"
import {
  clearOpenRouterApiKey,
  getOpenRouterAuthStatus,
  loadOpenRouterApiKey,
  saveOpenRouterApiKey,
  type OpenRouterAuthStatus,
} from "../../openrouter-auth-store"
import { appendOpenRouterUsage } from "../../openrouter-usage"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type ActiveOpenRouterStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveOpenRouterStream>()

const CATALOG_TTL_MS = 5 * 60 * 1000
type CatalogEntry = {
  id: string
  name: string
  description: string | null
  contextLength: number | null
  pricing: {
    promptUsdPerToken: number | null
    completionUsdPerToken: number | null
  }
  modality: string | null
}
let catalogCache: { fetchedAt: number; models: CatalogEntry[] } | null = null

function maskKeyForLog(key: string): string {
  if (key.length <= 8) return "****"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}

function parseCatalog(body: unknown): CatalogEntry[] {
  if (typeof body !== "object" || body === null) return []
  const data = (body as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  const out: CatalogEntry[] = []
  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) continue
    const r = raw as Record<string, unknown>
    const id = typeof r.id === "string" ? r.id : null
    if (!id) continue
    const name = typeof r.name === "string" ? r.name : id
    const description = typeof r.description === "string" ? r.description : null
    const contextLength =
      typeof r.context_length === "number" ? r.context_length : null
    const pricing =
      typeof r.pricing === "object" && r.pricing !== null
        ? (r.pricing as Record<string, unknown>)
        : null
    const promptStr = pricing?.prompt
    const completionStr = pricing?.completion
    const promptUsdPerToken =
      typeof promptStr === "string" && Number.isFinite(Number(promptStr))
        ? Number(promptStr)
        : null
    const completionUsdPerToken =
      typeof completionStr === "string" && Number.isFinite(Number(completionStr))
        ? Number(completionStr)
        : null
    const arch =
      typeof r.architecture === "object" && r.architecture !== null
        ? (r.architecture as Record<string, unknown>)
        : null
    const modality =
      typeof arch?.modality === "string" ? (arch.modality as string) : null
    out.push({
      id,
      name,
      description,
      contextLength,
      pricing: { promptUsdPerToken, completionUsdPerToken },
      modality,
    })
  }
  return out
}

async function fetchCatalogFresh(): Promise<CatalogEntry[]> {
  const response = await fetch("https://openrouter.ai/api/v1/models")
  if (!response.ok) {
    throw new Error(`OpenRouter catalog HTTP ${response.status}`)
  }
  const body = await response.json()
  return parseCatalog(body)
}

export function hasActiveOpenRouterStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllOpenRouterStreams(): void {
  for (const stream of activeStreams.values()) {
    stream.controller.abort()
  }
  activeStreams.clear()
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

function buildUserParts(
  prompt: string,
  images:
    | Array<{ base64Data?: string; mediaType?: string; filename?: string }>
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
    | Array<{ base64Data?: string; mediaType?: string; filename?: string }>
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

async function readWorkspaceInstructions(
  cwd: string | undefined,
): Promise<{ filename: string; content: string } | null> {
  if (!cwd) return null
  const candidates = ["AGENTS.md", "CLAUDE.md"]
  for (const filename of candidates) {
    try {
      const filePath = path.join(cwd, filename)
      const content = await fs.readFile(filePath, "utf-8")
      if (content.trim()) {
        return { filename, content }
      }
    } catch {
      // missing or unreadable - try next
    }
  }
  return null
}

async function buildSystemPrompt(
  cwd: string | undefined,
  projectPath: string | undefined,
  modelId: string,
): Promise<string> {
  const lines: string[] = []
  lines.push(
    "You are a helpful AI coding assistant running inside the mausCode desktop app via OpenRouter.",
  )
  lines.push(
    `Model: ${modelId}. You do not have direct file or shell access in this session — answer based on the workspace context provided below and any user-supplied snippets.`,
  )
  if (projectPath) {
    lines.push(`Project root: ${projectPath}`)
  }
  if (cwd) {
    lines.push(`Working directory: ${cwd}`)
  }
  const instructions = await readWorkspaceInstructions(cwd)
  if (instructions) {
    lines.push("")
    lines.push(`# ${instructions.filename}`)
    lines.push(
      `The following are the project's ${instructions.filename} instructions:`,
    )
    lines.push("")
    lines.push(instructions.content)
  }
  return lines.join("\n")
}

function convertStoredMessagesToModelMessages(
  storedMessages: any[],
): Array<{ role: "user" | "assistant"; content: any }> {
  const out: Array<{ role: "user" | "assistant"; content: any }> = []
  for (const msg of storedMessages) {
    if (!msg || !Array.isArray(msg.parts)) continue
    if (msg.role === "user") {
      const textChunks: string[] = []
      const fileSnippets: string[] = []
      const imageParts: any[] = []
      for (const part of msg.parts) {
        if (part?.type === "text" && typeof part.text === "string") {
          textChunks.push(part.text)
        } else if (part?.type === "file-content") {
          const filePath =
            typeof part.filePath === "string" ? part.filePath : undefined
          const fileName = filePath?.split("/").pop() || filePath || "file"
          const content = typeof part.content === "string" ? part.content : ""
          fileSnippets.push(`\n--- ${fileName} ---\n${content}`)
        } else if (part?.type === "data-image" && part.data) {
          const data = part.data as Record<string, unknown>
          const base64Data =
            typeof data.base64Data === "string" ? data.base64Data : null
          const mediaType =
            typeof data.mediaType === "string" ? data.mediaType : null
          if (base64Data && mediaType) {
            imageParts.push({
              type: "file",
              mediaType,
              data: base64Data,
              ...(typeof data.filename === "string"
                ? { filename: data.filename }
                : {}),
            })
          }
        }
      }
      const text = textChunks.join("\n") + fileSnippets.join("")
      if (!text && imageParts.length === 0) continue
      const content: any[] = []
      if (text) content.push({ type: "text", text })
      for (const image of imageParts) content.push(image)
      out.push({ role: "user", content })
    } else if (msg.role === "assistant") {
      const textChunks: string[] = []
      for (const part of msg.parts) {
        if (part?.type === "text" && typeof part.text === "string") {
          textChunks.push(part.text)
        }
      }
      const text = textChunks.join("")
      if (!text) continue
      out.push({ role: "assistant", content: text })
    }
  }
  return out
}

function humanizeOpenRouterError(rawMessage: string): string {
  if (!rawMessage) return "Stream failed"
  if (/401|unauthorized|invalid api key/i.test(rawMessage)) {
    return "OpenRouter rejected the API key. Re-enter it in Settings → Models."
  }
  if (/402|insufficient.*credits|payment required/i.test(rawMessage)) {
    return "OpenRouter credits exhausted. Top up your balance at openrouter.ai/settings/credits."
  }
  if (/429|rate ?limit|too many/i.test(rawMessage)) {
    return `OpenRouter rate limit hit: ${rawMessage}`
  }
  if (/503|upstream|provider.*unavailable/i.test(rawMessage)) {
    return "OpenRouter or the upstream model provider is temporarily unavailable. Try a different model or retry."
  }
  return rawMessage
}

export const openrouterRouter = router({
  getAuthStatus: publicProcedure.query((): OpenRouterAuthStatus => {
    return getOpenRouterAuthStatus()
  }),

  setApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(({ input }) => {
      saveOpenRouterApiKey(input.apiKey)
      return getOpenRouterAuthStatus()
    }),

  clearApiKey: publicProcedure.mutation(() => {
    clearOpenRouterApiKey()
    return getOpenRouterAuthStatus()
  }),

  testApiKey: publicProcedure
    .input(z.object({ apiKey: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
          headers: { Authorization: `Bearer ${input.apiKey}` },
        })
        if (response.status === 401 || response.status === 403) {
          return { ok: false as const, error: "Invalid API key" }
        }
        if (!response.ok) {
          return {
            ok: false as const,
            error: `HTTP ${response.status}`,
          }
        }
        const body = (await response.json()) as Record<string, unknown>
        const data = (body.data ?? null) as Record<string, unknown> | null
        const label = typeof data?.label === "string" ? data.label : null
        return { ok: true as const, label }
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : "Network error",
        }
      }
    }),

  listModels: publicProcedure
    .input(z.object({ force: z.boolean().optional() }).optional())
    .query(async ({ input }) => {
      const force = input?.force === true
      const now = Date.now()
      if (!force && catalogCache && now - catalogCache.fetchedAt < CATALOG_TTL_MS) {
        return {
          available: true as const,
          models: catalogCache.models,
          fetchedAt: new Date(catalogCache.fetchedAt).toISOString(),
          cached: true,
        }
      }
      try {
        const models = await fetchCatalogFresh()
        catalogCache = { fetchedAt: now, models }
        return {
          available: true as const,
          models,
          fetchedAt: new Date(now).toISOString(),
          cached: false,
        }
      } catch (error) {
        return {
          available: false as const,
          error: error instanceof Error ? error.message : "Catalog fetch failed",
          fetchedAt: new Date(now).toISOString(),
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
        sessionId: z.string().optional(),
        images: z.array(imageAttachmentSchema).optional(),
        cwd: z.string().optional(),
        projectPath: z.string().optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<any>((emit) => {
        const existingStream = activeStreams.get(input.subChatId)
        if (existingStream) {
          existingStream.cancelRequested = true
          existingStream.controller.abort()
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
            // ignore
          }
        }

        ;(async () => {
          try {
            const apiKey = loadOpenRouterApiKey()
            if (!apiKey) {
              safeEmit({
                type: "error",
                errorText:
                  "No OpenRouter API key configured. Add one in Settings → Models.",
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

            const existingMessages = parseStoredMessages(existingSubChat.messages)
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

            const provider = createOpenRouter({
              apiKey,
              headers: {
                "HTTP-Referer": "https://maus.inc",
                "X-Title": "mausCode",
              },
            })

            const sessionId = input.sessionId || randomUUID()
            const startedAt = Date.now()

            const systemPrompt = await buildSystemPrompt(
              input.cwd,
              input.projectPath,
              input.modelId,
            )

            const priorMessages = convertStoredMessagesToModelMessages(
              existingMessages,
            )
            const modelMessages: Array<{
              role: "user" | "assistant"
              content: any
            }> = [
              ...priorMessages,
              {
                role: "user",
                content: buildModelMessageContent(input.prompt, input.images),
              },
            ]

            const result = streamText({
              model: provider.chat(input.modelId, {
                usage: { include: true },
              }),
              system: systemPrompt,
              messages: modelMessages as any,
              abortSignal: abortController.signal,
            })

            const cleanAssistantMessageForPersistence = (message: any) => {
              if (!message || message.role !== "assistant") return message
              if (!Array.isArray(message.parts)) return message
              const cleanedParts = message.parts.filter(
                (part: any) => part?.state !== "input-streaming",
              )
              if (cleanedParts.length === 0) return null
              return { ...message, parts: cleanedParts }
            }

            const uiStream = result.toUIMessageStream({
              originalMessages: messagesForStream,
              generateMessageId: () => crypto.randomUUID(),
              messageMetadata: ({ part }) => {
                if (part.type === "finish") {
                  return {
                    model: input.modelId,
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype:
                      part.finishReason === "error" ? "error" : "success",
                  }
                }
                return { model: input.modelId, sessionId }
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
                  console.error("[openrouter] Failed to persist messages:", error)
                }
              },
              onError: (error) =>
                humanizeOpenRouterError(
                  error instanceof Error ? error.message : String(error ?? ""),
                ),
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                const rawText =
                  typeof (value as any).errorText === "string"
                    ? (value as any).errorText
                    : "Stream failed"
                safeEmit({
                  ...value,
                  errorText: humanizeOpenRouterError(rawText),
                })
                continue
              }

              if (value?.type === "finish") {
                pendingFinishChunk = value
                continue
              }

              safeEmit(value)
            }

            try {
              const usage = await result.usage
              const inputTokens = usage?.inputTokens ?? 0
              const outputTokens = usage?.outputTokens ?? 0
              const totalTokens =
                usage?.totalTokens ?? inputTokens + outputTokens
              const providerMetadata = await result.providerMetadata
              const orMeta =
                providerMetadata && typeof providerMetadata === "object"
                  ? (providerMetadata as Record<string, unknown>).openrouter
                  : null
              const orUsage =
                orMeta && typeof orMeta === "object"
                  ? ((orMeta as Record<string, unknown>).usage as
                      | Record<string, unknown>
                      | undefined)
                  : undefined
              const costUsd =
                typeof orUsage?.cost === "number" ? orUsage.cost : 0

              if (inputTokens || outputTokens || costUsd) {
                try {
                  await appendOpenRouterUsage({
                    sessionId,
                    modelId: input.modelId,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    costUsd,
                    timestamp: new Date().toISOString(),
                  })
                } catch (error) {
                  console.error("[openrouter] failed to append usage", error)
                }

                safeEmit({
                  type: "message-metadata",
                  messageMetadata: {
                    model: input.modelId,
                    sessionId,
                    inputTokens,
                    outputTokens,
                    totalTokens,
                    costUsd,
                    durationMs: Date.now() - startedAt,
                  },
                })
              }
            } catch (error) {
              console.error("[openrouter] failed to read usage", error)
            }

            if (pendingFinishChunk) {
              safeEmit(pendingFinishChunk)
            } else {
              safeEmit({ type: "finish" })
            }

            safeComplete()
          } catch (error) {
            const rawMessage =
              error instanceof Error
                ? error.message
                : String(error ?? "")
            console.error(
              "[openrouter] chat stream error:",
              error,
              "key=",
              maskKeyForLog(loadOpenRouterApiKey() ?? ""),
            )
            safeEmit({
              type: "error",
              errorText: humanizeOpenRouterError(rawMessage || "Stream failed"),
            })
            safeEmit({ type: "finish" })
            safeComplete()
          } finally {
            const activeStream = activeStreams.get(input.subChatId)
            if (activeStream?.runId === input.runId) {
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
      const activeStream = activeStreams.get(input.subChatId)
      if (activeStream) {
        activeStream.controller.abort()
        activeStreams.delete(input.subChatId)
      }
      return { success: true }
    }),
})
