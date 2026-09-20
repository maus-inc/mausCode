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

const cache = new Map<string, string>()
const listeners = new Map<string, Set<Listener>>()
/** Keys the user changed in this session, which hydration must not overwrite. */
const edited = new Set<string>()
let lastFailure: string | null = null
let started = false

function browserStore(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Concrete reason the last secret write did not reach disk. Never a secret. */
export function rendererSecretFailure(): string | null {
  return lastFailure
}

export function clearRendererSecretFailure(): void {
  lastFailure = null
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

/**
 * Moves one legacy browser-storage value into the app secret store. The legacy
 * value is removed only after the store confirmed the write, so a refused or
 * failed write leaves the working setup exactly as it was.
 */
async function moveLegacyValue(key: RendererSecretKey, raw: string): Promise<void> {
  try {
    await trpcClient.secretStorage.setRendererSecret.mutate({ key, value: raw })
    browserStore()?.removeItem(key)
    lastFailure = null
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error)
    console.error(`[renderer-secrets] ${key} was left in browser storage:`, lastFailure)
  }
}

async function hydrate(): Promise<void> {
  let stored: { values: Record<string, string>; error: string | null }
  try {
    stored = await trpcClient.secretStorage.rendererSecrets.query()
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error)
    return
  }

  for (const [key, raw] of Object.entries(stored.values)) {
    if (!edited.has(key)) emit(key, raw)
  }

  const legacy = browserStore()
  if (!legacy) return
  const moves: Promise<void>[] = []
  for (const key of RENDERER_SECRET_KEYS) {
    if (stored.values[key] !== undefined || edited.has(key)) continue
    const raw = legacy.getItem(key)
    if (raw === null) continue
    emit(key, raw)
    moves.push(moveLegacyValue(key, raw))
  }
  if (moves.length > 0) await Promise.all(moves)
}

/** Starts reading stored values. Safe to call more than once. */
export function startRendererSecretSync(): void {
  if (started) return
  started = true
  void hydrate()
}

function persist(key: RendererSecretKey, raw: string): void {
  void trpcClient.secretStorage.setRendererSecret
    .mutate({ key, value: raw })
    .then(() => {
      browserStore()?.removeItem(key)
      lastFailure = null
    })
    .catch((error: unknown) => {
      lastFailure = error instanceof Error ? error.message : String(error)
      console.error(`[renderer-secrets] ${key} was not saved:`, lastFailure)
    })
}

/** Forgets one stored value everywhere. Used when a value is cleared in the UI. */
export function forgetRendererSecret(key: RendererSecretKey): void {
  cache.delete(key)
  edited.add(key)
  browserStore()?.removeItem(key)
  void trpcClient.secretStorage.removeRendererSecret
    .mutate({ key })
    .then(() => {
      lastFailure = null
    })
    .catch((error: unknown) => {
      lastFailure = error instanceof Error ? error.message : String(error)
    })
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
      persist(key, raw)
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
