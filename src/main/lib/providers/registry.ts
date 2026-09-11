import type { BackendAdapterMeta } from "./types"

const backends = new Map<string, BackendAdapterMeta>()

export function registerBackend(meta: BackendAdapterMeta): void {
  if (backends.has(meta.id)) {
    throw new Error(`Backend already registered: ${meta.id}`)
  }
  backends.set(meta.id, meta)
}

export function getBackend(id: string): BackendAdapterMeta | undefined {
  return backends.get(id)
}

export function listBackends(): BackendAdapterMeta[] {
  return [...backends.values()]
}
