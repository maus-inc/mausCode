/**
 * mausCode Qwen Code provider router: credentials, chat, cancel, cleanup, MCP.
 * Ours (no upstream port): chat runs native `qwen --output-format
 * stream-json` print turns via qwen-print/session.
 *
 * Auth shape differs from the cursor/grok backends on purpose: upstream
 * removed `qwen auth` (it prints a removal notice), so there is no CLI
 * login flow to drive. mausCode holds one API credential (auth-type +
 * key + endpoint + model, encrypted in the app DB) and injects it
 * per-run via --auth-type/--openai-api-key/--openai-base-url flags —
 * the user's ~/.qwen/settings.json is never written. When no held
 * credential exists, flags are omitted and the CLI resolves its own
 * settings/env.
 */

import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { observable } from "@trpc/server/observable"
import { eq } from "drizzle-orm"
import { z } from "zod"
import {
  normalizeCodexAssistantMessage,
  normalizeCodexStreamChunk,
} from "../../../../shared/codex-tool-normalizer"
import { getClaudeShellEnvironment } from "../../claude/env"
import { getDatabase, qwenCredentials, subChats } from "../../db"
import { writeImageTempFiles } from "../../image-staging"
import { probeQwen, probeQwenAuthHome } from "../../providers/qwen"
import { resolveQwenCliLaunch } from "../../qwen-binary"
import { getAllQwenMcpConfigHandler, getQwenMcpConfigForProject } from "../../qwen-mcp"
import {
  buildQwenPrintArgs,
  buildQwenPrintFallbackArgs,
  isQwenAuthError,
  isQwenInvalidModelError,
  isQwenResumeError,
  isQwenUnknownFlagError,
  type QwenAuthType,
} from "../../qwen-print/args"
import { listQwenStoredModels, probeQwenStoredAuth } from "../../qwen-print/auth-config"
import { runQwenPrintTurn } from "../../qwen-print/session"
import { decryptToken, encryptToken } from "../../token-crypto"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

const qwenAuthTypeSchema = z.enum([
  "openai",
  "openai-responses",
  "anthropic",
  "qwen-oauth",
  "gemini",
  "vertex-ai",
])

type QwenPrintState = {
  cwd: string
  authFingerprint: string | null
  model: string | null
  sessionId: string | undefined
}

type ActiveQwenStream = {
  runId: string
  controller: AbortController
  cancelRequested: boolean
}

const providerSessions = new Map<string, QwenPrintState>()
const activeStreams = new Map<string, ActiveQwenStream>()

const ANSI_ESCAPE_REGEX = /\u001B\[[0-?]*[ -/]*[@-~]/g
const ANSI_OSC_REGEX = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g

/** Docs-sourced fallback lineup (Coding Plan + ecosystem defaults). */
const STATIC_QWEN_MODELS: Array<{ id: string; name: string }> = [
  { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
  { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  { id: "qwen3-coder-turbo", name: "Qwen3 Coder Turbo" },
  { id: "qwen3.7-plus", name: "Qwen3.7 Plus" },
  { id: "qwen3.6-plus", name: "Qwen3.6 Plus" },
  { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
  { id: "qwen3-max-2026-01-23", name: "Qwen3 Max" },
  { id: "glm-5", name: "GLM-5" },
  { id: "glm-4.7", name: "GLM-4.7" },
  { id: "kimi-k2.5", name: "Kimi K2.5" },
  { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
]

export const DEFAULT_QWEN_MODEL = "qwen3-coder-plus"

export function hasActiveQwenStreams(): boolean {
  return activeStreams.size > 0
}

export function abortAllQwenStreams(): void {
  for (const [subChatId, stream] of activeStreams) {
    console.log(`[qwen] Aborting stream ${subChatId} before reload`)
    stream.controller.abort()
  }
  activeStreams.clear()
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_OSC_REGEX, "").replace(ANSI_ESCAPE_REGEX, "")
}

function extractQwenError(error: unknown): { message: string; code?: string } {
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

function isQwenAuthErrorResult(params: { message?: string | null; code?: string | null }): boolean {
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
  return isQwenAuthError(searchableText)
}

async function runQwenCli(
  args: string[],
  options?: { cwd?: string; timeoutMs?: number },
): Promise<{
  stdout: string
  stderr: string
  exitCode: number | null
}> {
  const launch = resolveQwenCliLaunch(args)
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
          `[qwen] Timed out executing \`qwen ${args.join(" ")}\` after ${Math.round(timeoutMs / 1000)}s`,
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
        new Error(`[qwen] Failed to execute \`qwen ${args.join(" ")}\`: ${error.message}`),
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

type ResolvedQwenAuth = {
  authType: QwenAuthType
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
  authType: QwenAuthType
  apiKey: string
  baseUrl?: string
  model?: string
  label?: string
  connectedAt: Date | null
} | null {
  try {
    const db = getDatabase()
    const row = db.select().from(qwenCredentials).where(eq(qwenCredentials.id, "default")).get()
    if (!row?.apiKey) return null
    let apiKey: string
    try {
      apiKey = decryptToken(row.apiKey)
    } catch {
      return null
    }
    if (!apiKey || apiKey.trim().length === 0) return null
    return {
      authType: (row.authType as QwenAuthType) || "openai",
      apiKey,
      ...(row.baseUrl ? { baseUrl: row.baseUrl } : {}),
      ...(row.model ? { model: row.model } : {}),
      ...(row.label ? { label: row.label } : {}),
      connectedAt: row.connectedAt ?? null,
    }
  } catch (error) {
    console.error("[qwen] Failed to read held credential:", error)
    return null
  }
}

function resolveRunAuth(): ResolvedQwenAuth | null {
  const held = getHeldCredential()
  if (held) {
    // API-key/base-url flags only exist for the openai family; other
    // auth-types carry no per-run secret (the key lives in ambient env
    // or settings) but still pin the type + endpoint selection.
    if (held.authType === "openai" || held.authType === "openai-responses") {
      return {
        authType: held.authType,
        apiKey: held.apiKey,
        ...(held.baseUrl ? { baseUrl: held.baseUrl } : {}),
        source: "held",
      }
    }
    return { authType: held.authType, source: "held" }
  }
  return null
}

function getQwenAuthFingerprint(auth: ResolvedQwenAuth | null): string | null {
  if (!auth) return null
  return createHash("sha256")
    .update(`${auth.authType}\n${auth.apiKey ?? ""}\n${auth.baseUrl ?? ""}`)
    .digest("hex")
}

function buildQwenProviderEnv(mode: string): Record<string, string> {
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

  if (mode === "turbo") {
    // Reviewed trade-off (mirrors the backend's yolo mapping): the UI
    // already shows the mode, so silence the per-run stderr warning.
    env.QWEN_CODE_SUPPRESS_YOLO_WARNING = "1"
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
  auth: ResolvedQwenAuth | null
}): QwenPrintState {
  const authFingerprint = getQwenAuthFingerprint(params.auth)
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
  // next turn starts fresh with a new client-chosen --session-id UUID.
  const state: QwenPrintState = {
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

export const qwenRouter = router({
  getIntegration: publicProcedure.query(async () => {
    // No `status` subcommand exists: availability comes from --version
    // and auth from held credentials first, CLI config second. A stale
    // key reports connected until a turn fails; the chat flow then
    // surfaces auth-error and the connect modal.
    try {
      const probe = await probeQwen()
      if (!probe.available) {
        return {
          state: "not_found" as const,
          isConnected: false,
          source: null as null | "held" | "cli-config",
          rawOutput: probe.detail ?? "qwen CLI not found",
          exitCode: null as number | null,
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          state: "connected" as const,
          isConnected: true,
          source: "held" as const,
          authType: held.authType,
          ...(held.model ? { model: held.model } : {}),
          ...(held.label ? { label: held.label } : {}),
          connectedAt: held.connectedAt?.toISOString() ?? null,
          rawOutput:
            `${probe.version ?? ""}\nmausCode-held credential (${held.authType}${held.label ? `, ${held.label}` : ""})`.trim(),
          exitCode: 0,
        }
      }
      const auth = probeQwenAuthHome()
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
      const message = extractQwenError(error).message
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
        authType: qwenAuthTypeSchema,
        apiKey: z.string().min(1),
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
      const apiKey = input.apiKey.trim()
      if (!apiKey) {
        throw new Error("API key must not be empty.")
      }
      const db = getDatabase()
      db.insert(qwenCredentials)
        .values({
          id: "default",
          authType: input.authType,
          apiKey: encryptToken(apiKey),
          baseUrl: baseUrl ?? null,
          model: input.model?.trim() || null,
          label: input.label?.trim() || null,
          connectedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: qwenCredentials.id,
          set: {
            authType: input.authType,
            apiKey: encryptToken(apiKey),
            baseUrl: baseUrl ?? null,
            model: input.model?.trim() || null,
            label: input.label?.trim() || null,
            connectedAt: new Date(),
          },
        })
        .run()
      // Held-auth change invalidates cached CLI sessions everywhere.
      providerSessions.clear()
      return { success: true }
    }),

  testConnection: publicProcedure.mutation(async () => {
    // Fast + free: binary identity plus credential presence. This does
    // NOT validate the key (that needs a billed model call); runtime
    // auth errors stay authoritative per-turn.
    try {
      const probe = await probeQwen()
      if (!probe.available) {
        return {
          ok: false,
          detail: probe.detail ?? "qwen CLI not found",
        }
      }
      const held = getHeldCredential()
      if (held) {
        return {
          ok: true,
          detail:
            `qwen ${probe.version ?? ""} · mausCode-held ${held.authType} credential${held.label ? ` (${held.label})` : ""}`.trim(),
        }
      }
      const auth = probeQwenAuthHome()
      return {
        ok: auth.authenticated,
        detail: `qwen ${probe.version ?? ""} · ${auth.detail}`.trim(),
      }
    } catch (error) {
      return { ok: false, detail: extractQwenError(error).message }
    }
  }),

  disconnect: publicProcedure.mutation(() => {
    const db = getDatabase()
    db.delete(qwenCredentials).where(eq(qwenCredentials.id, "default")).run()
    providerSessions.clear()
    // Ambient CLI config (~/.qwen/settings.json, env) is untouched.
    return { success: true }
  }),

  listModels: publicProcedure.query(async () => {
    // No `qwen models` command exists: stored settings first, held
    // credential model next, docs-sourced static list last.
    const models: Array<{ id: string; name: string; source: string }> = []
    const seen = new Set<string>()
    const push = (id: string, name?: string, source?: string) => {
      if (!id || seen.has(id)) return
      seen.add(id)
      models.push({ id, name: name || id, source: source || "static" })
    }
    try {
      for (const stored of listQwenStoredModels()) {
        push(stored.id, stored.name, "stored")
      }
    } catch (error) {
      console.error("[qwen.listModels] stored models failed:", error)
    }
    const held = getHeldCredential()
    if (held?.model) {
      push(held.model, undefined, "held")
    }
    const defaultModel = models[0]?.id ?? DEFAULT_QWEN_MODEL
    for (const fallback of STATIC_QWEN_MODELS) {
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

            const runAuth = resolveRunAuth()
            const heldModel = getHeldCredential()?.model
            const existingMessages = parseStoredMessages(existingSubChat.messages)
            // Native -m takes the id verbatim (no static map).
            const selectedModel = input.model?.trim() || heldModel || undefined

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
              auth: runAuth,
            })
            let latestSessionId =
              input.sessionId ?? getLastSessionId(existingMessages) ?? printState.sessionId

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
              const normalized = extractQwenError(chunk)
              if (isQwenAuthErrorResult(normalized)) {
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
              } else if (chunk?.type === "tool-output-error") {
                // Deliberate improvement over the sibling routers (which
                // ignore this chunk in accumulation): failed tools
                // persist in the renderer's terminal error state instead
                // of a stuck "call" spinner after reload.
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
            // via read_file, which handles images/PDFs); stage base64
            // attachments to temp files per turn. Headless qwen has no
            // image-input flags, so this is the only posture (same as the
            // cursor backend).
            const { paths: imagePaths, cleanup: cleanupImageFiles } = await writeImageTempFiles(
              input.images,
              `qwen-${input.runId}`,
            )
            const promptWithImages =
              imagePaths.length > 0
                ? `${input.prompt}\n\nReferenced files:\n${imagePaths.join("\n")}`
                : input.prompt

            // First turns carry a client-chosen --session-id UUID: it is
            // known even when the run is interrupted before `result` (the
            // only event carrying the server-side id), so cancel-resume
            // keeps working.
            const freshSessionId = () => crypto.randomUUID()
            const buildInvocation = (sessionId: string | undefined, model: string | undefined) =>
              buildQwenPrintArgs({
                model,
                mode: input.mode,
                ...(runAuth?.authType ? { authType: runAuth.authType } : {}),
                ...(runAuth?.apiKey ? { apiKey: runAuth.apiKey } : {}),
                ...(runAuth?.baseUrl ? { baseUrl: runAuth.baseUrl } : {}),
                resumeId: sessionId,
                newSessionId: sessionId ? undefined : freshSessionId(),
                prompt: promptWithImages,
              })

            let invocation = buildInvocation(latestSessionId, selectedModel)

            if (abortController.signal.aborted) {
              // Cancelled while staging: never spawn; the finally below
              // clears the run.
              await cleanupImageFiles()
              safeComplete()
              return
            }

            // Pre-run failures are idempotent-safe (the CLI errors before
            // doing anything), so each downgrade retries at most once:
            // stale --resume ids restart as a fresh turn with a new
            // --session-id uuid, unknown models drop -m, and unknown
            // flags (older `qwen` builds) fall back to the stable subset.
            let attemptArgs = invocation.args
            let resumeDropped = false
            let modelDropped = false
            let flagsDowngraded = false
            let turnResult!: Awaited<ReturnType<typeof runQwenPrintTurn>["done"]>
            let activeTurn: ReturnType<typeof runQwenPrintTurn> | null = null
            abortController.signal.addEventListener(
              "abort",
              () => {
                activeTurn?.interrupt()
              },
              { once: true },
            )
            try {
              for (;;) {
                const launch = resolveQwenCliLaunch(attemptArgs)
                activeTurn = runQwenPrintTurn({
                  command: launch.command,
                  args: launch.args,
                  cwd: input.cwd,
                  env: buildQwenProviderEnv(input.mode),
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
                  isQwenResumeError(turnResult.errorMessage)
                ) {
                  // Stale session id (session deleted or expired): retry
                  // once as a fresh turn with a new client UUID.
                  resumeDropped = true
                  heldErrorChunk = null
                  latestSessionId = undefined
                  printState.sessionId = undefined
                  invocation = buildInvocation(undefined, selectedModel)
                  attemptArgs = invocation.args
                  continue
                }
                if (
                  !modelDropped &&
                  selectedModel &&
                  isQwenInvalidModelError(turnResult.errorMessage)
                ) {
                  // Stale/unknown model id (list drifted): retry once
                  // with the CLI default model.
                  modelDropped = true
                  heldErrorChunk = null
                  invocation = buildInvocation(latestSessionId, undefined)
                  attemptArgs = invocation.args
                  continue
                }
                if (!flagsDowngraded && isQwenUnknownFlagError(turnResult.errorMessage)) {
                  flagsDowngraded = true
                  heldErrorChunk = null
                  attemptArgs = buildQwenPrintFallbackArgs(attemptArgs)
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
              ...(turnResult.usage?.inputTokens !== undefined
                ? { inputTokens: turnResult.usage.inputTokens }
                : {}),
              ...(turnResult.usage?.outputTokens !== undefined
                ? { outputTokens: turnResult.usage.outputTokens }
                : {}),
              ...(turnResult.usage?.totalTokens !== undefined
                ? { totalTokens: turnResult.usage.totalTokens }
                : {}),
              ...(turnResult.finalTextId ? { finalTextId: turnResult.finalTextId } : {}),
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
              console.error("[qwen] Failed to persist messages:", error)
            }

            safeComplete()
          } catch (error) {
            const normalized = extractQwenError(error)

            console.error("[qwen] chat stream error:", error)
            if (isQwenAuthErrorResult(normalized)) {
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
      return await getAllQwenMcpConfigHandler()
    } catch (error) {
      console.error("[qwen.getAllMcpConfig] Error:", error)
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
        const group = await getQwenMcpConfigForProject(input.projectPath, {
          includeTools: true,
        })
        return {
          groups: group ? [group] : [],
          mcpServers: group?.mcpServers ?? [],
        }
      } catch (error) {
        console.error("[qwen.getMcpConfig] Error:", error)
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
