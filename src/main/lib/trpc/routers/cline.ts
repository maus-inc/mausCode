/**
 * mausCode Cline provider router: credentials, chat, cancel, cleanup, MCP.
 * Ours (no upstream port): chat runs native `cline --json` print turns
 * via cline-print/session.
 *
 * Auth shape mirrors the qwen backend: mausCode holds one BYOK
 * credential (provider + key + endpoint + model, encrypted in the app
 * DB) and injects it per-run via -P/-k/-m flags — the user's
 * ~/.cline files are never written (upstream stores apiKey in
 * PLAINTEXT). Custom-baseUrl credentials additionally get a per-turn
 * isolated CLINE_DATA_DIR (the CLI has no per-run baseUrl flag).
 *
 * No resume: `--id` is broken in every headless path (v3.0.61), so
 * each turn is a fresh session carrying bounded transcript context.
 * Only the unknown-model retry exists (drop -m once).
 */

import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { agentModeSchema, DEFAULT_AGENT_MODE } from "../../../../shared/agent-mode"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { resolveClineCliLaunch } from "../../cline-binary"
import { getAllClineMcpConfigHandler, getClineMcpConfigForProject } from "../../cline-mcp"
import {
  buildClinePrintArgs,
  isClineAuthErrorMessage,
  isClineInvalidModelError,
} from "../../cline-print/args"
import { listClineStoredModels, prepareClineIsolatedDataDir } from "../../cline-print/auth-config"
import { type ClinePrintChunk, runClinePrintTurn } from "../../cline-print/session"
import { clineCredentials, getDatabase, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { probeCline, probeClineAuthHome } from "../../providers/cline"
import { decryptToken, encryptToken } from "../../token-crypto"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

/** Verified `-P` ids (binary strings + `cline auth` runs). */
const clineProviderSchema = z.enum([
  "openrouter",
  "anthropic",
  "openai-native",
  "deepseek",
  "ollama",
  "lmstudio",
])

/** Local runtimes take no key (`-k` omitted). */
const KEYLESS_PROVIDERS = new Set(["ollama", "lmstudio"])

type ActiveClineStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveClineStream>()

/** Verified `-m` ids (npm README examples + the live CLI default). */
const STATIC_CLINE_MODELS: Array<{ id: string; name: string }> = [
  { id: "anthropic/claude-opus-4-6", name: "Claude Opus 4.6" },
  { id: "anthropic/claude-fable-5.1", name: "Claude Fable 5.1" },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
  { id: "google/gemini-3-pro", name: "Gemini 3 Pro" },
  { id: "gpt-5", name: "GPT-5" },
]

export const DEFAULT_CLINE_MODEL = "anthropic/claude-opus-4-6"

/** Transcript budget for the resume-substitute history block. */
const HISTORY_CHAR_BUDGET = 12_000
const HISTORY_MESSAGE_BUDGET = 8

export function hasActiveClineStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllClineStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[cline] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}

/** Loose shapes for untyped CLI errors, stored chat messages, and stream parts. */
interface ProviderErrorShape {
  data?: { message?: unknown; code?: unknown }
  errorText?: unknown
  message?: unknown
  error?: unknown
  code?: unknown
}

interface StoredMessagePart {
  type?: string
  text?: string
  state?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  result?: unknown
  startedAt?: number
  [key: string]: unknown
}

interface StoredChatMessage {
  id?: string
  role?: string
  parts?: StoredMessagePart[]
  metadata?: { sessionId?: string; model?: string; [key: string]: unknown }
  [key: string]: unknown
}

type UserMessagePart =
  | { type: "text"; text: string }
  | { type: "data-image"; data: { base64Data: string; mediaType: string; filename?: string } }

function extractClineError(error: unknown): { message: string; code?: string } {
  const err = error as ProviderErrorShape | undefined
  const message =
    err?.data?.message || err?.errorText || err?.message || err?.error || String(error)
  const code = err?.data?.code || err?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isClineAuthErrorResult(params: {
  message?: string | null
  code?: string | null
}): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`
  // Quota/billing/rate-limit failures mention keys and 403s but are not
  // fixed by reconnecting: never route them to the connect modal.
  if (
    /quota|rate[ -]?limit|too many requests|\b429\b|insufficient (credit|balance|funds|quota)|billing|payment|plan limit|usage limit/i.test(
      searchableText,
    )
  ) {
    return false
  }
  return isClineAuthErrorMessage(searchableText)
}

function parseStoredMessages(raw: string | null | undefined): StoredChatMessage[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function extractTextFromMessage(message: StoredChatMessage): string {
  if (!message || !Array.isArray(message.parts)) return ""
  return message.parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

/**
 * Bounded transcript for the `<conversation_history>` block (the
 * `--id` resume substitute): last N messages, text parts only, newest
 * last, front-truncated to the char budget.
 */
function buildHistoryText(messages: StoredChatMessage[]): string | undefined {
  const tail = messages.slice(-HISTORY_MESSAGE_BUDGET)
  const lines: string[] = []
  for (const message of tail) {
    const text = extractTextFromMessage(message).trim()
    if (!text) continue
    const role = message?.role === "assistant" ? "assistant" : "user"
    lines.push(`${role}: ${text}`)
  }
  if (lines.length === 0) return undefined
  const joined = lines.join("\n\n")
  if (joined.length <= HISTORY_CHAR_BUDGET) return joined
  return `...(truncated)\n${joined.slice(-HISTORY_CHAR_BUDGET)}`
}

type ResolvedClineAuth = {
  provider: string
  apiKey?: string
  baseUrl?: string
  source: "held" | "cli-config"
}

/**
 * Held credential (decrypted) or null. Key material stays in this
 * module: callers receive it only to place on the spawn argv, and it is
 * never logged (argv builders take it as an opaque value).
 */
function getHeldCredential(): {
  provider: string
  apiKey?: string
  baseUrl?: string
  model?: string
  label?: string
  connectedAt: Date | null
} | null {
  try {
    const db = getDatabase()
    const row = db.select().from(clineCredentials).where(eq(clineCredentials.id, "default")).get()
    if (!row) return null
    let apiKey: string | undefined
    if (row.apiKey) {
      try {
        apiKey = decryptToken(row.apiKey)
      } catch {
        return null
      }
      if (!apiKey || apiKey.trim().length === 0) apiKey = undefined
    }
    if (!apiKey && !KEYLESS_PROVIDERS.has(row.provider)) return null
    return {
      provider: row.provider,
      ...(apiKey ? { apiKey } : {}),
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.label ? { label: row.label } : {}),
      connectedAt: row.connectedAt ?? null,
    }
  } catch (error) {
    console.error("[cline] Failed to read held credential:", error)
    return null
  }
}

function resolveRunAuth(): ResolvedClineAuth | null {
  const held = getHeldCredential()
  if (held) {
    return {
      provider: held.provider,
      ...(held.apiKey ? { apiKey: held.apiKey } : {}),
      ...(held.baseUrl ? { baseUrl: held.baseUrl } : {}),
      source: "held",
    }
  }
  return null
}

function buildClineProviderEnv(extra?: Record<string, string>): Record<string, string> {
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

  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value
    }
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
): UserMessagePart[] {
  const parts: UserMessagePart[] = [{ type: "text", text: prompt }]

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

function cleanupProvider(_subChatId: string): void {
  // No cached sessions exist (no upstream resume): turns own their
  // processes per-run and in-flight turns die via the AbortController.
  // Kept as a hook so a future `--id` fix can hang state here.
}

export const clineRouter = router({
  getIntegration: publicProcedure.query(async () => {
    // No `status` subcommand exists: availability comes from --version
    // and auth from held credentials first, CLI config second. A stale
    // key reports connected until a turn fails; the chat flow then
    // surfaces auth-error and the connect modal.
    try {
      const probe = await probeCline()
      if (!probe.available) {
        return {
          state: "not_found" as const,
          isConnected: false,
          source: null as null | "held" | "cli-config",
          rawOutput: probe.detail ?? "cline CLI not found",
          exitCode: null as number | null,
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          state: "connected" as const,
          isConnected: true,
          source: "held" as const,
          provider: held.provider,
          ...(held.model ? { model: held.model } : {}),
          ...(held.label ? { label: held.label } : {}),
          connectedAt: held.connectedAt?.toISOString() ?? null,
          rawOutput:
            `${probe.version ?? ""}\nmausCode-held credential (${held.provider}${held.label ? `, ${held.label}` : ""})`.trim(),
          exitCode: 0,
        }
      }
      const auth = probeClineAuthHome()
      return {
        state: (auth.authenticated ? "connected" : "not_logged_in") as
          | "connected"
          | "not_logged_in",
        isConnected: auth.authenticated,
        source: auth.authenticated ? ("cli-config" as const) : null,
        rawOutput: `${probe.version ?? ""}\n${auth.detail}`.trim(),
        exitCode: 0,
      }
    } catch (error) {
      const message = extractClineError(error).message
      return {
        state: "unknown" as const,
        isConnected: false,
        source: null as null | "held" | "cli-config",
        rawOutput: message,
        exitCode: null as number | null,
      }
    }
  }),

  saveCredentials: publicProcedure
    .input(
      z.object({
        provider: clineProviderSchema,
        apiKey: z.string().max(2000).optional(),
        baseUrl: z.string().trim().max(500).optional(),
        model: z.string().trim().min(1).max(200).optional(),
        label: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const baseUrl = input.baseUrl?.trim() || undefined
      if (baseUrl) {
        let parsed: URL
        try {
          parsed = new URL(baseUrl)
        } catch {
          throw new Error("Base URL is not a valid URL.")
        }
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
          throw new Error("Base URL must be http(s).")
        }
      }
      const apiKey = input.apiKey?.trim() || undefined
      if (!apiKey && !KEYLESS_PROVIDERS.has(input.provider)) {
        throw new Error("API key must not be empty.")
      }
      const db = getDatabase()
      const values = {
        id: "default",
        provider: input.provider,
        apiKey: apiKey ? encryptToken(apiKey) : null,
        baseUrl: baseUrl ?? null,
        model: input.model?.trim() || null,
        label: input.label?.trim() || null,
        connectedAt: new Date(),
      }
      db.insert(clineCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: clineCredentials.id,
          set: {
            provider: values.provider,
            apiKey: values.apiKey,
            baseUrl: values.baseUrl,
            model: values.model,
            label: values.label?.trim() || null,
            connectedAt: new Date(),
          },
        })
        .run()
      return { success: true }
    }),

  testConnection: publicProcedure.mutation(async () => {
    // Fast + free: binary identity plus credential presence. This does
    // NOT validate the key (that needs a billed model call); runtime
    // auth errors stay authoritative per-turn.
    try {
      const probe = await probeCline()
      if (!probe.available) {
        return {
          ok: false,
          detail: probe.detail ?? "cline CLI not found",
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          ok: true,
          detail:
            `cline ${probe.version ?? ""} · mausCode-held ${held.provider} credential${held.label ? ` (${held.label})` : ""}`.trim(),
        }
      }
      const auth = probeClineAuthHome()
      return {
        ok: auth.authenticated,
        detail: `cline ${probe.version ?? ""} · ${auth.detail}`.trim(),
      }
    } catch (error) {
      return { ok: false, detail: extractClineError(error).message }
    }
  }),

  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()
    db.delete(clineCredentials).where(eq(clineCredentials.id, "default")).run()
    // Ambient CLI config (~/.cline, env) is untouched.
    return { success: true }
  }),

  listModels: publicProcedure.query(async () => {
    // No models command exists: CLI-configured models first, held
    // credential model next, verified static list last.
    const models: Array<{ id: string; name: string; source: string }> = []
    const seen = new Set<string>()
    const push = (id: string, name?: string, source?: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      models.push({ id, name: name || id, source: source || "static" })
    }
    try {
      for (const stored of listClineStoredModels()) {
        push(stored.id, `${stored.id} (${stored.provider})`, "stored")
      }
    } catch (error) {
      console.error("[cline.listModels] stored models failed:", error)
    }
    const held = getHeldCredential()
    if (held?.model) {
      push(held.model, undefined, "held")
    }
    const defaultModel = models[0]?.id ?? DEFAULT_CLINE_MODEL
    for (const fallback of STATIC_CLINE_MODELS) {
      push(fallback.id, fallback.name, "static")
    }
    return { models, defaultModel, error: null as string | null }
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
      }),
    )
    .subscription(({ input }) => {
      return observable<ClinePrintChunk>((emit) => {
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

        const safeEmit = (chunk: ClinePrintChunk) => {
          if (!isActive) return
          try {
            emit.next(normalizeCodexStreamChunk(chunk) as ClinePrintChunk)
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

            const runAuth = resolveRunAuth()
            const heldModel = getHeldCredential()?.model
            const existingMessages = parseStoredMessages(existingSubChat.messages)
            // Native -m takes the id verbatim (no static map).
            const selectedModel = input.model?.trim() || heldModel || undefined

            const lastMessage = existingMessages[existingMessages.length - 1]
            const isDuplicatePrompt =
              lastMessage?.role === "user" && extractTextFromMessage(lastMessage) === input.prompt

            let messagesForStream = existingMessages
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

              const cleanedParts = message.parts.filter((part) => part?.state !== "input-streaming")

              if (cleanedParts.length === 0) {
                return null
              }

              return normalizeCodexAssistantMessage(
                {
                  ...message,
                  parts: cleanedParts,
                },
                { normalizeState: true },
              ) as StoredChatMessage
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

            const accumulatedParts: StoredMessagePart[] = []
            const accumulatedText: Record<string, string> = {}
            const toolPartIndexByCallId: Record<string, number> = {}

            // Error chunks are held until the turn settles: the
            // unknown-model retry may recover, and a recovered turn
            // must not have flashed a false failure. Flushed by
            // emitHeldErrorChunk once retries are exhausted.
            let heldErrorChunk: ClinePrintChunk | null = null
            const emitHeldErrorChunk = () => {
              if (!heldErrorChunk) return
              const chunk = heldErrorChunk
              heldErrorChunk = null
              const normalized = extractClineError(chunk)
              if (isClineAuthErrorResult(normalized)) {
                safeEmit({
                  ...chunk,
                  type: "auth-error",
                  errorText: normalized.message,
                })
              } else {
                safeEmit({ ...chunk, errorText: normalized.message })
              }
            }

            const handlePrintChunk = (chunk: ClinePrintChunk) => {
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
              } else if (
                chunk?.type === "tool-output-error" &&
                typeof chunk.toolCallId === "string"
              ) {
                // Same improvement as the qwen backend: failed tools
                // persist in the terminal error state instead of a
                // stuck "call" spinner after reload.
                const index = toolPartIndexByCallId[chunk.toolCallId]
                if (index !== undefined && accumulatedParts[index]) {
                  accumulatedParts[index] = {
                    ...accumulatedParts[index],
                    errorText: chunk.errorText,
                    state: "output-error",
                  }
                }
              }

              safeEmit(chunk)
            }

            // Images travel as prompt path references (the agent reads them
            // via tools); stage base64 attachments to temp files per turn.
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `cline-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            // No resume upstream: every turn is a fresh session. The
            // bounded transcript block is the continuity mechanism.
            const historyText = buildHistoryText(existingMessages)
            const buildInvocation = (model: string | undefined) =>
              buildClinePrintArgs({
                prompt: promptWithImages,
                mode: input.mode,
                ...(runAuth?.provider ? { provider: runAuth.provider } : {}),
                ...(runAuth?.apiKey ? { apiKey: runAuth.apiKey } : {}),
                ...(model ? { model } : {}),
                cwd: input.cwd,
                ...(historyText ? { historyText } : {}),
              })

            let invocation = buildInvocation(selectedModel)

            if (abortController.signal.aborted) {
              // Cancelled while staging: never spawn; the finally below
              // clears the run.
              await cleanupImageFiles()
              safeComplete()
              return
            }

            // Custom endpoints need a per-turn isolated data dir (no
            // per-run baseUrl flag exists upstream). Fixed-endpoint
            // providers run against the user's real config untouched.
            const isolated =
              runAuth?.baseUrl && runAuth.provider
                ? prepareClineIsolatedDataDir({
                    provider: runAuth.provider,
                    ...(runAuth.apiKey ? { apiKey: runAuth.apiKey } : {}),
                    baseUrl: runAuth.baseUrl,
                  })
                : null
            const runEnv = isolated
              ? buildClineProviderEnv({ CLINE_DATA_DIR: isolated.dataDir })
              : buildClineProviderEnv()

            let attemptArgs = invocation.args
            let modelDropped = false
            let turnResult!: Awaited<ReturnType<typeof runClinePrintTurn>["done"]>
            let activeTurn: ReturnType<typeof runClinePrintTurn> | null = null
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn?.interrupt()
              },
              { once: true },
            )
            try {
              for (;;) {
                const launch = resolveClineCliLaunch(attemptArgs)
                activeTurn = runClinePrintTurn({
                  command: launch.command,
                  args: launch.args,
                  cwd: input.cwd,
                  env: runEnv,
                  onChunk: handlePrintChunk,
                })
                turnResult = await activeTurn.done
                activeTurn = null
                if (turnResult.status !== "error" || abortController.signal.aborted) {
                  break
                }
                if (
                  !modelDropped &&
                  selectedModel &&
                  isClineInvalidModelError(turnResult.errorMessage)
                ) {
                  // Stale/unknown model id: retry once with the
                  // provider default model.
                  modelDropped = true
                  heldErrorChunk = null
                  invocation = buildInvocation(undefined)
                  attemptArgs = invocation.args
                  continue
                }
                break
              }
            } finally {
              await cleanupImageFiles()
              isolated?.cleanup()
            }
            emitHeldErrorChunk()

            const finishMetadata = {
              ...(selectedModel ? { model: selectedModel } : {}),
              // No sessionId: cline sessions are not resumable, and a
              // stored id would only poison future turns.
              durationMs: turnResult.durationMs,
              // Mirror the sibling routers: only true errors fail; user
              // interrupts render without the "Failed" badge.
              resultSubtype: turnResult.status === "error" ? "error" : "success",
              ...(turnResult.usage?.inputTokens !== undefined
                ? { inputTokens: turnResult.usage.inputTokens }
                : {}),
              ...(turnResult.usage?.outputTokens !== undefined
                ? { outputTokens: turnResult.usage.outputTokens }
                : {}),
              ...(turnResult.usage?.totalTokens !== undefined
                ? { totalTokens: turnResult.usage.totalTokens }
                : {}),
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
              console.error("[cline] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractClineError(error)

            console.error("[cline] chat stream error:", error)
            if (isClineAuthErrorResult(normalized)) {
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
      return await getAllClineMcpConfigHandler()
    } catch (error) {
      console.error("[cline.getAllMcpConfig] Error:", error)
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
        const group = await getClineMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[cline.getMcpConfig] Error:", error)
        return {
          groups: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    // No cache layer: config readers hit disk every call, so refresh is
    // a no-op that keeps the settings-UI contract (same shape as the
    // sibling routers).
    return { success: true }
  }),
})
