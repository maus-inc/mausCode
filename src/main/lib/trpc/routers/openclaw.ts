/**
 * mausCode OpenClaw provider router: credentials, chat, cancel, cleanup, MCP.
 * Ours (no upstream port): chat runs native `agent exec --json` turns
 * via openclaw-print/session.
 *
 * Auth shape mirrors the cline backend: mausCode holds one BYOK
 * credential (provider + key + model, encrypted in the app DB) and
 * injects it per-run via the spawn ENVIRONMENT — the user's
 * ~/.openclaw files are never written (onboarding stores keys in
 * PLAINTEXT by default). Ambient config stays loaded, so the user's
 * MCP servers and harness selection apply to every turn.
 *
 * No resume: `agent exec` takes no session id, so each turn is a
 * fresh session carrying bounded transcript context. The only retry
 * drops `--model` on unknown-model errors (config default), and only
 * when the held provider is openai-shaped or no held credential
 * exists — otherwise the retry would surface a misleading auth error
 * for a provider the user never configured.
 */
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, openclawCredentials, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { resolveOpenclawCliLaunch } from "../../openclaw-binary"
import { getAllOpenclawMcpConfigHandler, getOpenclawMcpConfigForProject } from "../../openclaw-mcp"
import {
  buildOpenclawPrintArgs,
  isOpenclawAuthErrorMessage,
  isOpenclawInvalidModelError,
} from "../../openclaw-print/args"
import {
  OPENCLAW_PROVIDER_ENV_VARS,
  readOpenclawModelsList,
} from "../../openclaw-print/auth-config"
import { type OpenclawPrintChunk, runOpenclawPrintTurn } from "../../openclaw-print/session"
import { probeOpenclawAuthHome, probeOpenclawBinary } from "../../providers/openclaw"
import { decryptToken, encryptToken } from "../../token-crypto"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

/** Held providers (env-var injection verified live for each). */
const openclawProviderSchema = z.enum(["openai", "anthropic", "openrouter", "xai"])

type ActiveOpenclawStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const activeStreams = new Map<string, ActiveOpenclawStream>()

/** Verified `--model` refs (each resolved live, env-only, 2026.9.2). */
const STATIC_OPENCLAW_MODELS: Array<{ id: string; name: string }> = [
  { id: "openai/gpt-5.6-sol", name: "GPT-5.6 Sol" },
  { id: "anthropic/claude-opus-5", name: "Claude Opus 5" },
  { id: "anthropic/claude-sonnet-5", name: "Claude Sonnet 5" },
  { id: "anthropic/claude-haiku-4-5", name: "Claude Haiku 4.5" },
  { id: "openrouter/auto", name: "OpenRouter Auto" },
  { id: "xai/grok-4", name: "Grok 4" },
  { id: "xai/grok-code-fast-1", name: "Grok Code Fast" },
]

export const DEFAULT_OPENCLAW_MODEL = "openai/gpt-5.6-sol"

/** Transcript budget for the resume-substitute history block. */
const HISTORY_CHAR_BUDGET = 12_000
const HISTORY_MESSAGE_BUDGET = 8

/**
 * No plan-mode flag exists on `agent exec`: plan/ask turns carry
 * this read-only prefix in the prompt instead.
 */
const PLAN_READONLY_PREFIX =
  "You are in read-only planning mode: investigate and propose a concrete " +
  "plan, but do NOT create, modify, or delete any files, and do NOT run " +
  "commands that change system state. End with the plan."

export function hasActiveOpenclawStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllOpenclawStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[openclaw] Aborting stream ${subChatId} before reload`)
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

function extractOpenclawError(error: unknown): { message: string; code?: string } {
  const err = error as ProviderErrorShape | undefined
  const message =
    err?.data?.message || err?.errorText || err?.message || err?.error || String(error)
  const code = err?.data?.code || err?.code

  return {
    message: typeof message === "string" ? message : String(message),
    code: typeof code === "string" ? code : undefined,
  }
}

function isOpenclawAuthErrorResult(params: {
  message?: string | null
  code?: string | null
}): boolean {
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
  return isOpenclawAuthErrorMessage(searchableText)
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

type ResolvedOpenclawAuth = {
  provider: string
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
    const row = db
      .select()
      .from(openclawCredentials)
      .where(eq(openclawCredentials.id, "default"))
      .get()
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
    console.error("[openclaw] Failed to read held credential:", error)
    return null
  }
}

function resolveRunAuth(): ResolvedOpenclawAuth | null {
  const held = getHeldCredential()
  if (!held?.apiKey) return null
  const envVar = OPENCLAW_PROVIDER_ENV_VARS[held.provider]
  if (!envVar) return null
  return { provider: held.provider, apiKey: held.apiKey, source: "held" }
}

function buildOpenclawProviderEnv(extra?: Record<string, string>): Record<string, string> {
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
}

export const openclawRouter = router({
  getIntegration: publicProcedure.query(async () => {
    // Availability comes from --version and auth from held
    // credentials first, ambient CLI config second. A stale key
    // reports connected until a turn fails; the chat flow then
    // surfaces auth-error and the connect modal.
    try {
      // Binary first, held credential second, ambient-auth probe
      // last: held runs skip the `models status` spawn entirely.
      const binary = await probeOpenclawBinary()
      if (!binary.available) {
        return {
          state: "not_found" as const,
          isConnected: false,
          source: null as null | "held" | "cli-config",
          rawOutput: binary.detail ?? "openclaw CLI not found",
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
      const auth = await probeOpenclawAuthHome()
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
      const message = extractOpenclawError(error).message
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
        provider: openclawProviderSchema,
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
      db.insert(openclawCredentials)
        .values(values)
        .onConflictDoUpdate({
          target: openclawCredentials.id,
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
      const binary = await probeOpenclawBinary()
      if (!binary.available) {
        return {
          ok: false,
          detail: binary.detail ?? "openclaw CLI not found",
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          ok: true,
          detail:
            `openclaw ${binary.version ?? ""} · mausCode-held ${held.provider} credential${held.label ? ` (${held.label})` : ""}`.trim(),
        }
      }
      const auth = await probeOpenclawAuthHome()
      return {
        ok: auth.authenticated,
        detail: `openclaw ${binary.version ?? ""} · ${auth.detail}`.trim(),
      }
    } catch (error) {
      return { ok: false, detail: extractOpenclawError(error).message }
    }
  }),

  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()
    db.delete(openclawCredentials).where(eq(openclawCredentials.id, "default")).run()
    // Ambient CLI config (~/.openclaw, env) is untouched.
    return { success: true }
  }),

  listModels: publicProcedure.query(async () => {
    // Live CLI catalog first (spawned with the held key in env so the
    // catalog expands for the held provider), held credential model
    // next, verified static list last.
    const models: Array<{ id: string; name: string; source: string }> = []
    const seen = new Set<string>()
    const push = (id: string, name?: string, source?: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      models.push({ id, name: name || id, source: source || "static" })
    }
    try {
      const held = getHeldCredential()
      const launch = resolveOpenclawCliLaunch()
      const envVar = held ? OPENCLAW_PROVIDER_ENV_VARS[held.provider] : undefined
      const listed = await readOpenclawModelsList({
        command: launch.command,
        args: launch.args,
        ...(held?.apiKey && envVar ? { env: { [envVar]: held.apiKey } } : {}),
      })
      for (const entry of listed) {
        push(entry.id, entry.available ? entry.name : `${entry.name} (no auth)`, "cli")
      }
    } catch (error) {
      console.error("[openclaw.listModels] CLI catalog failed:", error)
    }
    const held = getHeldCredential()
    if (held?.model) {
      push(held.model, undefined, "held")
    }
    const defaultModel = models[0]?.id ?? DEFAULT_OPENCLAW_MODEL
    for (const fallback of STATIC_OPENCLAW_MODELS) {
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
        mode: z.enum(["plan", "ask", "edit", "agent", "turbo"]).default("agent"),
        sessionId: z.string().optional(),
        forceNewSession: z.boolean().optional(),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<OpenclawPrintChunk>((emit) => {
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

        const safeEmit = (chunk: OpenclawPrintChunk) => {
          if (!isActive) return
          try {
            emit.next(normalizeCodexStreamChunk(chunk) as OpenclawPrintChunk)
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
            // Native --model takes the ref verbatim (no static map).
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
            let heldErrorChunk: OpenclawPrintChunk | null = null
            const emitHeldErrorChunk = () => {
              if (!heldErrorChunk) return
              const chunk = heldErrorChunk
              heldErrorChunk = null
              const normalized = extractOpenclawError(chunk)
              if (isOpenclawAuthErrorResult(normalized)) {
                safeEmit({
                  ...chunk,
                  type: "auth-error",
                  errorText: normalized.message,
                })
              } else {
                safeEmit({ ...chunk, errorText: normalized.message })
              }
            }

            const handlePrintChunk = (chunk: OpenclawPrintChunk) => {
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
              `openclaw-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            // No plan-mode flag exists: plan/ask carry a read-only prefix.
            const promptWithMode =
              input.mode === "plan" || input.mode === "ask"
                ? `${PLAN_READONLY_PREFIX}\n\n${promptWithImages}`
                : promptWithImages

            // No resume upstream: every turn is a fresh session. The
            // bounded transcript block is the continuity mechanism.
            const historyText = buildHistoryText(existingMessages)
            const buildInvocation = (model: string | undefined) =>
              buildOpenclawPrintArgs({
                cwd: input.cwd,
                ...(model ? { model } : {}),
                prompt: promptWithMode,
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

            // Held key rides in the spawn env (overriding any ambient
            // value for the same variable); ambient config stays loaded.
            const heldEnvVar =
              runAuth && runAuth.source === "held"
                ? OPENCLAW_PROVIDER_ENV_VARS[runAuth.provider]
                : undefined
            const runEnv = buildOpenclawProviderEnv(
              runAuth && heldEnvVar ? { [heldEnvVar]: runAuth.apiKey } : undefined,
            )

            // The drop-model retry only makes sense when the config
            // default is plausibly authenticated: held-openai runs
            // (whose default is openai/...) or fully ambient runs.
            // Otherwise it would swap the real error for a misleading
            // missing-auth failure on a provider the user never set up.
            const mayDropModel = !runAuth || runAuth.provider === "openai"

            let attemptArgs = invocation.args
            let attemptPrompt = invocation.promptUsed
            let modelDropped = false
            let turnResult!: Awaited<ReturnType<typeof runOpenclawPrintTurn>["done"]>
            let activeTurn: ReturnType<typeof runOpenclawPrintTurn> | null = null
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn?.interrupt()
              },
              { once: true },
            )
            try {
              for (;;) {
                const launch = resolveOpenclawCliLaunch(attemptArgs)
                activeTurn = runOpenclawPrintTurn({
                  command: launch.command,
                  args: launch.args,
                  cwd: input.cwd,
                  env: runEnv,
                  prompt: attemptPrompt,
                  onChunk: handlePrintChunk,
                })
                turnResult = await activeTurn.done
                activeTurn = null
                if (turnResult.status !== "error" || abortController.signal.aborted) {
                  break
                }
                if (
                  !modelDropped &&
                  mayDropModel &&
                  selectedModel &&
                  isOpenclawInvalidModelError(turnResult.errorMessage)
                ) {
                  // Stale/unknown model ref: retry once with the
                  // config default model.
                  modelDropped = true
                  heldErrorChunk = null
                  invocation = buildInvocation(undefined)
                  attemptArgs = invocation.args
                  attemptPrompt = invocation.promptUsed
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
              // No sessionId: exec sessions are not resumable, and a
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
              console.error("[openclaw] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractOpenclawError(error)

            console.error("[openclaw] chat stream error:", error)
            if (isOpenclawAuthErrorResult(normalized)) {
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
      return await getAllOpenclawMcpConfigHandler()
    } catch (error) {
      console.error("[openclaw.getAllMcpConfig] Error:", error)
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
        const group = await getOpenclawMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[openclaw.getMcpConfig] Error:", error)
        return {
          groups: [],
          mcpServers: [],
          error: error instanceof Error ? error.message : String(error),
        }
      }
    }),

  refreshMcpConfig: publicProcedure.mutation(() => {
    // No cache layer: the MCP reader shells to the CLI every call, so
    // refresh is a no-op that keeps the settings-UI contract (same
    // shape as the sibling routers).
    return { success: true }
  }),
})
