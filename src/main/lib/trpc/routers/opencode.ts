/**
 * opencode backend router. Mirrors the codex router's tRPC surface and
 * persistence behavior; the transport is `opencode serve` (local HTTP + SSE)
 * via `../../opencode/session`. MCP is CLI-native (opencode.json); the
 * fingerprint hashes the resolved config files so edits respawn sessions.
 * Auth is CLI-managed (`opencode auth login`); authConfig only affects the
 * session fingerprint. Model ids are `provider/model`; anything else falls
 * back to the server default. The `mode` input is accepted for surface
 * parity but currently unused: opencode agent selection (e.g. plan mode)
 * stays unset until agent names are verified via GET /agent.
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { normalizeCodexAssistantMessage } from "../../../../shared/codex-tool-normalizer"
import { createChunkCoalescer } from "../../claude"
import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveProjectPathFromWorktree } from "../../claude-config"
import { resolveCliBinaryPath } from "../../cli-binaries"
import { getDatabase, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import {
  createOpencodeSession,
  type OpencodeSession,
  type OpencodeSessionChunk,
  type OpencodeTurnInput,
  type OpencodeTurnUsage,
} from "../../opencode/session"
import { publicProcedure, router } from "../index"
import {
  buildUserParts,
  extractPromptFromStoredMessage,
  getLastSessionId,
  parseStoredMessages,
  type StoredChatMessage,
  type StoredMessagePart,
} from "./codex"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type OpencodeProviderSession = {
  session: OpencodeSession
  cwd: string
  authFingerprint: string | null
  mcpFingerprint: string
  model: string | null
}

const providerSessions = new Map<string, OpencodeProviderSession>()

type ActiveStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveStream>()

const AUTH_HINTS = [
  "401",
  "unauthorized",
  "unauthenticated",
  "invalid api key",
  "incorrect api key",
  "api key",
  "forbidden",
  "login",
  "auth",
  "token",
  "oauth",
  "quota",
  "billing",
  "payment",
]

interface OpencodeErrorShape {
  data?: { message?: unknown; code?: unknown }
  errorText?: unknown
  message?: unknown
  error?: unknown
  code?: unknown
}

function extractOpencodeError(error: unknown): { message: string; code?: string } {
  const anyError = error as OpencodeErrorShape
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

function isOpencodeAuthError(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`.toLowerCase()
  return AUTH_HINTS.some((hint) => searchableText.includes(hint))
}

function resolveOpencodeBinaryPath(): string {
  // PATH-only: opencode is user-installed (never bundled). resolveCliBinaryPath
  // throws a helpful error when missing.
  return resolveCliBinaryPath({
    bundledPath: "opencode",
    commandName: "opencode",
    downloadHint: "Install opencode: https://opencode.ai",
  })
}

function buildOpencodeEnv(): Record<string, string> {
  const shellEnv = getClaudeShellEnvironment()
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...process.env, ...shellEnv })) {
    if (typeof value === "string") env[key] = value
  }
  return env
}

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

async function getOpencodeMcpFingerprint(cwd: string): Promise<string> {
  // MCP servers live in opencode.json (project + global). Hash both so MCP
  // edits respawn the session; missing files hash as empty.
  const candidates = [
    join(cwd, "opencode.json"),
    join(homedir(), ".config", "opencode", "opencode.json"),
  ]
  const contents: string[] = []
  for (const file of candidates) {
    try {
      contents.push(await readFile(file, "utf8"))
    } catch {
      contents.push("")
    }
  }
  return createHash("sha256").update(contents.join("\n")).digest("hex")
}

async function getOrCreateSession(params: {
  subChatId: string
  cwd: string
  mcpFingerprint: string
  existingSessionId?: string
  model?: string
  authConfig?: {
    apiKey: string
  }
  onChunk: (chunk: OpencodeSessionChunk) => void
  onUsage: (usage: OpencodeTurnUsage) => void
}): Promise<OpencodeSession> {
  const authFingerprint = getAuthFingerprint(params.authConfig)
  const existing = providerSessions.get(params.subChatId)

  if (
    existing &&
    existing.cwd === params.cwd &&
    existing.authFingerprint === authFingerprint &&
    existing.mcpFingerprint === params.mcpFingerprint &&
    existing.model === (params.model || null)
  ) {
    existing.session.setOnChunk(params.onChunk)
    return existing.session
  }

  if (existing) {
    await cleanupProvider(params.subChatId)
  }

  const session = await createOpencodeSession({
    binaryPath: resolveOpencodeBinaryPath(),
    cwd: params.cwd,
    env: buildOpencodeEnv(),
    existingSessionId: params.existingSessionId,
    model: params.model,
    title: params.subChatId,
    onChunk: params.onChunk,
    onUsage: params.onUsage,
  })

  providerSessions.set(params.subChatId, {
    session,
    cwd: params.cwd,
    authFingerprint,
    mcpFingerprint: params.mcpFingerprint,
    model: params.model || null,
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
    console.error("[opencode] Failed to dispose session:", error)
  }
}

function runOpencodeCli(args: string[]): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  return new Promise((resolvePromise) => {
    let resolved = false
    const resolve = (result: { stdout: string; stderr: string; exitCode: number | null }) => {
      if (resolved) return
      resolved = true
      resolvePromise(result)
    }
    try {
      const child = spawn(resolveOpencodeBinaryPath(), args, {
        timeout: 15000,
      })
      let stdout = ""
      let stderr = ""
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk)
      })
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk)
      })
      child.on("error", (error) => {
        resolve({ stdout, stderr: `${stderr}${String(error)}`, exitCode: null })
      })
      child.on("close", (code) => {
        resolve({ stdout, stderr, exitCode: code })
      })
    } catch (error) {
      resolve({ stdout: "", stderr: String(error), exitCode: null })
    }
  })
}

export const opencodeRouter = router({
  getIntegration: publicProcedure.query(async () => {
    const version = await runOpencodeCli(["--version"])
    const auth = await runOpencodeCli(["auth", "list"])
    const authOutput = `${auth.stdout}\n${auth.stderr}`.trim()
    return {
      available: version.exitCode === 0,
      version: `${version.stdout} ${version.stderr}`.trim(),
      authenticated: auth.exitCode === 0 && authOutput.length > 0,
      rawAuth: authOutput,
    }
  }),

  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        runId: z.string(),
        cwd: z.string(),
        prompt: z.string(),
        model: z.string().optional(),
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
      return observable<OpencodeSessionChunk>((emit) => {
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

        const safeEmit = (chunk: OpencodeSessionChunk) => {
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
        const coalescer = createChunkCoalescer<OpencodeSessionChunk>(
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
            const selectedModel = input.model?.trim() || undefined

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
                metadata: selectedModel ? { model: selectedModel } : {},
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

            const resolvedProjectPathFromCwd = resolveProjectPathFromWorktree(input.cwd)
            const mcpLookupPath = input.projectPath || resolvedProjectPathFromCwd || input.cwd
            const mcpFingerprint = await getOpencodeMcpFingerprint(mcpLookupPath)

            // Accumulate the assistant message from opencode chunks while also
            // forwarding chunks to the renderer.
            const accumulatedParts: StoredMessagePart[] = []
            const accumulatedText: Record<string, string> = {}
            const toolPartIndexByCallId: Record<string, number> = {}
            const startedAt = Date.now()
            let latestSessionId: string | undefined =
              input.sessionId || getLastSessionId(existingMessages)
            let latestUsage: OpencodeTurnUsage | null = null

            const handleSessionChunk = (chunk: OpencodeSessionChunk) => {
              if (chunk?.type === "error") {
                coalescer.flush()
                const normalized = extractOpencodeError(chunk)
                if (isOpencodeAuthError(normalized)) {
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
              mcpFingerprint,
              existingSessionId: input.forceNewSession
                ? undefined
                : (input.sessionId ?? getLastSessionId(existingMessages)),
              model: selectedModel,
              authConfig: input.authConfig,
              onChunk: handleSessionChunk,
              onUsage: (usage) => {
                latestUsage = usage
              },
            })
            latestSessionId = session.sessionId

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

            const turnInput: OpencodeTurnInput[] = [{ type: "text", text: input.prompt }]
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `opencode-${input.runId}`,
            )
            const imageMimes = (input.images ?? [])
              .filter((image) => image.base64Data && image.mediaType)
              .map((image) => ({
                mediaType: image.mediaType,
                filename: image.filename,
              }))
            imagePaths.forEach((imagePath, index) => {
              turnInput.push({
                type: "file",
                path: imagePath,
                mime: imageMimes[index]?.mediaType ?? "image/png",
                filename: imageMimes[index]?.filename,
              })
            })

            let turnResult: Awaited<ReturnType<OpencodeSession["startTurn"]>>
            if (abortController.signal.aborted) {
              await cleanupImageFiles()
              turnResult = {
                status: "interrupted",
                usage: latestUsage ?? {
                  inputTokens: 0,
                  outputTokens: 0,
                  reasoningTokens: 0,
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                  costUsd: 0,
                },
              }
            } else {
              try {
                turnResult = await session.startTurn(turnInput, {
                  model: selectedModel,
                })
              } finally {
                await cleanupImageFiles()
              }
            }
            // The session id can change mid-life (recreate-on-404 retry).
            latestSessionId = session.sessionId
            latestUsage = turnResult.usage

            // Drain any buffered text-delta before the post-stream emits.
            coalescer.flush()

            const usageMetadata = latestUsage
              ? {
                  inputTokens: latestUsage.inputTokens,
                  outputTokens: latestUsage.outputTokens,
                  totalTokens: latestUsage.inputTokens + latestUsage.outputTokens,
                }
              : null
            if (usageMetadata) {
              safeEmit({
                type: "message-metadata",
                messageMetadata: usageMetadata,
              })
            }

            const finishMetadata = {
              ...(selectedModel ? { model: selectedModel } : {}),
              sessionId: latestSessionId,
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
              console.error("[opencode] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            coalescer.flush()
            const normalized = extractOpencodeError(error)

            // A dead event stream never recovers: evict the cached session
            // so the next run spawns fresh instead of reusing the corpse.
            if (normalized.message.includes("event stream is dead")) {
              await cleanupProvider(input.subChatId)
            }

            console.error("[opencode] chat stream error:", error)
            if (isOpencodeAuthError(normalized)) {
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
          coalescer.dispose()
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
