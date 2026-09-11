/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
import { useAtom } from "jotai"
import { RefreshCw } from "lucide-react"
import { useMemo, useState } from "react"
import { pinnedOpenRouterModelsAtom } from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { Button } from "../../ui/button"
import { SearchIcon } from "../../ui/icons"
import { Switch } from "../../ui/switch"

function formatPricePerMillion(usdPerToken: number | null): string {
  if (usdPerToken === null) return "—"
  const perMillion = usdPerToken * 1_000_000
  if (perMillion === 0) return "Free"
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`
  if (perMillion < 1) return `$${perMillion.toFixed(3)}`
  return `$${perMillion.toFixed(2)}`
}

function formatContextLength(tokens: number | null): string {
  if (tokens === null) return "—"
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return tokens.toString()
}

export function OpenRouterModelBrowser() {
  const [pinned, setPinned] = useAtom(pinnedOpenRouterModelsAtom)
  const [search, setSearch] = useState("")
  const trpcUtils = trpc.useUtils()

  const { data, isLoading, isFetching } = trpc.openrouter.listModels.useQuery(
    undefined,
    {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  )

  const models = data?.available ? data.models : []
  const errorMessage = data && !data.available ? data.error : null

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return models
    return models.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false),
    )
  }, [models, search])

  // Pinned models float to the top, then alphabetic by name.
  const sorted = useMemo(() => {
    const pinnedSet = new Set(pinned)
    return [...filtered].sort((a, b) => {
      const aPinned = pinnedSet.has(a.id) ? 0 : 1
      const bPinned = pinnedSet.has(b.id) ? 0 : 1
      if (aPinned !== bPinned) return aPinned - bPinned
      return a.name.localeCompare(b.name)
    })
  }, [filtered, pinned])

  const togglePin = (id: string) => {
    setPinned((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleRefresh = () => {
    void trpcUtils.openrouter.listModels.invalidate()
  }

  return (
    <div className="space-y-2">
      <div className="pb-2 flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            OpenRouter Models
          </h4>
          <p className="text-xs text-muted-foreground">
            {data?.available
              ? `${pinned.length} pinned · ${models.length} available`
              : "Pin models to surface them in the chat picker"}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRefresh}
          disabled={isFetching}
          aria-label="Refresh OpenRouter catalog"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
        </Button>
      </div>

      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="px-1.5 pt-1.5 pb-0.5">
          <div className="flex items-center gap-1.5 h-7 px-1.5 rounded-md bg-muted/50">
            <SearchIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search OpenRouter catalog…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="divide-y divide-border max-h-[420px] overflow-y-auto">
          {isLoading && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Loading catalog…
            </div>
          )}
          {errorMessage && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Failed to load catalog: {errorMessage}
            </div>
          )}
          {!isLoading && !errorMessage && sorted.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              No models match your search.
            </div>
          )}
          {sorted.map((m) => {
            const isPinned = pinned.includes(m.id)
            return (
              <div
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {m.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground/70 font-mono truncate">
                      {m.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                    <span>ctx {formatContextLength(m.contextLength)}</span>
                    <span>
                      in {formatPricePerMillion(m.pricing.promptUsdPerToken)}/M
                    </span>
                    <span>
                      out{" "}
                      {formatPricePerMillion(m.pricing.completionUsdPerToken)}/M
                    </span>
                  </div>
                </div>
                <Switch
                  checked={isPinned}
                  onCheckedChange={() => togglePin(m.id)}
                  aria-label={isPinned ? `Unpin ${m.name}` : `Pin ${m.name}`}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
