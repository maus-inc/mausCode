/**
 * hermes-agent backend router. Core chat runs over the generic ACP path
 * (`hermes acp` stdio via @mcpc-tech/acp-ai-provider + AI SDK), mirroring
 * the cursor router's tRPC surface and persistence behavior.
 *
 * Full-fidelity state access (cron, skills, MCP, webhooks, tools, memory,
 * checkpoints, auth, config) goes through the allowlisted read-only
 * `runCommand` passthrough — Hermes owns those surfaces; mausCode never
 * re-implements them. Gateway/channels/TUI/Electron stay Hermes-owned and
 * are reported in the capability manifest only.
 *
 * Auth is CLI-managed (`hermes model` / `~/.hermes/.env`); authConfig only
 * affects the session fingerprint. Model ids pass through to the ACP
 * session; when unset the server default applies.
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { type ACPProvider, createACPProvider } from "@mcpc-tech/acp-ai-provider"
import { observable } from "@trpc/server/observable"
import { streamText } from "ai"
import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, subChats } from "../../db"
import { extractHermesError, isHermesAuthError, isHermesReadonlyCommand } from "../../hermes/policy"
import { resolveHermesAcpLaunch, resolveHermesCliLaunch } from "../../hermes-binary"
import { publicProcedure, router } from "../index"
import {
  buildUserParts,
  extractPromptFromStoredMessage,
  getLastSessionId,
  parseStoredMessages,
} from "./codex"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

type HermesProviderSession = {
  provider: ACPProvider
  cwd: string
  authFingerprint: string | null
}

type ActiveHermesStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const providerSessions = new Map<string, HermesProviderSession>()
const activeStreams = new Map<string, ActiveHermesStream>()

const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

export function hasActiveHermesStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllHermesStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[hermes] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

async function runHermesCli(
  args: string[],
  options?: { cwd?: string },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const launch = resolveHermesCliLaunch(args)
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
        new Error(`[hermes] Failed to execute \`hermes ${args.join(" ")}\`: ${error.message}`),
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

function getAuthFingerprint(authConfig?: { apiKey: string }): string | null {
  const apiKey = authConfig?.apiKey?.trim()
  if (!apiKey) return null
  return createHash("sha256").update(apiKey).digest("hex")
}

function buildHermesProviderEnv(): Record<string, string> {
  // Shell-derived values first (notably PATH) so the hermes launcher and its
  // venv resolve the same way as in an interactive shell. App-managed apiKey
  // is deliberately NOT injected: hermes resolves providers from
  // ~/.hermes/.env, which a single key cannot address.
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

  return env
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

  if (existing && existing.cwd === params.cwd && existing.authFingerprint === authFingerprint) {
    return existing.provider
  }

  if (existing) {
    existing.provider.cleanup()
    providerSessions.delete(params.subChatId)
  }

  const launch = resolveHermesAcpLaunch()

  const provider = createACPProvider({
    command: launch.command,
    ...(launch.args.length > 0 ? { args: launch.args } : {}),
    env: buildHermesProviderEnv(),
    session: {
      cwd: params.cwd,
      mcpServers: [],
    },
    ...(params.existingSessionId ? { existingSessionId: params.existingSessionId } : {}),
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

export {
  extractHermesError,
  isHermesAuthError,
  isHermesReadonlyCommand,
} from "../../hermes/policy"

export const hermesRouter = router({
  getIntegration: publicProcedure.query(async () => {
    const version = await runHermesCli(["--version"]).catch((error) => ({
      stdout: "",
      stderr: extractHermesError(error).message,
      exitCode: null as number | null,
    }))
    const check = await runHermesCli(["acp", "--check"]).catch((error) => ({
      stdout: "",
      stderr: extractHermesError(error).message,
      exitCode: null as number | null,
    }))
    const versionOutput = `${version.stdout}\n${version.stderr}`.trim()
    const checkOutput = `${check.stdout}\n${check.stderr}`.trim()
    return {
      available: version.exitCode === 0,
      version: versionOutput,
      acpReady: check.exitCode === 0,
      rawCheck: checkOutput,
    }
  }),

  /**
   * Read-only hermes state passthrough (status/cron/skills/mcp/...).
   * The subcommand allowlist is the safety boundary; args pass through.
   */
  runCommand: publicProcedure
    .input(
      z.object({
        command: z.string().min(1),
        args: z.array(z.string()).default([]),
        cwd: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      if (!isHermesReadonlyCommand(input.command)) {
        throw new Error(`hermes subcommand "${input.command}" is not in the read-only allowlist`)
      }
      return runHermesCli([input.command.trim(), ...input.args], {
        cwd: input.cwd,
      })
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
            // Hermes model ids are provider-defined; pass through when set,
            // otherwise the ACP server default applies (no static map).
            const uiModelId = input.model?.trim() || undefined
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
                metadata: { ...(metadataModel ? { model: metadataModel } : {}) },
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
              existingSessionId: input.forceNewSession
                ? undefined
                : (input.sessionId ?? getLastSessionId(existingMessages)),
              authConfig: input.authConfig,
            })

            let acpModelId = uiModelId
            try {
              const sessionInfo = await provider.initSession()
              const available = sessionInfo?.models?.availableModels?.map((m) => m.modelId) ?? []
              if (uiModelId && available.length > 0) {
                acpModelId = uiModelId
                try {
                  await provider.setModel(acpModelId)
                } catch (setModelError) {
                  const fallback = sessionInfo?.models?.currentModelId ?? available[0]!
                  console.warn(
                    `[hermes] setModel("${acpModelId}") failed, using "${fallback}"`,
                    setModelError,
                  )
                  acpModelId = fallback
                  await provider.setModel(acpModelId)
                }
              } else {
                acpModelId = sessionInfo?.models?.currentModelId ?? uiModelId
              }

              console.log(
                `[hermes] model ui="${uiModelId}" acp="${acpModelId}" available=[${available.join(", ")}]`,
              )
            } catch (sessionError) {
              console.warn(
                `[hermes] session init / model resolution failed, using "${uiModelId}"`,
                sessionError,
              )
              acpModelId = uiModelId
            }

            const startedAt = Date.now()

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

                if (part.type === "finish") {
                  return {
                    ...(metadataModel ? { model: metadataModel } : {}),
                    sessionId,
                    durationMs: Date.now() - startedAt,
                    resultSubtype: part.finishReason === "error" ? "error" : "success",
                  }
                }

                if (sessionId) {
                  return {
                    ...(metadataModel ? { model: metadataModel } : {}),
                    sessionId,
                  }
                }

                return { ...(metadataModel ? { model: metadataModel } : {}) }
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
                    ...(isContinuation ? messagesForStream.slice(0, -1) : messagesForStream),
                    cleanedResponseMessage,
                  ]

                  persistSubChatMessages(messagesToPersist)
                } catch (error) {
                  console.error("[hermes] Failed to persist messages:", error)
                }
              },
              onError: (error) => extractHermesError(error).message,
            })

            const reader = uiStream.getReader()
            let pendingFinishChunk: any | null = null
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              if (value?.type === "error") {
                const normalized = extractHermesError(value)

                if (isHermesAuthError(normalized)) {
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
            const normalized = extractHermesError(error)

            console.error("[hermes] chat stream error:", error)
            if (isHermesAuthError(normalized)) {
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
})
