import { createTRPCProxyClient, TRPCClientError, type TRPCLink } from "@trpc/client"
import { createTRPCReact } from "@trpc/react-query"
import { observable } from "@trpc/server/observable"
import superjson from "superjson"
import { ipcLink } from "trpc-electron/renderer"
import type { AppRouter } from "../../main/lib/trpc/routers"

/**
 * React hooks for tRPC
 */
export const trpc: ReturnType<typeof createTRPCReact<AppRouter>> = createTRPCReact<AppRouter>()

/**
 * The Electron preload script exposes `globalThis.electronTRPC` (via
 * `exposeElectronTRPC`). In a plain browser (e.g. web preview) it is absent
 * and `ipcLink()` throws at construction — so only build it when present.
 */
function hasElectronPreload(): boolean {
  return typeof globalThis !== "undefined" && !!(globalThis as Record<string, unknown>).electronTRPC
}

/**
 * Terminating link used outside Electron: every operation fails fast with a
 * clear message instead of crashing module init. React Query surfaces these
 * as ordinary query errors, so the UI renders its empty/error states.
 */
function unavailableLink(): TRPCLink<AppRouter> {
  return () => (opts) =>
    observable((observer) => {
      observer.error(
        new TRPCClientError<AppRouter>(
          `[mausCode] Local backend unavailable in browser (procedure: ${opts.op.path})`,
        ),
      )
    })
}

/**
 * Links for the local (Electron IPC) backend. Safe to call in a browser.
 */
export function createLocalLinks(): TRPCLink<AppRouter>[] {
  if (hasElectronPreload()) {
    return [ipcLink({ transformer: superjson })]
  }
  console.warn(
    "[mausCode] electronTRPC preload missing — local data calls will fail (browser mode)",
  )
  return [unavailableLink()]
}

/**
 * Vanilla client for use outside React components (stores, utilities)
 */
export const trpcClient = createTRPCProxyClient<AppRouter>({
  links: createLocalLinks(),
})
