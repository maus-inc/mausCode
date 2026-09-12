"use client"

import { ChevronRight } from "lucide-react"
import { memo, useMemo, useState } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { cn } from "../../../lib/utils"
import { getToolStatus } from "./agent-tool-registry"
import type { ToolPartLike } from "./agent-tool-state"
import { areToolPropsEqual } from "./agent-tool-utils"

interface SearchResult {
  title: string
  url: string
}

interface AgentWebSearchCollapsibleProps {
  part: ToolPartLike
  chatStatus?: string
}

export const AgentWebSearchCollapsible = memo(function AgentWebSearchCollapsible({
  part,
  chatStatus,
}: AgentWebSearchCollapsibleProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { isPending } = getToolStatus(part, chatStatus)

  const toolInput = part.input as { query?: string } | undefined
  const toolOutput = part.output as
    | { results?: { content?: { title?: string; url?: string }[]; title?: string; url?: string }[] }
    | undefined
  const outputResults = toolOutput?.results
  const query = toolInput?.query || ""

  // Parse results from output
  const results = useMemo(() => {
    if (!outputResults) return []

    const rawResults = outputResults
    const allResults: SearchResult[] = []

    for (const result of rawResults) {
      if (result.content && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.title && item.url) {
            allResults.push({ title: item.title, url: item.url })
          }
        }
      } else if (result.title && result.url) {
        allResults.push({ title: result.title, url: result.url })
      }
    }

    return allResults
  }, [outputResults])

  const resultCount = results.length
  const hasResults = resultCount > 0

  return (
    <div>
      {/* Header - clickable to toggle */}
      {/* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */}
      <div
        onClick={() => hasResults && !isPending && setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
        className={cn(
          "group flex items-start gap-1.5 py-0.5 px-2",
          hasResults && !isPending && "cursor-pointer",
        )}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <div className="text-xs flex items-center gap-1.5 min-w-0">
            <span className="font-medium whitespace-nowrap flex-shrink-0 text-muted-foreground">
              {isPending ? (
                <TextShimmer
                  as="span"
                  duration={1.2}
                  className="inline-flex items-center text-xs leading-none"
                >
                  Searching web
                </TextShimmer>
              ) : (
                "Searched web"
              )}
            </span>
            {/* Query preview when collapsed */}
            <span className="text-muted-foreground/60 truncate">
              {query.length > 40 ? `${query.slice(0, 37)}...` : query}
            </span>
            {/* Result count */}
            {!isPending && hasResults && (
              <span className="text-muted-foreground/60 whitespace-nowrap flex-shrink-0">
                · {resultCount} {resultCount === 1 ? "result" : "results"}
              </span>
            )}
            {/* Chevron - rotates when expanded, visible on hover when collapsed */}
            {hasResults && !isPending && (
              <ChevronRight
                className={cn(
                  "w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 ease-out flex-shrink-0",
                  isExpanded && "rotate-90",
                  !isExpanded && "opacity-0 group-hover:opacity-100",
                )}
              />
            )}
          </div>
        </div>
      </div>

      {/* Results list - only show when expanded */}
      {isExpanded && hasResults && (
        <div className="px-2 pb-1">
          <div className="space-y-1">
            {results.map((result) => (
              <a
                key={result.url}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-0.5 text-xs text-foreground truncate rounded hover:bg-muted/50 transition-colors"
              >
                {result.title}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}, areToolPropsEqual)
