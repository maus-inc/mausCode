/**
 * Shared `codex app-server` child-process bootstrap (mausCode-authored, NOT a
 * T3 port).
 *
 * One place owns spawning the pinned binary, wiring the ported Effect client
 * to its stdio, and reaping the child. Both the chat session in `session.ts`
 * and the model-catalog read in `../providers/codex-models.ts` build on this,
 * so the two cannot drift into spawning the binary differently.
 *
 * The bootstrap deliberately stops before the `initialize` handshake. Server
 * requests can arrive during that handshake, so the caller registers its
 * handlers first and then calls the returned `run` with `initializeHandshake`.
 */

import * as NodeServices from "@effect/platform-node/NodeServices"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as CodexClient from "./src/client.ts"

/**
 * The client's service shape. The ported adapter used
 * `typeof CodexAppServerClient.Service`, which resolves to an empty object
 * type and silently accepts any method call; the shape makes a wrong method
 * name a compile error.
 */
export type CodexAppServerClient = Context.Service.Shape<typeof CodexClient.CodexAppServerClient>

/**
 * The `initialize` request plus its `initialized` notification. Callers run
 * this through the returned `run` after their handlers are registered, so a
 * server request that arrives during the handshake is already answered.
 */
export const initializeHandshake = Effect.gen(function* () {
  const client = yield* CodexClient.CodexAppServerClient
  yield* client.request("initialize", {
    clientInfo: {
      name: "mauscode-codex-app-server",
      title: "mausCode Codex adapter",
      version: "0.0.0",
    },
    capabilities: { experimentalApi: true, optOutNotificationMethods: null },
  })
  yield* client.notify("initialized", undefined)
})

export type CodexAppServerConnection = {
  client: CodexAppServerClient
  /** Run an Effect against this child's client, in the child's scope. */
  run: <A, E>(eff: Effect.Effect<A, E, unknown>) => Promise<A>
  /** Kill the child and close its scope. Safe to call twice. */
  dispose: () => Promise<void>
}

export async function connectCodexAppServer(opts: {
  binaryPath: string
  /** Full argv for the binary, e.g. ["-c", "k=v", "app-server"]. */
  argv: string[]
  cwd: string
  env: Record<string, string>
}): Promise<CodexAppServerConnection> {
  const scope = await Effect.runPromise(Scope.make())
  const nodeContext = await Effect.runPromise(
    Layer.buildWithScope(NodeServices.layer, scope) as Effect.Effect<
      Context.Context<never>,
      never,
      never
    >,
  )
  let runContext = Context.add(nodeContext, Scope.Scope, scope)
  const run = <A, E>(eff: Effect.Effect<A, E, unknown>): Promise<A> =>
    Effect.runPromise(Effect.provide(eff, runContext) as Effect.Effect<A, E, never>)

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

  const client: CodexAppServerClient = await run(
    Effect.gen(function* () {
      const ctx = yield* Layer.buildWithScope(CodexClient.layerChildProcess(handle), scope)
      return Context.get(ctx, CodexClient.CodexAppServerClient)
    }),
  )

  // Callers reach the client from the context as well as from the returned
  // handle, so `initializeHandshake` needs no argument and cannot be handed a
  // client from a different child process.
  runContext = Context.add(runContext, CodexClient.CodexAppServerClient, client)

  // A notification neither caller handles is still logged, not swallowed.
  await run(
    client.handleUnknownServerNotification((method) =>
      Effect.sync(() => {
        console.debug(`[codex-app-server] Unknown notification: ${method}`)
      }),
    ),
  )

  let disposed = false
  return {
    client,
    run,
    dispose: async () => {
      if (disposed) return
      disposed = true
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
