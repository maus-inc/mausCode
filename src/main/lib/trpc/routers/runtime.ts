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
import { eq } from "drizzle-orm"
import { z } from "zod"
import type { UIMessageChunk } from "../../claude/types"
import { getDatabase, subChats } from "../../db"
import { getRunStore } from "../../runs"
import { observeRunChunk, type RunHandle } from "../../runs/run-state"
import {
  applyNativeCredentials,
  ensureNativeSession,
  getMappedNativeSession,
  getRuntimeManager,
  NativeCredentialError,
  type NativeEndpoints,
  NativeTranslator,
  normalizeEndpointUrl,
  probeEndpoint,
  readEndpointSettings,
  resolveNativeMcpSnapshot,
  restartRuntime,
  writeEndpointSettings,
} from "../../runtime"
import { publicProcedure, router } from "../index"

const imageAttachmentSchema = z.object({
  base64Data: z.string(),
  mediaType: z.string(),
  filename: z.string().optional(),
})

/** In-flight native turns, keyed by subChat, for supersede + cancel. */
const activeTurns = new Map<string, { cancelled: boolean; cancelRemote: () => void }>()

function registerTurn(subChatId: string): { cancelled: boolean; cancelRemote: () => void } {
  const existing = activeTurns.get(subChatId)
  if (existing) {
    existing.cancelled = true
    try {
      existing.cancelRemote()
    } catch {
      // Superseded turn already gone; the new turn proceeds.
    }
  }
  const turn = { cancelled: false, cancelRemote: () => {} }
  activeTurns.set(subChatId, turn)
  return turn
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
        mode: z.enum(["plan", "ask", "edit", "agent", "turbo"]).default("agent"),
        model: z.string().optional(),
        customToken: z.string().optional(),
        customBaseUrl: z.string().optional(),
        images: z.array(imageAttachmentSchema).optional(),
      }),
    )
    .subscription(({ input }) => {
      return observable<UIMessageChunk>((emit) => {
        const turn = registerTurn(input.subChatId)
        const translator = new NativeTranslator()
        const subId = input.subChatId.slice(-8)
        let isActive = true
        // Run record for this turn (roadmap step 07). Created once the turn
        // is accepted, observed on every emitted chunk, settled in the finally.
        let runHandle: RunHandle | null = null

        const safeEmit = (chunk: UIMessageChunk) => {
          if (!isActive || turn.cancelled) return
          if (runHandle) observeRunChunk(runHandle, chunk)
          try {
            emit.next(chunk)
          } catch {
            isActive = false
          }
        }
        const safeComplete = () => {
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
          const db = getDatabase()
          const streamId = crypto.randomUUID()
          try {
            if (input.mode === "plan") {
              fail(
                "Plan mode is not enforced on the native runtime yet (read-only " +
                  "execution arrives with the permission policy). Use the legacy " +
                  "transport for plan mode.",
              )
              return
            }

            runHandle = getRunStore().startRun({
              subChatId: input.subChatId,
              engine: "native",
              mode: input.mode,
              model: input.model,
            })

            for (const chunk of translator.beginTurn()) safeEmit(chunk)
            db.update(subChats).set({ streamId }).where(eq(subChats.id, input.subChatId)).run()

            const manager = getRuntimeManager()
            let client: JcodeClient
            try {
              client = await manager.getClient()
            } catch (error) {
              fail(
                `NATIVE_STARTUP_FAILED: ${error instanceof Error ? error.message : String(error)}`,
              )
              return
            }

            // Attach FIRST: the bridge rejects stateful requests (including
            // set_api_key) until the client has subscribed with a working_dir.
            // Credentials are still applied before the turn starts.
            let sessionId: string
            try {
              sessionId = await ensureNativeSession(client, input.subChatId, input.cwd)
            } catch (error) {
              fail(
                `NATIVE_SESSION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
              )
              return
            }

            // Native session snapshot (MCP Phase 1 + session-init): the v1
            // harness exposes no tool list, so tools carries only cached
            // mcp__server__tool names with toolsUnknown set.
            try {
              const snapshot = resolveNativeMcpSnapshot(input.cwd, manager.jcodeHome)
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

            try {
              await applyNativeCredentials(client, {
                customToken: input.customToken,
                customBaseUrl: input.customBaseUrl,
              })
            } catch (error) {
              if (error instanceof NativeCredentialError) {
                // Unsupported configuration, not missing credentials: say so.
                fail(`NATIVE_INVALID_REQUEST: ${error.message}`)
                return
              }
              safeEmit({ type: "auth-error", errorText: "NATIVE_NO_CREDENTIALS" })
              safeComplete()
              return
            }

            if (input.model) {
              // The account model list loads async after set_api_key; a fresh
              // daemon rejects set_model until it lands. Retry briefly before
              // falling back to the daemon default.
              let modelOk = false
              for (let attempt = 0; attempt < 4 && !modelOk; attempt++) {
                try {
                  await client.setModel(sessionId, input.model)
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
                  message: `Model "${input.model}" is unavailable on the native runtime; using the daemon default.`,
                })
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

            for await (const event of stream) {
              if (!isActive || turn.cancelled) break
              for (const chunk of translator.translate(event)) safeEmit(chunk)
              if (event.ev === "turn_done") break
              if (event.ev === "error") break
            }
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
            // Settle the run record. Idempotent: cancel and supersede paths
            // already settled it through the run store.
            runHandle?.settle(turn.cancelled ? "cancelled" : undefined)
            if (activeTurns.get(input.subChatId) === turn) {
              activeTurns.delete(input.subChatId)
            }
            try {
              db.update(subChats)
                .set({ streamId: null, updatedAt: new Date() })
                .where(eq(subChats.id, input.subChatId))
                .run()
            } catch {
              // Bookkeeping must not fail the turn.
            }
          }
        })()

        return () => {
          isActive = false
          turn.cancelled = true
          try {
            turn.cancelRemote()
          } catch {
            // Client already gone.
          }
        }
      })
    }),

  cancel: publicProcedure.input(z.object({ subChatId: z.string() })).mutation(({ input }) => {
    const turn = activeTurns.get(input.subChatId)
    if (turn) {
      turn.cancelled = true
      try {
        turn.cancelRemote()
      } catch {
        // Remote already gone.
      }
      activeTurns.delete(input.subChatId)
    }
    getRunStore().cancelActiveForSubChat(input.subChatId, "user_cancel")
    return { cancelled: !!turn }
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
      }),
    )
    .mutation(async ({ input }) => {
      // The user answered, so the run leaves waiting_approval either way.
      getRunStore().resolveApprovalForSubChat(input.subChatId, input.approved)
      const sessionId = getMappedNativeSession(input.subChatId)
      if (!sessionId) return { ok: false, reason: "no-session" as const }
      let client: JcodeClient
      try {
        client = await getRuntimeManager().getClient()
      } catch {
        return { ok: false, reason: "unavailable" as const }
      }
      try {
        await client.respondToPermission(
          sessionId,
          input.requestId,
          input.approved ? "allow" : "deny",
        )
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
    turn.cancelled = true
    try {
      turn.cancelRemote()
    } catch {
      // Best-effort.
    }
  }
  activeTurns.clear()
}
