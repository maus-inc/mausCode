/**
 * Persistence for the renderer values that hold provider credentials.
 *
 * Browser storage keeps nothing secret. Values live in memory and are written
 * through the app secret store in the main process, which encrypts them at rest
 * or refuses the write. A value saved by an earlier version is still read from
 * browser storage and moved into the secret store once it can be stored there.
 */
import type { SyncStorage } from "jotai/vanilla/utils/atomWithStorage"
import { trpcClient } from "./trpc"

export type RendererSecretKey =
  | "agents:claude-custom-config"
  | "agents:model-profiles"
  | "agents:openai-api-key"
  | "onboarding:codex-api-key"

export const RENDERER_SECRET_KEYS: readonly RendererSecretKey[] = [
  "agents:claude-custom-config",
  "agents:model-profiles",
  "agents:openai-api-key",
  "onboarding:codex-api-key",
]

type Listener = (value: unknown) => void

/** What one write did, so a caller can tell the user the truth about it. */
export type RendererSecretWrite = { ok: true } | { ok: false; error: string }

const cache = new Map<string, string>()
const listeners = new Map<string, Set<Listener>>()
/** Keys the user changed in this session, which hydration must not overwrite. */
const edited = new Set<string>()
/** One chain per key, so an older write can never land after a newer one. */
const writes = new Map<string, Promise<RendererSecretWrite>>()
let started = false

function browserStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

function emit(key: string, raw: string): void {
  cache.set(key, raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  for (const listener of listeners.get(key) ?? []) listener(parsed)
}

async function hydrate(): Promise<void> {
  let stored: { values: Record<string, string>; error: string | null }
  try {
    stored = await trpcClient.secretStorage.rendererSecrets.query()
  } catch (error) {
    console.error(
      "[renderer-secrets] stored values could not be read:",
      error instanceof Error ? error.message : String(error),
    )
    return
  }

  for (const [key, raw] of Object.entries(stored.values)) {
    if (!edited.has(key)) emit(key, raw)
  }

  // A keyed-store read error means absent and unreadable cannot be told apart,
  // so nothing is moved: an older browser value must not replace a newer value
  // that is merely unreadable right now.
  if (stored.error !== null) {
    console.error(`[renderer-secrets] stored values could not be read: ${stored.error}`)
    return
  }

  const legacy = browserStore()
  if (!legacy) return
  const moves: Promise<RendererSecretWrite>[] = []
  for (const key of RENDERER_SECRET_KEYS) {
    if (stored.values[key] !== undefined || edited.has(key)) continue
    const raw = legacy.getItem(key)
    if (raw === null) continue
    emit(key, raw)
    // A migration joins the same per-key chain as a user write, and the legacy
    // copy is removed only after the store confirmed the write.
    moves.push(persist(key, raw))
  }
  if (moves.length > 0) await Promise.all(moves)
}

/** Starts reading stored values. Safe to call more than once. */
export function startRendererSecretSync(): void {
  if (started) return
  started = true
  void hydrate()
}

function recordWriteFailure(key: RendererSecretKey, error: unknown): RendererSecretWrite {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[renderer-secrets] ${key} was not saved:`, message)
  return { ok: false, error: message }
}

function chainWrite(
  key: RendererSecretKey,
  task: () => Promise<RendererSecretWrite>,
): Promise<RendererSecretWrite> {
  const chain = (writes.get(key) ?? Promise.resolve<RendererSecretWrite>({ ok: true })).then(task)
  writes.set(key, chain)
  return chain
}

/**
 * Writes one value. Writes for a key are chained, so a newer value is always
 * sent after the one before it and a slow older request cannot replace it.
 */
function persist(key: RendererSecretKey, raw: string): Promise<RendererSecretWrite> {
  return chainWrite(key, () =>
    trpcClient.secretStorage.setRendererSecret
      .mutate({ key, value: raw })
      .then((): RendererSecretWrite => {
        browserStore()?.removeItem(key)
        return { ok: true }
      })
      .catch((error: unknown) => recordWriteFailure(key, error)),
  )
}

/**
 * Resolves once the write started for `key` has settled, so a caller that
 * reports success can wait for the app store to accept the value.
 */
export function whenRendererSecretSaved(key: RendererSecretKey): Promise<RendererSecretWrite> {
  return writes.get(key) ?? Promise.resolve<RendererSecretWrite>({ ok: true })
}

/** Forgets one stored value everywhere. Used when a value is cleared in the UI. */
export function forgetRendererSecret(key: RendererSecretKey): void {
  cache.delete(key)
  edited.add(key)
  browserStore()?.removeItem(key)
  void chainWrite(key, () =>
    trpcClient.secretStorage.removeRendererSecret
      .mutate({ key })
      .then((): RendererSecretWrite => ({ ok: true }))
      .catch((error: unknown) => recordWriteFailure(key, error)),
  )
}

/**
 * Jotai storage for one secret-bearing value. Reads come from memory, then from
 * a value an earlier version left in browser storage. Writes go to the
 * main-process store and never to browser storage.
 */
export function createRendererSecretStorage<T>(key: RendererSecretKey): SyncStorage<T> {
  return {
    getItem: (_key, initialValue) => {
      startRendererSecretSync()
      const raw = cache.get(key) ?? browserStore()?.getItem(key) ?? null
      if (raw === null) return initialValue
      try {
        return JSON.parse(raw) as T
      } catch {
        return initialValue
      }
    },
    setItem: (_key, value) => {
      const raw = JSON.stringify(value)
      cache.set(key, raw)
      edited.add(key)
      void persist(key, raw)
    },
    removeItem: () => {
      forgetRendererSecret(key)
    },
    subscribe: (_key, callback) => {
      startRendererSecretSync()
      const set = listeners.get(key) ?? new Set<Listener>()
      set.add(callback as Listener)
      listeners.set(key, set)
      const cached = cache.get(key)
      if (cached !== undefined) {
        try {
          callback(JSON.parse(cached) as T)
        } catch {
          // A cached value that cannot be parsed stays out of the atom.
        }
      }
      return () => set.delete(callback as Listener)
    },
  }
}
