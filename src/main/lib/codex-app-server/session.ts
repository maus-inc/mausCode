/**
 * mausCode adapter over the ported T3 app-server client (NOT verbatim port).
 *
 * Promise-based sessions: one `codex app-server` child process per session,
 * Effect scope owned by the session, app-server events translated onto the
 * AI-SDK UIMessageStream chunk dialect the renderer already consumes
 * (text-start/delta/end, tool-input-start/available, tool-output-available,
 * finish, error, message-metadata).
 *
 * Server requests are answered unattended (parity with the ACP path):
 * approvals auto-grant session-wide, user-input prompts take first options,
 * MCP elicitations decline, client tool calls fail (we expose none), and
 * token-refresh/attestation fail (codex owns that auth, not us).
 */
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as CodexClient from "./src/client.ts"

export type CodexSessionChunk = any

export type CodexTurnInput = { type: "text"; text: string } | { type: "localImage"; path: string }

export type CodexTurnResult =
  | { status: "completed" }
  | { status: "interrupted" }
  | { status: "error"; errorMessage: string }

export type CodexAppServerSession = {
  threadId: string
  /** Codex session id (session-file key for usage polling). */
  sessionId: string
  /**
   * Rebind the chunk sink (a session outlives a single streamed run; exactly
   * one run is in flight at a time).
   */
  setOnChunk: (onChunk: (chunk: CodexSessionChunk) => void) => void
  startTurn(
    input: CodexTurnInput[],
    opts?: { model?: string; effort?: string },
  ): Promise<CodexTurnResult>
  interrupt(): Promise<void>
  dispose(): Promise<void>
}

type Client = typeof CodexClient.CodexAppServerClient.Service

function firstOptionAnswers(payload: {
  questions: ReadonlyArray<{
    id: string
    options?: ReadonlyArray<{ label: string }> | null
  }>
}): { answers: Record<string, { answers: string[] }> } {
  return {
    answers: Object.fromEntries(
      payload.questions.map((question) => [
        question.id,
        {
          answers:
            question.options && question.options.length > 0 ? [question.options[0]!.label] : ["ok"],
        },
      ]),
    ),
  }
}

export async function createCodexAppServerSession(opts: {
  binaryPath: string
  /** Full argv for the binary, e.g. ["-c", "k=v", "app-server"]. */
  argv: string[]
  cwd: string
  env: Record<string, string>
  existingThreadId?: string
  /**
   * Pre-migration codex session id (persisted in message metadata). When no
   * thread id is known, the session lists threads once and resumes the one
   * whose session id matches, so pre-migration chats keep their context.
   */
  legacySessionId?: string
  model?: string
  onChunk: (chunk: CodexSessionChunk) => void
}): Promise<CodexAppServerSession> {
  const scope = await Effect.runPromise(Scope.make())
  const nodeContext = await Effect.runPromise(
    Layer.buildWithScope(NodeServices.layer, scope) as Effect.Effect<
      Context.Context<never>,
      never,
      never
    >,
  )
  const runContext = Context.add(nodeContext, Scope.Scope, scope)
  const run = <A, E>(eff: Effect.Effect<A, E, any>): Promise<A> =>
    Effect.runPromise(Effect.provide(eff, runContext) as Effect.Effect<A, E, never>)

  let emit = opts.onChunk

  // Per-turn mutable state (single in-flight turn per session).
  let turnDone: ((result: CodexTurnResult) => void) | null = null
  let turnSettled = false
  const settleTurn = (result: CodexTurnResult) => {
    if (turnSettled) return
    turnSettled = true
    turnDone?.(result)
  }
  const textStarted = new Set<string>()
  const resetTurnState = () => {
    turnSettled = false
    turnDone = null
    textStarted.clear()
  }

  const emitToolTrio = (toolCallId: string, toolName: string, input: unknown, output: unknown) => {
    emit({ type: "tool-input-start", toolCallId, toolName })
    emit({ type: "tool-input-available", toolCallId, toolName, input })
    emit({ type: "tool-output-available", toolCallId, output })
  }

  const handleCompletedItem = (item: any) => {
    if (!item || typeof item.type !== "string") return
    switch (item.type) {
      case "agentMessage": {
        emit({ type: "text-end", id: item.id })
        break
      }
      case "commandExecution": {
        emitToolTrio(
          item.id,
          "Bash",
          { command: item.command, cwd: item.cwd },
          {
            output: item.aggregatedOutput ?? "",
            exitCode: item.exitCode ?? null,
          },
        )
        break
      }
      case "fileChange": {
        const changes = Array.isArray(item.changes) ? item.changes : []
        changes.forEach((change: any, index: number) => {
          emitToolTrio(
            `${item.id}-${index}`,
            "Edit",
            { file_path: change?.path ?? "", kind: change?.kind ?? "" },
            { diff: change?.diff ?? "" },
          )
        })
        break
      }
      case "mcpToolCall": {
        emitToolTrio(
          item.id,
          `mcp__${item.server}__${item.tool}`,
          item.arguments ?? {},
          item.error != null ? { error: item.error } : (item.result ?? {}),
        )
        break
      }
      case "dynamicToolCall": {
        emitToolTrio(
          item.id,
          typeof item.tool === "string" ? item.tool : "DynamicTool",
          item.arguments ?? {},
          item.contentItems ?? { success: item.success ?? null },
        )
        break
      }
      case "webSearch": {
        emitToolTrio(
          item.id,
          "WebSearch",
          { query: item.query ?? "" },
          { results: item.results ?? [] },
        )
        break
      }
      case "reasoning": {
        const text = Array.isArray(item.summary)
          ? item.summary.join("\n")
          : Array.isArray(item.content)
            ? item.content.join("\n")
            : ""
        emitToolTrio(item.id, "Thinking", { text }, { text })
        break
      }
      case "plan": {
        if (typeof item.text === "string" && item.text.length > 0) {
          const id = `plan-${item.id}`
          emit({ type: "text-start", id })
          emit({ type: "text-delta", id, delta: item.text })
          emit({ type: "text-end", id })
        }
        break
      }
      default: {
        // userMessage, hookPrompt, imageView/generation, collab, review
        // markers, path, sleep, special, subAgentActivity, contextCompaction:
        // no chunk mapping; codex session files keep the full record.
        break
      }
    }
  }

  const handle = await run(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      return yield* spawner.spawn(
        ChildProcess.make(opts.binaryPath, opts.argv, {
          cwd: opts.cwd,
          env: opts.env,
        }),
      )
    }),
  )

  const client: Client = await run(
    Effect.gen(function* () {
      const ctx = yield* Layer.buildWithScope(CodexClient.layerChildProcess(handle), scope)
      return Context.get(ctx, CodexClient.CodexAppServerClient)
    }),
  )

  // Server requests: answer unattended (ACP parity).
  await run(
    Effect.gen(function* () {
      const approveSession = (_payload: unknown) =>
        Effect.succeed({ decision: "approved_for_session" as const })
      // NOTE: v2 item approvals use accept/acceptForSession, while the legacy
      // exec/applyPatch approvals use approved/approved_for_session.
      yield* client.handleServerRequest("item/commandExecution/requestApproval", () =>
        Effect.succeed({ decision: "acceptForSession" as const }),
      )
      yield* client.handleServerRequest("item/permissions/requestApproval", (payload) =>
        Effect.succeed({
          permissions: payload.permissions,
          scope: "session" as const,
        }),
      )
      yield* client.handleServerRequest("item/fileChange/requestApproval", () =>
        Effect.succeed({ decision: "acceptForSession" as const }),
      )
      yield* client.handleServerRequest("applyPatchApproval", approveSession)
      yield* client.handleServerRequest("execCommandApproval", approveSession)
      yield* client.handleServerRequest("item/tool/requestUserInput", (payload) =>
        Effect.succeed(firstOptionAnswers(payload)),
      )
      yield* client.handleServerRequest("mcpServer/elicitation/request", () =>
        Effect.succeed({ action: "decline" as const }),
      )
      yield* client.handleServerRequest("item/tool/call", () =>
        Effect.succeed({ contentItems: [], success: false }),
      )
      yield* client.handleServerRequest("account/chatgptAuthTokens/refresh", () =>
        Effect.fail({
          _tag: "CodexAppServerRequestError",
          message: "mausCode does not hold ChatGPT tokens",
        } as never),
      )
      yield* client.handleServerRequest("attestation/generate", () =>
        Effect.fail({
          _tag: "CodexAppServerRequestError",
          message: "mausCode cannot mint attestations",
        } as never),
      )
      yield* client.handleUnknownServerRequest((method, params) => {
        console.warn(`[codex-app-server] Unknown server request: ${method}`)
        return Effect.fail({
          _tag: "CodexAppServerRequestError",
          message: `Unsupported server request: ${method}`,
        } as never)
      })
    }),
  )

  // Notifications -> chunks.
  await run(
    Effect.gen(function* () {
      yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
        Effect.sync(() => {
          if (!textStarted.has(payload.itemId)) {
            textStarted.add(payload.itemId)
            emit({ type: "text-start", id: payload.itemId })
          }
          emit({
            type: "text-delta",
            id: payload.itemId,
            delta: payload.delta,
          })
        }),
      )
      yield* client.handleServerNotification("item/completed", (payload) =>
        Effect.sync(() => handleCompletedItem(payload.item)),
      )
      yield* client.handleServerNotification("turn/completed", (payload) =>
        Effect.sync(() => {
          const turn = payload.turn as { error?: unknown } | undefined
          if (turn?.error != null) {
            const message = typeof turn.error === "string" ? turn.error : JSON.stringify(turn.error)
            emit({ type: "error", errorText: message })
            settleTurn({ status: "error", errorMessage: message })
          } else {
            settleTurn({ status: "completed" })
          }
        }),
      )
      yield* client.handleServerNotification("error", (payload) =>
        Effect.sync(() => {
          const message =
            typeof payload.error === "string" ? payload.error : JSON.stringify(payload.error)
          // willRetry errors are transient (codex retries the turn itself):
          // log and wait for the terminal outcome instead of failing the UI.
          if (payload.willRetry) {
            console.warn(`[codex-app-server] Transient turn error: ${message}`)
            return
          }
          emit({ type: "error", errorText: message })
          settleTurn({ status: "error", errorMessage: message })
        }),
      )
      yield* client.handleUnknownServerNotification((method) =>
        Effect.sync(() => {
          console.debug(`[codex-app-server] Unknown notification: ${method}`)
        }),
      )
    }),
  )

  await run(
    Effect.gen(function* () {
      yield* client.request("initialize", {
        clientInfo: {
          name: "mauscode-codex-app-server",
          title: "mausCode Codex adapter",
          version: "0.0.0",
        },
        capabilities: { experimentalApi: true, optOutNotificationMethods: null },
      })
      yield* client.notify("initialized", undefined)
    }),
  )

  const startFreshThread = async (): Promise<{
    threadId: string
    sessionId: string
  }> => {
    const started = await run(
      client.request("thread/start", {
        cwd: opts.cwd,
        model: opts.model ?? null,
        approvalPolicy: "never",
      }),
    )
    return { threadId: started.thread.id, sessionId: started.thread.sessionId }
  }

  let threadId: string
  let sessionId: string
  if (opts.existingThreadId) {
    try {
      const resumed = await run(
        client.request("thread/resume", {
          threadId: opts.existingThreadId,
        }),
      )
      threadId = resumed.thread.id
      sessionId = resumed.thread.sessionId
    } catch (error) {
      console.warn(
        `[codex-app-server] thread/resume failed for ${opts.existingThreadId}, starting fresh:`,
        error,
      )
      ;({ threadId, sessionId } = await startFreshThread())
    }
  } else if (opts.legacySessionId) {
    let resumedThreadId: string | null = null
    try {
      const listed = await run(client.request("thread/list", { useStateDbOnly: false }))
      resumedThreadId =
        listed.data.find((thread) => thread.sessionId === opts.legacySessionId)?.id ?? null
    } catch (error) {
      console.warn("[codex-app-server] thread/list failed:", error)
    }
    if (resumedThreadId) {
      try {
        const resumed = await run(client.request("thread/resume", { threadId: resumedThreadId }))
        threadId = resumed.thread.id
        sessionId = resumed.thread.sessionId
      } catch (error) {
        console.warn(
          `[codex-app-server] thread/resume failed for ${resumedThreadId}, starting fresh:`,
          error,
        )
        ;({ threadId, sessionId } = await startFreshThread())
      }
    } else {
      ;({ threadId, sessionId } = await startFreshThread())
    }
  } else {
    ;({ threadId, sessionId } = await startFreshThread())
  }

  let disposed = false
  let currentTurnId: string | null = null
  return {
    threadId,
    sessionId,
    setOnChunk: (onChunk) => {
      emit = onChunk
    },
    startTurn: async (input, turnOpts) => {
      resetTurnState()
      currentTurnId = null
      const done = new Promise<CodexTurnResult>((resolve) => {
        turnDone = resolve
      })
      const started = await run(
        client.request("turn/start", {
          threadId,
          input,
          model: turnOpts?.model ?? null,
          effort: turnOpts?.effort ?? null,
          approvalPolicy: "never",
        }),
      )
      currentTurnId = started.turn.id
      return done
    },
    interrupt: async () => {
      if (currentTurnId) {
        try {
          await run(
            client.request("turn/interrupt", {
              threadId,
              turnId: currentTurnId,
            }),
          )
        } catch {
          // Best effort: process may already be gone.
        }
      }
      settleTurn({ status: "interrupted" })
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      settleTurn({ status: "interrupted" })
      try {
        await Effect.runPromise(handle.kill())
      } catch {
        // Best effort: process may already be gone.
      }
      try {
        await Effect.runPromise(Scope.close(scope, Exit.void))
      } catch {
        // Best effort.
      }
    },
  }
}
