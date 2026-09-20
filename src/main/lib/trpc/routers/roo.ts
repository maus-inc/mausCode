/**
 * mausCode Roo Code provider router: credentials, chat, cancel, cleanup, MCP.
 * Ours (no upstream port): chat runs native `roo -p --output-format
 * stream-json` turns via roo-print/session.
 *
 * Auth shape mirrors the cline backend: mausCode holds one BYOK
 * credential (provider + key + model, encrypted in the app DB) and
 * injects it per-run via the spawn ENVIRONMENT — the user's ~/.roo
 * files are never written. Ambient config stays loaded, so the
 * user's MCP servers and settings defaults apply to every turn.
 *
 * No resume: `--session-id/--continue` reject resume-with-prompt
 * upstream, so each turn is a fresh session carrying bounded
 * transcript context. No model retry either: unknown `-m` refs do
 * NOT fail (the extension silently falls back to the provider
 * default), so listModels only offers provider-scoped verified ids
 * and custom refs on the strict providers degrade explicitly (see
 * resolveModelArg).
 */

import { unlinkSync } from "node:fs"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { agentModeSchema, DEFAULT_AGENT_MODE } from "../../../../shared/agent-mode"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, rooCredentials, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { probeRooAuthHome, probeRooBinary } from "../../providers/roo"
import { resolveRooCliLaunch } from "../../roo-binary"
import { getAllRooMcpConfigHandler, getRooMcpConfigForProject } from "../../roo-mcp"
import { buildRooPrintArgs, isRooAuthErrorMessage, type RooPrintMode } from "../../roo-print/args"
import {
  DEFAULT_ROO_PROVIDER,
  isKnownRooModelId,
  isRooSupportedProvider,
  ROO_PROVIDER_DEFAULT_MODELS,
  ROO_PROVIDER_ENV_VARS,
  ROO_PROVIDER_MODELS,
  type RooSupportedProvider,
  resolveRooAmbientAuth,
} from "../../roo-print/auth-config"
import { type RooPrintChunk, runRooPrintTurn } from "../../roo-print/session"
import { decryptToken, encryptToken } from "../../token-crypto"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

/** Held providers (env-var injection, source-verified per provider). */
const rooProviderSchema = z.enum([
  "anthropic",
  "openai-native",
  "gemini",
  "openrouter",
  "vercel-ai-gateway",
])

type ActiveRooStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveRooStream>()

export const DEFAULT_ROO_MODEL = "anthropic/claude-opus-4.6"

/** Transcript budget for the resume-substitute history block. */
const HISTORY_CHAR_BUDGET = 12_000
const HISTORY_MESSAGE_BUDGET = 8

/**
 * Providers whose handlers silently substitute the provider default
 * for unknown `-m` ids (source: anthropic.ts getModel() et al).
 * Custom refs on these providers are dropped explicitly with a
 * visible warning instead of running a different model silently.
 */
const STRICT_MODEL_PROVIDERS: readonly RooSupportedProvider[] = [
  "anthropic",
  "openai-native",
  "gemini",
]

/**
 * Read-only prefixes for the question-answering modes. Print runs
 * auto-approve, so plan/ask turns carry intent in the prompt even
 * though --mode already selects architect/ask slugs.
 */
const PLAN_READONLY_PREFIX =
  "You are in read-only planning mode: investigate and propose a concrete " +
  "plan, but do NOT create, modify, or delete any files, and do NOT run " +
  "commands that change system state. End with the plan."
const ASK_READONLY_PREFIX =
  "Answer the user's questions using read-only investigation only: do NOT " +
  "create, modify, or delete any files, and do NOT run commands that " +
  "change system state."

function resolveModelArg(params: { provider: RooSupportedProvider; model: string | undefined }): {
  modelArg: string | undefined
  warning: string | undefined
} {
  const { provider, model } = params
  if (!model) return { modelArg: undefined, warning: undefined }
  if (!STRICT_MODEL_PROVIDERS.includes(provider)) {
    // Router providers pass -m through verbatim (unknown ids fail
    // loudly at the API, never silently swap).
    return { modelArg: model, warning: undefined }
  }
  if (isKnownRooModelId(provider, model)) {
    return { modelArg: model, warning: undefined }
  }
  return {
    modelArg: undefined,
    warning:
      `Model "${model}" is not a verified ${provider} id, so this turn runs ` +
      `the provider default (${ROO_PROVIDER_DEFAULT_MODELS[provider]}) instead. ` +
      `Upstream would have swapped silently; pick a listed model to pin one.`,
  }
}

export function hasActiveRooStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllRooStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[roo] Aborting stream ${subChatId} before reload`)
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

function extractRooError(error: unknown): { message: string; code?: string } {
  const err = error as ProviderErrorShape | undefined
  const message =
    err?.data?.message || err?.errorText || err?.message || err?.error || String(error)
  const code = err?.data?.code || err?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isRooAuthErrorResult(params: { message?: string | null; code?: string | null }): boolean {
  const searchableText = `${params.code || ""} ${params.message || ""}`
  // Quota/billing/rate-limit failures mention keys but are not fixed
  // by reconnecting: never route them to the connect modal.
  if (
    /quota|rate[ -]?limit|too many requests|\b429\b|insufficient (credit|balance|funds|quota)|billing|payment|plan limit|usage limit/i.test(
      searchableText,
    )
  ) {
    return false
  }
  return isRooAuthErrorMessage(searchableText)
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
 * resume substitute): last N messages, text parts only, newest last,
 * front-truncated to the char budget.
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

type ResolvedRooAuth = {
  provider: RooSupportedProvider
  apiKey: string
  source: "held" | "cli-config"
}

/**
 * Held credential (decrypted) or null. Key material stays in this
 * module: callers receive it only to place in the spawn env, and it
 * is never logged.
 */
function getHeldCredential(): {
  provider: string
  apiKey?: string
  model?: string
  label?: string
  connectedAt: Date | null
} | null {
  try {
    const db = getDatabase()
    const row = db.select().from(rooCredentials).where(eq(rooCredentials.id, "default")).get()
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
    if (!apiKey) return null
    return {
      provider: row.provider,
      ...(apiKey ? { apiKey } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.label ? { label: row.label } : {}),
      connectedAt: row.connectedAt ?? null,
    }
  } catch (error) {
    console.error("[roo] Failed to read held credential:", error)
    return null
  }
}

function resolveRunAuth(): ResolvedRooAuth | null {
  const held = getHeldCredential()
  if (!held?.apiKey) return null
  if (!isRooSupportedProvider(held.provider)) return null
  return { provider: held.provider, apiKey: held.apiKey, source: "held" }
}

/** Effective provider: held credential first, ambient settings second. */
function resolveEffectiveProvider(): RooSupportedProvider {
  const held = getHeldCredential()
  if (held && isRooSupportedProvider(held.provider)) return held.provider
  try {
    return resolveRooAmbientAuth().provider
  } catch {
    return DEFAULT_ROO_PROVIDER
  }
}

function buildRooProviderEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") {
      env[key] = value
    }
  }

  try {
    const shellEnv = getClaudeShellEnvironment()
    for (const [key, value] of Object.entries(shellEnv)) {
      if (typeof value === "string") {
        env[key] = value
      }
    }
  } catch {
    // process.env was already copied above
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
}

function deletePromptFile(promptFile: string): void {
  try {
    unlinkSync(promptFile)
  } catch {
    // Best-effort: residue is inert prompt text in the OS temp dir.
  }
}

export const rooRouter = router({
  getIntegration: publicProcedure.query(async () => {
    // Availability comes from --version and auth from held
    // credentials first, ambient CLI config second. A stale key
    // reports connected until a turn fails; the chat flow then
    // surfaces auth-error and the connect modal.
    try {
      // Binary first, held credential second, ambient-auth probe
      // last: held runs skip the ambient probe entirely.
      const binary = await probeRooBinary()
      if (!binary.available) {
        return {
          state: "not_found" as const,
          isConnected: false,
          source: null as null | "held" | "cli-config",
          rawOutput: binary.detail ?? "roo CLI not found",
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
            `${binary.version ?? ""}\nmausCode-held credential (${held.provider}${held.label ? `, ${held.label}` : ""})`.trim(),
          exitCode: 0,
        }
      }
      const auth = await probeRooAuthHome()
      return {
        state: (auth.authenticated ? "connected" : "not_logged_in") as
          | "connected"
          | "not_logged_in",
        isConnected: auth.authenticated,
        source: auth.authenticated ? ("cli-config" as const) : null,
        rawOutput: `${binary.version ?? ""}\n${auth.detail}`.trim(),
        exitCode: 0,
      }
    } catch (error) {
      const message = extractRooError(error).message
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
        provider: rooProviderSchema,
        apiKey: z.string().trim().min(1).max(2000),
        model: z.string().trim().min(1).max(200).optional(),
        label: z.string().trim().max(120).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const values = {
        id: "default",
        provider: input.provider,
        apiKey: encryptToken(input.apiKey.trim()),
        model: input.model?.trim() || null,
        label: input.label?.trim() || null,
        connectedAt: new Date(),
      }
      db.insert(rooCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: rooCredentials.id,
          set: {
            provider: values.provider,
            apiKey: values.apiKey,
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
      const binary = await probeRooBinary()
      if (!binary.available) {
        return {
          ok: false,
          detail: binary.detail ?? "roo CLI not found",
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          ok: true,
          detail:
            `roo ${binary.version ?? ""} · mausCode-held ${held.provider} credential${held.label ? ` (${held.label})` : ""}`.trim(),
        }
      }
      const auth = await probeRooAuthHome()
      return {
        ok: auth.authenticated,
        detail: `roo ${binary.version ?? ""} · ${auth.detail}`.trim(),
      }
    } catch (error) {
      return { ok: false, detail: extractRooError(error).message }
    }
  }),

  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()
    db.delete(rooCredentials).where(eq(rooCredentials.id, "default")).run()
    // Ambient CLI config (~/.roo, env) is untouched.
    return { success: true }
  }),

  listModels: publicProcedure.query(async () => {
    // Provider-contextual: model ids are provider-scoped upstream
    // (unknown ids silently fall back on the strict providers), so
    // only the effective provider's verified table is offered. Held
    // credential model leads when set.
    const provider = resolveEffectiveProvider()
    const models: Array<{ id: string; name: string; source: string }> = []
    const seen = new Set<string>()
    const push = (id: string, name?: string, source?: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      models.push({ id, name: name || id, source: source || "static" })
    }
    const held = getHeldCredential()
    if (held?.model) {
      push(held.model, undefined, "held")
    }
    for (const entry of ROO_PROVIDER_MODELS[provider]) {
      push(entry.id, entry.name, "static")
    }
    const defaultModel = models[0]?.id ?? ROO_PROVIDER_DEFAULT_MODELS[provider]
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
      return observable<RooPrintChunk>((emit) => {
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

        const safeEmit = (chunk: RooPrintChunk) => {
          if (!isActive) return
          try {
            emit.next(normalizeCodexStreamChunk(chunk) as RooPrintChunk)
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
            const provider = runAuth?.provider ?? resolveEffectiveProvider()
            const existingMessages = parseStoredMessages(existingSubChat.messages)
            const requestedModel = input.model?.trim() || heldModel || undefined
            const { modelArg, warning: modelWarning } = resolveModelArg({
              provider,
              model: requestedModel,
            })

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
                metadata: { ...(requestedModel ? { model: requestedModel } : {}) },
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

            const handlePrintChunk = (chunk: RooPrintChunk) => {
              if (chunk?.type === "error") {
                // No retry exists (unknown models fall back silently
                // upstream instead of failing): route immediately.
                const normalized = extractRooError(chunk)
                if (isRooAuthErrorResult(normalized)) {
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
                    state: "output-available",
                  }
                }
              } else if (
                chunk?.type === "tool-output-error" &&
                typeof chunk.toolCallId === "string"
              ) {
                // Same improvement as the sibling backends: failed tools
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
              `roo-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            // Native --mode plus a read-only prefix for plan/ask: print
            // runs auto-approve, so intent rides in the prompt too.
            const promptWithMode =
              input.mode === "plan"
                ? `${PLAN_READONLY_PREFIX}\n\n${promptWithImages}`
                : input.mode === "ask"
                  ? `${ASK_READONLY_PREFIX}\n\n${promptWithImages}`
                  : promptWithImages

            // No resume upstream: every turn is a fresh session. The
            // bounded transcript block is the continuity mechanism.
            const historyText = buildHistoryText(existingMessages)
            const invocation = buildRooPrintArgs({
              cwd: input.cwd,
              provider,
              ...(modelArg ? { model: modelArg } : {}),
              mode: input.mode as RooPrintMode,
              prompt: promptWithMode,
              ...(historyText ? { historyText } : {}),
            })

            if (abortController.signal.aborted) {
              // Cancelled while staging: never spawn; the finally below
              // clears the run.
              deletePromptFile(invocation.promptFile)
              await cleanupImageFiles()
              safeComplete()
              return
            }

            // Held key rides in the spawn env (overriding any ambient
            // value for the same variable); ambient config stays loaded.
            const heldEnvVar =
              runAuth && runAuth.source === "held"
                ? ROO_PROVIDER_ENV_VARS[runAuth.provider]
                : undefined
            const runEnv = buildRooProviderEnv(
              runAuth && heldEnvVar ? { [heldEnvVar]: runAuth.apiKey } : undefined,
            )

            if (modelWarning) {
              const warningId = `roo-model-warning-${input.runId}`
              handlePrintChunk({ type: "text-start", id: warningId })
              handlePrintChunk({ type: "text-delta", id: warningId, delta: modelWarning })
              handlePrintChunk({ type: "text-end", id: warningId })
            }

            const launch = resolveRooCliLaunch(invocation.args)
            const activeTurn = runRooPrintTurn({
              command: launch.command,
              args: launch.args,
              cwd: input.cwd,
              env: runEnv,
              onChunk: handlePrintChunk,
            })
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn.interrupt()
              },
              { once: true },
            )
            let turnResult: Awaited<typeof activeTurn.done>
            try {
              turnResult = await activeTurn.done
            } finally {
              deletePromptFile(invocation.promptFile)
              await cleanupImageFiles()
            }

            const finishMetadata = {
              ...(requestedModel ? { model: requestedModel } : {}),
              // No sessionId: resume rejects prompt upstream, and a
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
              console.error("[roo] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractRooError(error)

            console.error("[roo] chat stream error:", error)
            if (isRooAuthErrorResult(normalized)) {
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
      return await getAllRooMcpConfigHandler()
    } catch (error) {
      console.error("[roo.getAllMcpConfig] Error:", error)
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
        const group = await getRooMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[roo.getMcpConfig] Error:", error)
        return {
          groups: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    // No cache layer: the MCP reader hits the settings files every
    // call, so refresh is a no-op that keeps the settings-UI contract
    // (same shape as the sibling routers).
    return { success: true }
  }),
})
