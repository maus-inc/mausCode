import type { ProviderCapability } from "../../../shared/provider-capabilities"

export type BackendProbe = {
  available: boolean
  version?: string
  authenticated?: boolean
  detail?: string
}

export type BackendAdapterMeta = {
  id: string
  displayName: string
  getCapability: () => ProviderCapability
  probe: () => Promise<BackendProbe>
}
