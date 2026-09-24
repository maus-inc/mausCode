/**
 * Native runtime router: the same chat contract as `claude.chat`, executed by
 * the mausCode (JCode) daemon instead of the Claude Agent SDK.
 *
 * Additive by design: legacy routers are untouched, and the renderer opts in
 * per sub-chat. Session state lives in the daemon; the app keeps only the id
 * mapping plus the in-progress `streamId` marker.
 */

import type { JcodeClient } from "@maus-inc/runtime-client"
import { observable } from "@trpc/server/observable"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { type AgentMode, agentModeSchema, DEFAULT_AGENT_MODE } from "../../../../shared/agent-mode"
import { EFFORT_LEVELS } from "../../../../shared/effort"
import { nativeModeRefusal } from "../../../../shared/permissions/native-mode-floor"
import { approvalWasDenied } from "../../claude/tool-approval"
import type { UIMessageChunk } from "../../claude/types"
import { getDatabase, subChats } from "../../db"
import { getRunStore } from "../../runs"
import type { RunHandle } from "../../runs/run-state"
import {
  applyNativeCredentials,
  ensureNativeSession,
  getMappedNativeSession,
  getRuntimeManager,
  NATIVE_QUESTION_PREFIX,
  NativeCredentialError,
  type NativeCredentialResult,
  type NativeEndpoints,
  NativeTranslator,
  normalizeEndpointUrl,
  probeEndpoint,
  readEndpointSettings,
  releaseNativeEphemeralCredentials,
  resolveNativeMcpSnapshot,
  restartRuntime,
  writeEndpointSettings,
} from "../../runtime"
import { consumeNativeTurnStream } from "../../runtime/consume-turn-stream"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

/**
 * In-flight native turns, keyed by subChat, for supersede + cancel.
 * `completed` marks that the producer already saw the daemon end the turn;
 * a teardown after that point must not rewrite the outcome as cancelled.
 */
const activeTurns = new Map<
  string,
  {
    cancelled: boolean
    completed: boolean
    cancelRemote: () => void
    /** Releases runtime-held keys this turn set, if any. */
    releaseCredentials?: () => void
  }
>()

/**
 * The permission request id each native sub-chat is awaiting, so a response
 * settles only the run that is actually waiting on it. The legacy registry in
 * `tool-approval.ts` holds the same invariant for the SDK path: a card that is
 * already gone cannot settle a newer run for the same sub-chat. The native
 * engine call carries the id too, but the engine accepting a stale or
 * duplicated id must not flip a different approval out of waiting_approval.
 */
const pendingNativeApprovals = new Map<string, string>()

function registerTurn(subChatId: string): {
  cancelled: boolean
  completed: boolean
  cancelRemote: () => void
  releaseCredentials?: () => void
} {
  const existing = activeTurns.get(subChatId)
  if (existing) {
    // Only mark the replaced turn cancelled while it is still producing; a
    // completed turn keeps its real outcome through the finally block.
    if (!existing.completed) {
      cancelTurn(existing)
    }
  }
  const turn = { cancelled: false, completed: false, cancelRemote: () => {} }
  activeTurns.set(subChatId, turn)
  return turn
}

/**
 * Mark a turn cancelled and ask the remote to stop. The callers check
 * `completed` first, because a turn the daemon already ended keeps its real
 * outcome, and the remote call is best-effort: a turn that is already gone
 * leaves nothing to ask.
 */
function cancelTurn(turn: { cancelled: boolean; cancelRemote: () => void }): void {
  turn.cancelled = true
  try {
    turn.cancelRemote()
  } catch {
    // The remote is already gone.
  }
}

type NativeEmit = (chunk: UIMessageChunk) => void
type NativeFail = (errorText: string) => void

// The chat handler below stays a flat sequence of these steps so its shape is
// readable at a glance; each step owns its own failure handling.

/**
 * The mode floor on the native transport.
 *
 * The stock bridge advertises no `permissions` capability, so it never issues a
 * permission prompt and this app gets no per-action callback to route through the
 * gate in `src/main/lib/permissions/`. Plan and ask both promise restraint that
 * nothing here can deliver, so the floor is enforced by refusing them, and the
 * reasoning and the refusal text live in
 * `src/shared/permissions/native-mode-floor.ts` where a test can reach them. When
 * the bridge grows that capability this is the step that starts evaluating
 * requests instead of refusing them.
 *
 * The gap is wider than the two refusals and is recorded rather than hidden. No
 * mode gets app-gate enforcement on this transport, so the classes edit, agent and
 * turbo promise to block are unenforced here exactly as they are for the
 * `engine-only` backends in `src/shared/provider-capabilities.ts`, and
 * `.dump/app/decisions/2026-09-13-permission-floor.md` names them as decision 25.
 * The transport picker in the chat input says so where a user chooses it.
 *
 * Named step, same shape as the rest of this handler: it owns its own failure
 * handling so the handler stays flat and the complexity gate stays green.
 */
function enforceNativeModeFloor(mode: AgentMode, fail: NativeFail): boolean {
  const refusal = nativeModeRefusal(mode)
  if (refusal === null) return true
  fail(refusal)
  return false
}

async function acquireNativeClient(fail: NativeFail): Promise<JcodeClient | null> {
  try {
    return await getRuntimeManager().getClient()
  } catch (error) {
    fail(`NATIVE_STARTUP_FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

async function openNativeSession(
  client: JcodeClient,
  subChatId: string,
  cwd: string,
  fail: NativeFail,
): Promise<string | null> {
  try {
    return await ensureNativeSession(client, subChatId, cwd)
  } catch (error) {
    fail(`NATIVE_SESSION_FAILED: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

function emitNativeSessionSnapshot(cwd: string, jcodeHome: string, safeEmit: NativeEmit): void {
  try {
    const snapshot = resolveNativeMcpSnapshot(cwd, jcodeHome)
    safeEmit({
      type: "session-init",
      tools: snapshot.servers.flatMap((s) => s.tools.map((t) => `mcp__${s.name}__${t}`)),
      mcpServers: snapshot.servers.map((s) => ({
        name: s.name,
        status: s.status,
      })),
      plugins: [],
      skills: [],
      toolsUnknown: true,
      ...(snapshot.errors.length > 0 && { mcpConfigErrors: snapshot.errors }),
    })
  } catch {
    // Snapshot is best-effort observability; never fail the turn.
  }
}

async function prepareNativeCredentials(
  client: JcodeClient,
  input: { customToken?: string; customBaseUrl?: string },
  sessionId: string,
  hooks: { fail: NativeFail; safeEmit: NativeEmit; safeComplete: () => void },
): Promise<NativeCredentialResult | null> {
  try {
    const applied = await applyNativeCredentials(
      client,
      {
        customToken: input.customToken,
        customBaseUrl: input.customBaseUrl,
      },
      sessionId,
    )
    return applied
  } catch (error) {
    if (error instanceof NativeCredentialError) {
      // Unsupported configuration, not missing credentials: say so.
      hooks.fail(`NATIVE_INVALID_REQUEST: ${error.message}`)
      return null
    }
    hooks.safeEmit({ type: "auth-error", errorText: "NATIVE_NO_CREDENTIALS" })
    hooks.safeComplete()
    return null
  }
}

async function setNativeModelWithRetry(
  client: JcodeClient,
  sessionId: string,
  model: string | undefined,
  safeEmit: NativeEmit,
): Promise<void> {
  if (!model) return
  // The account model list loads async after set_api_key; a fresh daemon
  // rejects set_model until it lands. Retry briefly before falling back to
  // the daemon default.
  let modelOk = false
  for (let attempt = 0; attempt < 4 && !modelOk; attempt++) {
    try {
      await client.setModel(sessionId, model)
      modelOk = true
    } catch {
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }
  if (!modelOk) {
    safeEmit({
      type: "retry-notification",
      message: `Model "${model}" is unavailable on the native runtime; using the daemon default.`,
    })
  }
}

function finishNativeTurnBookkeeping(
  runHandle: RunHandle | null,
  turn: { cancelled: boolean; completed: boolean; releaseCredentials?: () => void },
  subChatId: string,
  streamId: string,
): void {
  // Settle the run record. Idempotent: cancel and supersede paths already
  // settled it through the run store. A completed producer keeps its real
  // outcome: only a genuine cancel forces the cancelled status.
  runHandle?.settle(turn.cancelled && !turn.completed ? "cancelled" : undefined)
  if (activeTurns.get(subChatId) === turn) {
    activeTurns.delete(subChatId)
    // This turn's card is over: a late answer to it must not settle anything.
    pendingNativeApprovals.delete(subChatId)
  }
  try {
    turn.releaseCredentials?.()
  } catch {
    // Releasing a memory-only key is best-effort; nothing on disk depends on it.
  }
  try {
    // Clear the marker only when it is still this turn's: a replacement turn
    // writes its own streamId, and this finally must not wipe that.
    getDatabase()
      .update(subChats)
      .set({ streamId: null, updatedAt: new Date() })
      .where(and(eq(subChats.id, subChatId), eq(subChats.streamId, streamId)))
      .run()
  } catch {
    // Bookkeeping must not fail the turn.
  }
}

export const runtimeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        prompt: z.string(),
        cwd: z.string(),
        projectPath: z.string().optional(),
        mode: agentModeSchema.default(DEFAULT_AGENT_MODE),
        model: z.string().optional(),
        // Same vocabulary and same validation as the legacy chat router: one
        // effort scale across both engines, so a pane's visible level means
        // the same thing whichever transport runs it.
        effort: z.enum(EFFORT_LEVELS).optional(),
        customToken: z.string().optional(),
        customBaseUrl: z.string().optional(),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<UIMessageChunk>((emit) => {
        const subId = input.subChatId.slice(-8)
        // The mode floor runs before registerTurn: a refused plan or ask
        // request must not cancel the native turn it replaces, and the refusal
        // emits directly because nothing else of this turn exists yet to tear
        // down.
        const refuse = (errorText: string) => {
          try {
            emit.next({ type: "error", errorText })
            emit.complete()
          } catch {
            // The subscriber is already gone; there is nothing to deliver.
          }
        }
        if (!enforceNativeModeFloor(input.mode, refuse)) return () => {}

        const turn = registerTurn(input.subChatId)
        const translator = new NativeTranslator()
        let isActive = true
        // Run record for this turn (roadmap step 07). Created once the turn
        // is accepted, observed on every emitted chunk, settled in the finally.
        let runHandle: RunHandle | null = null

        const safeEmit = (chunk: UIMessageChunk) => {
          if (!isActive || turn.cancelled) return
          // A native permission card is the run's wait, keyed on its request id,
          // so respondApproval settles only the approval it actually answers.
          if (
            chunk.type === "ask-user-question" &&
            chunk.toolUseId.startsWith(NATIVE_QUESTION_PREFIX)
          ) {
            pendingNativeApprovals.set(
              input.subChatId,
              chunk.toolUseId.slice(NATIVE_QUESTION_PREFIX.length),
            )
          }
          if (runHandle) runHandle.observeChunk(chunk)
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }
        const safeComplete = () => {
          // The producer is ending on its own terms. Record completion before
          // emitting complete(): @trpc/server runs the subscription teardown
          // synchronously from complete(), and that teardown must see a
          // completed producer instead of marking a spurious cancel. A genuine
          // cancel already set the flag and wins.
          if (!turn.cancelled) turn.completed = true
          try {
            emit.complete()
          } catch {
            // Already closed.
          }
        }
        const fail = (errorText: string) => {
          safeEmit({ type: "error", errorText })
          safeComplete()
        }

        console.log(`[Native] M:START sub=${subId} mode=${input.mode}`)

        void (async () => {
          const streamId = crypto.randomUUID()
          try {
            runHandle = getRunStore().startRun({
              subChatId: input.subChatId,
              engine: "native",
              mode: input.mode,
              model: input.model,
            })

            for (const chunk of translator.beginTurn()) safeEmit(chunk)
            getDatabase()
              .update(subChats)
              .set({ streamId })
              .where(eq(subChats.id, input.subChatId))
              .run()

            const manager = getRuntimeManager()

            // Attach FIRST: the bridge rejects stateful requests (including
            // set_api_key) until the client has subscribed with a working_dir.
            // Credentials are still applied before the turn starts.
            const client = await acquireNativeClient(fail)
            if (!client) return

            const sessionId = await openNativeSession(client, input.subChatId, input.cwd, fail)
            if (!sessionId) return

            // Native session snapshot (MCP Phase 1 + session-init): the v1
            // harness exposes no tool list, so tools carries only cached
            // mcp__server__tool names with toolsUnknown set.
            emitNativeSessionSnapshot(input.cwd, manager.jcodeHome, safeEmit)

            const credentials = await prepareNativeCredentials(client, input, sessionId, {
              fail,
              safeEmit,
              safeComplete,
            })
            if (!credentials) return
            // A key held in the runtime's memory is released when this turn
            // ends; the next turn applies it again.
            turn.releaseCredentials = () => {
              void releaseNativeEphemeralCredentials(
                client,
                sessionId,
                credentials.ephemeralProviders,
                credentials.generation,
              )
            }

            await setNativeModelWithRetry(client, sessionId, input.model, safeEmit)

            // The daemon takes effort as its own request, after the model so
            // the provider context is settled. Applied best-effort: a refusal
            // (a level this provider will not accept, an older daemon) leaves
            // the turn running at the daemon's default rather than failing a
            // prompt over a reasoning preference.
            if (input.effort) {
              try {
                await client.setReasoningEffort(sessionId, input.effort)
              } catch (error) {
                console.warn(
                  `[Native] set_reasoning_effort refused (${input.effort}): ${
                    error instanceof Error ? error.message : String(error)
                  }`,
                )
              }
            }

            // The turn may have been cancelled while the daemon was starting;
            // never send a doomed turn (it would run uncancelled server-side).
            if (!isActive || turn.cancelled) {
              safeComplete()
              return
            }

            // Subscribe before sending: the bridge does not replay events that
            // arrive before attachment completes.
            const stream = client.events(sessionId)
            turn.cancelRemote = () => {
              void client.cancel(sessionId).catch(() => {})
              void stream.return?.(undefined)?.catch(() => {})
            }
            await client.sendMessage(sessionId, input.prompt, {
              images: input.images?.map(
                (img) => [img.mediaType, img.base64Data] as [string, string],
              ),
            })

            await consumeNativeTurnStream(
              stream,
              translator,
              () => !isActive || turn.cancelled,
              safeEmit,
              (runEvent) => {
                runHandle?.noteHarnessEvent(runEvent.kind, runEvent.payload)
              },
              () => {
                turn.completed = true
              },
            )
            safeComplete()
            console.log(`[Native] M:END sub=${subId}`)
          } catch (error) {
            if (!turn.cancelled) {
              console.error(`[Native] M:FAIL sub=${subId}:`, error)
              fail(`NATIVE_TURN_FAILED: ${error instanceof Error ? error.message : String(error)}`)
            } else {
              safeComplete()
            }
          } finally {
            finishNativeTurnBookkeeping(runHandle, turn, input.subChatId, streamId)
          }
        })()

        return () => {
          isActive = false
          // Only a teardown before producer completion is a cancel: once the
          // daemon has ended the turn, the finally block preserves the real
          // outcome and there is nothing left to cancel remotely either.
          if (!turn.completed) {
            cancelTurn(turn)
          }
        }
      })
    }),

  cancel: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    const turn = activeTurns.get(input.subChatId)
    // A turn the daemon already completed keeps its real outcome: neither the
    // in-memory flag nor the persisted run may be rewritten as cancelled.
    if (turn?.completed) {
      return { cancelled: false }
    }
    if (turn) {
      cancelTurn(turn)
      activeTurns.delete(input.subChatId)
    }
    // Settling the persisted run counts as a cancel too, so a caller after a
    // reload or recovery still hears that something was cancelled.
    const settledRun = getRunStore().cancelActiveForSubChat(input.subChatId, "user_cancel")
    return { cancelled: !!turn || settledRun }
  }),

  isActive: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(({ input }) => activeTurns.has(input.subChatId)),

  respondApproval: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        requestId: z.string(),
        approved: z.boolean(),
        /**
         * The picked labels, forwarded so a Deny pick can be read. The card
         * submits `approved: true` whichever option the user takes, so the
         * boolean on its own would answer allow to a refusal.
         */
        updatedInput: z.unknown().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const sessionId = getMappedNativeSession(input.subChatId)
      if (!sessionId) return { ok: false, reason: "no-session" as const }
      let client: JcodeClient
      try {
        client = await getRuntimeManager().getClient()
      } catch {
        return { ok: false, reason: "unavailable" as const }
      }
      const approved = !approvalWasDenied({
        approved: input.approved,
        ...(input.updatedInput === undefined ? {} : { updatedInput: input.updatedInput }),
      })
      try {
        await client.respondToPermission(sessionId, input.requestId, approved ? "allow" : "deny")
        // Settle the run only for the approval it actually answered. The
        // engine accepting a stale or duplicated id must not flip a different
        // approval out of waiting_approval, which the legacy registry already
        // forbids for the SDK path.
        if (pendingNativeApprovals.get(input.subChatId) === input.requestId) {
          pendingNativeApprovals.delete(input.subChatId)
          getRunStore().resolveApprovalForSubChat(input.subChatId, approved)
        }
        return { ok: true }
      } catch {
        // Stock bridge has no permissions capability yet; the call path is
        // wired for the runtime patch that adds it.
        return { ok: false, reason: "unsupported" as const }
      }
    }),

  rewind: publicProcedure
    .input(z.object({ subChatId: z.string(), messageIndex: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const sessionId = getMappedNativeSession(input.subChatId)
      if (!sessionId) return { ok: false, reason: "no-session" as const }
      const client = await getRuntimeManager().getClient()
      await client.rewind(sessionId, input.messageIndex)
      return { ok: true }
    }),

  compact: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(async ({ input }) => {
      const sessionId = getMappedNativeSession(input.subChatId)
      if (!sessionId) return { ok: false, reason: "no-session" as const }
      const client = await getRuntimeManager().getClient()
      const message = await client.compact(sessionId)
      return { ok: true as const, message }
    }),

  endpoints: router({
    get: publicProcedure.query(() => readEndpointSettings()),

    set: publicProcedure
      .input(
        z.object({
          openaiBaseUrl: z.string().optional(),
          anthropicBaseUrl: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        // Empty string clears; anything else must be a valid http(s) URL.
        const clean = (raw: string | undefined): string | null => {
          if (raw === undefined || raw.trim() === "") return null
          return normalizeEndpointUrl(raw)
        }
        let settings: NativeEndpoints
        try {
          settings = {
            openaiBaseUrl: clean(input.openaiBaseUrl),
            anthropicBaseUrl: clean(input.anthropicBaseUrl),
          }
        } catch (error) {
          throw new Error(error instanceof Error ? error.message : "Invalid endpoint URL")
        }
        writeEndpointSettings(settings)
        // Endpoint changes apply at daemon launch: abort in-flight native turns
        // and relaunch so the new env takes effect. Daemon sessions persist.
        abortAllNativeTurns()
        await restartRuntime()
        return settings
      }),

    probe: publicProcedure.input(z.object({ url: z.string() })).mutation(async ({ input }) => {
      try {
        return await probeEndpoint(input.url)
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : "Invalid URL" }
      }
    }),
  }),

  status: publicProcedure.query(async () => {
    const manager = getRuntimeManager()
    const daemon = manager.status()
    let supportsPermissions = false
    if (daemon === "ready") {
      try {
        supportsPermissions = (await manager.getClient()).supports("permissions")
      } catch {
        supportsPermissions = false
      }
    }
    return { daemon, supportsPermissions }
  }),
})

/** Active-turn introspection for app shutdown prompts (mirrors legacy helpers). */
export function hasActiveNativeTurns(): boolean {
  return activeTurns.size > 0
}

export function abortAllNativeTurns(): void {
  for (const turn of activeTurns.values()) {
    // Completed turns keep their real outcome through the finally block.
    if (!turn.completed) {
      turn.cancelled = true
      try {
        turn.cancelRemote()
      } catch {
        // Best-effort.
      }
    }
  }
  activeTurns.clear()
}
