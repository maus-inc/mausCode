"use client"

/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
import { memo } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`
  return tokens.toString()
}

function formatNumber(value: number): string {
  return value.toLocaleString()
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}

function formatPercent(utilization: number | null): string {
  if (utilization === null) return "—"
  return `${Math.round(utilization)}%`
}

function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  if (value === 0) return "$0.00"
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 1) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

function formatResetIn(resetsAt: string | null): string | null {
  if (!resetsAt) return null
  const target = new Date(resetsAt).getTime()
  if (Number.isNaN(target)) return null
  const diffMs = target - Date.now()
  if (diffMs <= 0) return "now"
  const totalMinutes = Math.floor(diffMs / 60_000)
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

interface UsageBreakdown {
  label: string
  value: number
}

function ProviderRow({
  label,
  tokens,
  sessions,
  breakdown,
  available,
}: {
  label: string
  tokens: number
  sessions: number
  breakdown: UsageBreakdown[]
  available: boolean
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center justify-between gap-2 px-1 py-0.5 rounded",
            "hover:bg-muted/50 cursor-default transition-colors",
          )}
        >
          <span className="text-muted-foreground/80">{label}</span>
          {available ? (
            <span className="flex items-center gap-1.5 font-mono text-foreground/80">
              <span>{formatTokens(tokens)}</span>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-muted-foreground">
                {sessions} {pluralize(sessions, "session", "sessions")}
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground/40 font-mono">—</span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">{label} · today</div>
        {available ? (
          <div className="flex flex-col gap-0.5">
            {breakdown.map(({ label: rowLabel, value }) => (
              <div key={rowLabel} className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">{rowLabel}</span>
                <span className="font-mono text-foreground">{formatNumber(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-muted-foreground">No usage data found on disk.</div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

interface QuotaCell {
  key: string
  label: string
  fullLabel: string
  utilization: number | null
  resetsAt: string | null
  tooltipDescription: string
  useResetAsLabel?: boolean
}

function QuotaChip({ cell }: { cell: QuotaCell }) {
  const resetIn = formatResetIn(cell.resetsAt)
  const isHigh = cell.utilization !== null && cell.utilization >= 80
  const displayLabel = cell.useResetAsLabel && resetIn ? resetIn : cell.label
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex h-[18px] items-center justify-between gap-1 px-1.5 rounded-sm cursor-default",
            "hover:bg-foreground/[0.06] transition-colors",
          )}
        >
          <span className="text-[9px] text-muted-foreground/90 truncate">{displayLabel}</span>
          <span
            className={cn(
              "font-mono text-[9px] tabular-nums",
              isHigh ? "text-orange-400" : "text-foreground/80",
            )}
          >
            {formatPercent(cell.utilization)}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">{cell.fullLabel}</div>
        <div className="text-[11px] text-muted-foreground mb-1">{cell.tooltipDescription}</div>
        <div className="flex justify-between gap-4 text-[11px]">
          <span className="text-muted-foreground">Used</span>
          <span className="font-mono text-foreground">{formatPercent(cell.utilization)}</span>
        </div>
        {resetIn && (
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">Resets in</span>
            <span className="font-mono text-foreground">{resetIn}</span>
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

function ProviderQuotaRow({ name, cells }: { name: string; cells: QuotaCell[] }) {
  if (cells.length === 0) return null
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <span className="w-12 shrink-0 text-muted-foreground/70 truncate">{name}</span>
      <div
        className="flex-1 grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))`,
        }}
      >
        {cells.map((cell) => (
          <QuotaChip key={cell.key} cell={cell} />
        ))}
      </div>
    </div>
  )
}

function GithubCommitsRow({
  today,
  week,
  month,
  login,
  onRefresh,
  isRefreshing,
}: {
  today: number
  week: number
  month: number
  login: string
  onRefresh: () => void
  isRefreshing: boolean
}) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label="Refresh GitHub commit stats"
          aria-busy={isRefreshing}
          onClick={onRefresh}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onRefresh()
            }
          }}
          className={cn(
            "flex items-center justify-between gap-2 px-1 py-0.5 rounded",
            "hover:bg-muted/50 cursor-pointer transition-colors",
            isRefreshing && "opacity-60",
          )}
        >
          <span className="text-muted-foreground/80">Commits</span>
          <span className="flex items-center gap-1.5 font-mono text-foreground/80">
            <span>{formatNumber(today)}</span>
            <span className="text-muted-foreground/60">today</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatNumber(week)}</span>
            <span className="text-muted-foreground/60">wk</span>
            <span className="text-muted-foreground/40">·</span>
            <span>{formatNumber(month)}</span>
            <span className="text-muted-foreground/60">mo</span>
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" align="end" className="min-w-[180px]">
        <div className="font-medium text-foreground mb-1">
          GitHub commits {login ? `· @${login}` : ""}
        </div>
        <div className="flex flex-col gap-0.5">
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">Today</span>
            <span className="font-mono text-foreground">{formatNumber(today)}</span>
          </div>
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">This week</span>
            <span className="font-mono text-foreground">{formatNumber(week)}</span>
          </div>
          <div className="flex justify-between gap-4 text-[11px]">
            <span className="text-muted-foreground">This month</span>
            <span className="font-mono text-foreground">{formatNumber(month)}</span>
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export const UsageStatsFooter = memo(function UsageStatsFooter() {
  const { data: today, isLoading: loadingToday } = trpc.usage.today.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  })

  const { data: plan, isLoading: loadingPlan } = trpc.usage.plan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const { data: codexPlan } = trpc.usage.codexPlan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

  const { data: geminiPlan } = trpc.usage.geminiPlan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  })

  const { data: openRouterPlan } = trpc.usage.openRouterPlan.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  })

  const {
    data: githubStats,
    refetch: refetchGithubStats,
    isFetching: isFetchingGithubStats,
  } = trpc.github.commitStats.useQuery(undefined, {
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    retry: false,
  })

  if (loadingToday && !today && loadingPlan && !plan) {
    return (
      <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[10px] text-muted-foreground/40 select-none">
        <div className="flex items-center justify-between px-1 py-0.5">
          <span>Today</span>
          <span className="font-mono">…</span>
        </div>
      </div>
    )
  }

  const claude = today?.claude ?? null
  const codex = today?.codex ?? null
  const gemini = today?.gemini ?? null
  const openrouter = today?.openrouter ?? null
  const planUsage = plan?.available ? plan.usage : null
  const codexPlanUsage = codexPlan?.available ? codexPlan.usage : null
  const geminiPlanUsage = geminiPlan?.available ? geminiPlan.usage : null
  const openRouterPlanUsage = openRouterPlan?.available ? openRouterPlan.usage : null

  const claudeCells: QuotaCell[] = [
    planUsage?.fiveHour && {
      key: "claude-5h",
      label: "5h",
      fullLabel: "Current session",
      utilization: planUsage.fiveHour.utilization,
      resetsAt: planUsage.fiveHour.resetsAt,
      tooltipDescription: "Rolling 5-hour window.",
      useResetAsLabel: true,
    },
    planUsage?.sevenDay && {
      key: "claude-7d",
      label: "7d",
      fullLabel: "Weekly · all models",
      utilization: planUsage.sevenDay.utilization,
      resetsAt: planUsage.sevenDay.resetsAt,
      tooltipDescription: "Combined 7-day usage across all models.",
      useResetAsLabel: true,
    },
    planUsage?.sevenDayOpus && {
      key: "claude-opus",
      label: "Opus",
      fullLabel: "Weekly · Opus",
      utilization: planUsage.sevenDayOpus.utilization,
      resetsAt: planUsage.sevenDayOpus.resetsAt,
      tooltipDescription: "7-day Opus-only quota.",
    },
    planUsage?.extraUsage?.isEnabled &&
      planUsage.extraUsage.utilization !== null && {
        key: "claude-extra",
        label: "Extra",
        fullLabel: "Extra usage",
        utilization: planUsage.extraUsage.utilization,
        resetsAt: null,
        tooltipDescription:
          `${planUsage.extraUsage.usedCredits ?? 0} / ${planUsage.extraUsage.monthlyLimit ?? 0} ${planUsage.extraUsage.currency ?? ""}`.trim(),
      },
  ].filter(Boolean) as QuotaCell[]

  const codexCells: QuotaCell[] = [
    codexPlanUsage?.primary && {
      key: "codex-5h",
      label: "5h",
      fullLabel: "Codex · current session",
      utilization: codexPlanUsage.primary.utilization,
      resetsAt: codexPlanUsage.primary.resetsAt,
      tooltipDescription: "Codex 5-hour rolling window.",
      useResetAsLabel: true,
    },
    codexPlanUsage?.secondary && {
      key: "codex-7d",
      label: "7d",
      fullLabel: "Codex · weekly",
      utilization: codexPlanUsage.secondary.utilization,
      resetsAt: codexPlanUsage.secondary.resetsAt,
      tooltipDescription: "Codex 7-day rolling window.",
      useResetAsLabel: true,
    },
  ].filter(Boolean) as QuotaCell[]

  const geminiCells: QuotaCell[] = [
    geminiPlanUsage?.primary && {
      key: "gemini-pro",
      label: "Pro",
      fullLabel: "Gemini · Pro",
      utilization: geminiPlanUsage.primary.utilization,
      resetsAt: geminiPlanUsage.primary.resetsAt,
      tooltipDescription: "Gemini Pro models · 24-hour quota.",
    },
    geminiPlanUsage?.secondary && {
      key: "gemini-flash",
      label: "Flash",
      fullLabel: "Gemini · Flash",
      utilization: geminiPlanUsage.secondary.utilization,
      resetsAt: geminiPlanUsage.secondary.resetsAt,
      tooltipDescription: "Gemini Flash models · 24-hour quota.",
    },
    geminiPlanUsage?.tertiary && {
      key: "gemini-lite",
      label: "Lite",
      fullLabel: "Gemini · Flash Lite",
      utilization: geminiPlanUsage.tertiary.utilization,
      resetsAt: geminiPlanUsage.tertiary.resetsAt,
      tooltipDescription: "Gemini Flash Lite models · 24-hour quota.",
    },
  ].filter(Boolean) as QuotaCell[]

  const openRouterCells: QuotaCell[] = openRouterPlanUsage
    ? [
        {
          key: "or-credits",
          label: "Credits",
          fullLabel: openRouterPlanUsage.label
            ? `OpenRouter · ${openRouterPlanUsage.label}`
            : "OpenRouter · credits",
          utilization: openRouterPlanUsage.utilization,
          resetsAt: null,
          tooltipDescription:
            openRouterPlanUsage.limitUsd !== null
              ? `${formatUsd(openRouterPlanUsage.usageUsd ?? 0)} of ${formatUsd(openRouterPlanUsage.limitUsd)} spent`
              : openRouterPlanUsage.isFreeTier
                ? "Free tier — no spend cap configured"
                : "No spend cap configured",
        },
      ]
    : []

  const hasAnyPlanRow =
    claudeCells.length > 0 ||
    codexCells.length > 0 ||
    geminiCells.length > 0 ||
    openRouterCells.length > 0

  return (
    <div className="px-2 pt-2 pb-1 border-t border-border/40 text-[11px] select-none">
      {hasAnyPlanRow && (
        <>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-1">
            Plan limits
          </div>
          <ProviderQuotaRow name="Claude" cells={claudeCells} />
          <ProviderQuotaRow name="Codex" cells={codexCells} />
          <ProviderQuotaRow name="Gemini" cells={geminiCells} />
          <ProviderQuotaRow name="Router" cells={openRouterCells} />
        </>
      )}

      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/50 px-1 pb-0.5 pt-1">
        Today
      </div>
      <ProviderRow
        label="Claude"
        tokens={claude?.tokens ?? 0}
        sessions={claude?.sessions ?? 0}
        available={claude !== null}
        breakdown={[
          { label: "Messages", value: claude?.messages ?? 0 },
          { label: "Sessions", value: claude?.sessions ?? 0 },
          { label: "Tool calls", value: claude?.toolCalls ?? 0 },
          { label: "Total tokens", value: claude?.tokens ?? 0 },
        ]}
      />
      <ProviderRow
        label="Codex"
        tokens={codex?.tokens ?? 0}
        sessions={codex?.sessions ?? 0}
        available={codex !== null}
        breakdown={[
          { label: "Sessions", value: codex?.sessions ?? 0 },
          { label: "Input tokens", value: codex?.inputTokens ?? 0 },
          { label: "Output tokens", value: codex?.outputTokens ?? 0 },
          { label: "Total tokens", value: codex?.tokens ?? 0 },
        ]}
      />
      <ProviderRow
        label="Gemini"
        tokens={gemini?.tokens ?? 0}
        sessions={gemini?.sessions ?? 0}
        available={gemini !== null}
        breakdown={[
          { label: "Sessions", value: gemini?.sessions ?? 0 },
          { label: "Input tokens", value: gemini?.inputTokens ?? 0 },
          { label: "Output tokens", value: gemini?.outputTokens ?? 0 },
          { label: "Total tokens", value: gemini?.tokens ?? 0 },
        ]}
      />
      {openrouter !== null && (
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <div
              className={cn(
                "flex items-center justify-between gap-2 px-1 py-0.5 rounded",
                "hover:bg-muted/50 cursor-default transition-colors",
              )}
            >
              <span className="text-muted-foreground/80">OpenRouter</span>
              <span className="flex items-center gap-1.5 font-mono text-foreground/80">
                <span>{formatTokens(openrouter.tokens)}</span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">{formatUsd(openrouter.costUsd)}</span>
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" align="end" className="min-w-[180px]">
            <div className="font-medium text-foreground mb-1">OpenRouter · today</div>
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">Sessions</span>
                <span className="font-mono text-foreground">
                  {formatNumber(openrouter.sessions)}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">Input tokens</span>
                <span className="font-mono text-foreground">
                  {formatNumber(openrouter.inputTokens)}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">Output tokens</span>
                <span className="font-mono text-foreground">
                  {formatNumber(openrouter.outputTokens)}
                </span>
              </div>
              <div className="flex justify-between gap-4 text-[11px]">
                <span className="text-muted-foreground">Total tokens</span>
                <span className="font-mono text-foreground">{formatNumber(openrouter.tokens)}</span>
              </div>
              <div className="flex justify-between gap-4 text-[11px] pt-0.5 border-t border-border/40 mt-0.5">
                <span className="text-muted-foreground">Spend</span>
                <span className="font-mono text-foreground">{formatUsd(openrouter.costUsd)}</span>
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      )}
      {githubStats?.available && (
        <GithubCommitsRow
          today={githubStats.stats.today}
          week={githubStats.stats.week}
          month={githubStats.stats.month}
          login={githubStats.stats.login}
          onRefresh={() => {
            void refetchGithubStats()
          }}
          isRefreshing={isFetchingGithubStats}
        />
      )}
    </div>
  )
})
