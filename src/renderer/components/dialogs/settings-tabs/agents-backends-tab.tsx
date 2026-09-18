import type { ReactNode } from "react"
import type { ProviderCapability } from "../../../../shared/provider-capabilities"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

function Pill({ tone, children }: { tone: "ok" | "warn" | "bad" | "mute"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-500",
        tone === "warn" && "bg-amber-500/10 text-amber-500",
        tone === "bad" && "bg-red-500/10 text-red-500",
        tone === "mute" && "bg-foreground/5 text-muted-foreground",
      )}
    >
      {children}
    </span>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{children}</span>
    </div>
  )
}

function BackendCard({ capability }: { capability: ProviderCapability }) {
  const probeQuery = trpc.providers.probe.useQuery({ id: capability.id })
  const probe = probeQuery.data

  const enabledFeatures = Object.entries(capability.features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">{capability.displayName}</h3>
        <Pill tone="mute">{capability.kind}</Pill>
        {probeQuery.isLoading ? (
          <Pill tone="mute">probing…</Pill>
        ) : probe?.available ? (
          <Pill tone="ok">
            available{probe.version ? ` · ${probe.version}` : ""}
            {probe.authenticated === true
              ? " · authenticated"
              : probe.authenticated === false
                ? " · not authenticated"
                : ""}
          </Pill>
        ) : (
          <Pill tone="bad">unavailable{probe?.detail ? ` · ${probe.detail}` : ""}</Pill>
        )}
      </div>

      <div className="text-sm text-muted-foreground">{capability.transport}</div>
      <div className="mb-2 text-sm text-muted-foreground">
        {capability.license} · {capability.billing}
      </div>

      <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
        <div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Security
          </div>
          <Row label="Auth">{capability.security.auth.join(", ") || "—"}</Row>
          <Row label="Approvals">{capability.security.approvals}</Row>
          <Row label="Sandbox">{capability.security.sandbox}</Row>
          <Row label="Egress">{capability.security.egress.join(", ") || "—"}</Row>
          <Row label="Retention">{capability.security.retention}</Row>
          <Row label="Permission floor">
            {capability.security.permissionFloor === "app-gate" ? "app gate" : "engine only"}
          </Row>
        </div>
        <div>
          <div className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Performance
          </div>
          <Row label="Streaming">
            {capability.performance.streaming
              ? capability.performance.partialStreaming
                ? "partial"
                : "yes"
              : "no"}
          </Row>
          <Row label="Parallel tools">{capability.performance.parallelTools ? "yes" : "no"}</Row>
          <Row label="Context">
            {capability.performance.contextWindow
              ? `${capability.performance.contextWindow.toLocaleString()} tokens`
              : "model-dependent"}
          </Row>
          <Row label="Latency">{capability.performance.latencyClass}</Row>
          <Row label="Usage">{capability.performance.usageSurface}</Row>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {enabledFeatures.map((name) => (
          <Pill key={name} tone="mute">
            {name}
          </Pill>
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
              <Pill tone={violation.severity === "block" ? "bad" : "warn"}>
                {violation.severity === "block" ? "blocked" : "warning"}
              </Pill>
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
