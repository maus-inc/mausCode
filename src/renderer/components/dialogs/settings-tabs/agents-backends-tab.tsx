import type { ReactNode } from "react"
import type { ProviderCapability } from "../../../../shared/provider-capabilities"
import { trpc } from "../../../lib/trpc"
import { StatusPill } from "../../ui/status-pill"

function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{children}</span>
    </div>
  )
}

/**
 * The probe fields this card renders. Declared structurally because
 * `BackendProbe` lives in the main process, and the renderer must not import
 * from it. Every field is optional: the query carries no data until it settles.
 */
type ProbeFacts = {
  available?: boolean
  version?: string
  authenticated?: boolean
  detail?: string
}

/** The auth suffix a probe pill carries, when the probe settled on an answer. */
function authSuffix(authenticated: boolean | undefined): string {
  if (authenticated === true) return " · authenticated"
  if (authenticated === false) return " · not authenticated"
  return ""
}

function ProbePill({
  probe,
  loading,
}: {
  readonly probe: ProbeFacts | null | undefined
  readonly loading: boolean
}) {
  if (loading) return <StatusPill tone="mute">probing...</StatusPill>
  if (!probe?.available) {
    return (
      <StatusPill tone="bad">unavailable{probe?.detail ? ` · ${probe.detail}` : ""}</StatusPill>
    )
  }
  return (
    <StatusPill tone="ok">
      available{probe.version ? ` · ${probe.version}` : ""}
      {authSuffix(probe.authenticated)}
    </StatusPill>
  )
}

function FactHeading({ children }: { readonly children: ReactNode }) {
  return (
    <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  )
}

/** A joined list, or the placeholder this card already used for an empty one. */
function joinedOrDash(values: string[]): string {
  return values.join(", ") || "—"
}

function permissionFloorLabel(floor: ProviderCapability["security"]["permissionFloor"]): string {
  return floor === "app-gate" ? "app gate" : "engine only"
}

function streamingLabel(performance: ProviderCapability["performance"]): string {
  if (!performance.streaming) return "no"
  return performance.partialStreaming ? "partial" : "yes"
}

function contextLabel(contextWindow: number | null): string {
  if (contextWindow === null) return "model-dependent"
  return `${contextWindow.toLocaleString()} tokens`
}

function SecurityFacts({ security }: { readonly security: ProviderCapability["security"] }) {
  return (
    <div>
      <FactHeading>Security</FactHeading>
      <Row label="Auth">{joinedOrDash(security.auth)}</Row>
      <Row label="Approvals">{security.approvals}</Row>
      <Row label="Sandbox">{security.sandbox}</Row>
      <Row label="Egress">{joinedOrDash(security.egress)}</Row>
      <Row label="Retention">{security.retention}</Row>
      <Row label="Permission floor">{permissionFloorLabel(security.permissionFloor)}</Row>
    </div>
  )
}

function PerformanceFacts({
  performance,
}: {
  readonly performance: ProviderCapability["performance"]
}) {
  return (
    <div>
      <FactHeading>Performance</FactHeading>
      <Row label="Streaming">{streamingLabel(performance)}</Row>
      <Row label="Parallel tools">{performance.parallelTools ? "yes" : "no"}</Row>
      <Row label="Context">{contextLabel(performance.contextWindow)}</Row>
      <Row label="Latency">{performance.latencyClass}</Row>
      <Row label="Usage">{performance.usageSurface}</Row>
    </div>
  )
}

function BackendCard({ capability }: { capability: ProviderCapability }) {
  const probeQuery = trpc.providers.probe.useQuery({ id: capability.id })

  const enabledFeatures = Object.entries(capability.features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{capability.displayName}</h3>
        <StatusPill tone="mute">{capability.kind}</StatusPill>
        <ProbePill probe={probeQuery.data} loading={probeQuery.isLoading} />
      </div>

      <div className="text-sm text-muted-foreground">{capability.transport}</div>
      <div className="mb-2 text-sm text-muted-foreground">
        {capability.license} · {capability.billing}
      </div>

      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        <SecurityFacts security={capability.security} />
        <PerformanceFacts performance={capability.performance} />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {enabledFeatures.map((name) => (
          <StatusPill key={name} tone="mute">
            {name}
          </StatusPill>
        ))}
      </div>

      {capability.notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
          {capability.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AgentsBackendsTab() {
  const listQuery = trpc.providers.list.useQuery()
  const violationsQuery = trpc.providers.violations.useQuery({})

  return (
    <div className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Backends</h2>
        <p className="text-sm text-muted-foreground">
          Every backend self-reports its security posture and performance capabilities. Only policy
          violations surface in chat; everything else lives here.
        </p>
      </div>

      {violationsQuery.data && violationsQuery.data.length > 0 && (
        <div className="space-y-1.5 rounded-lg border border-border p-3">
          {violationsQuery.data.map((violation) => (
            <div
              key={`${violation.severity}-${violation.message}`}
              className="flex items-center gap-2 text-sm"
            >
              <StatusPill tone={violation.severity === "block" ? "bad" : "warn"}>
                {violation.severity === "block" ? "blocked" : "warning"}
              </StatusPill>
              <span className="text-foreground">{violation.message}</span>
            </div>
          ))}
        </div>
      )}

      {listQuery.isLoading && (
        <div className="text-sm text-muted-foreground">Loading backends…</div>
      )}
      {listQuery.isError && (
        <div className="text-sm text-red-500">
          Could not load backends: {listQuery.error.message}
        </div>
      )}
      {listQuery.data?.map((backend) => (
        <BackendCard key={backend.id} capability={backend} />
      ))}
    </div>
  )
}
