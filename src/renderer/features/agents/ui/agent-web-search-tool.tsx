"use client"

import { memo, useMemo, useState } from "react"
import { CollapseIcon, ExpandIcon, IconSpinner, SearchIcon } from "../../../components/ui/icons"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { keyItems } from "../../../lib/react-keys"
import { cn } from "../../../lib/utils"
import { AgentToolInterrupted } from "./agent-tool-interrupted"
import { getToolStatus } from "./agent-tool-registry"
import type { ToolPartLike } from "./agent-tool-state"
import { areToolPropsEqual } from "./agent-tool-utils"

interface AgentWebSearchToolProps {
  part: ToolPartLike
  chatStatus?: string
}

interface SearchResult {
  title: string
  url: string
}

export const AgentWebSearchTool = memo(function AgentWebSearchTool({
  part,
  chatStatus,
}: AgentWebSearchToolProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { isPending, isError, isInterrupted } = getToolStatus(part, chatStatus)

  const toolInput = part.input as { query?: string } | undefined
  const toolOutput = part.output as
    | { results?: { content?: { title?: string; url?: string }[]; title?: string; url?: string }[] }
    | undefined
  const outputResults = toolOutput?.results
  const query = toolInput?.query || ""
  const truncatedQuery = query.length > 40 ? `${query.slice(0, 37)}...` : query

  // Parse results from output
  const results = useMemo(() => {
    if (!outputResults) return []

    // Results can be nested in content array
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

  // Show interrupted state if search was interrupted without completing
  if (isInterrupted && !hasResults) {
    return <AgentToolInterrupted toolName="Search" subtitle={truncatedQuery} />
  }

  return (
    <div className="rounded-lg border border-border bg-muted/30 overflow-hidden mx-2">
      {/* Header - clickable to toggle expand */}
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
          "flex items-center justify-between px-2.5 h-7",
          hasResults &&
            !isPending &&
            "cursor-pointer hover:bg-muted/50 transition-colors duration-150",
        )}
      >
        <div className="flex items-center gap-1.5 text-xs truncate flex-1 min-w-0">
          <SearchIcon className="w-3 h-3 flex-shrink-0 text-muted-foreground" />

          {isPending ? (
            <TextShimmer as="span" duration={1.2} className="text-xs text-muted-foreground">
              Searching
            </TextShimmer>
          ) : (
            <span className="text-xs text-muted-foreground">Searched</span>
          )}

          <span className="truncate text-foreground">{truncatedQuery}</span>
        </div>

        {/* Status and expand button */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
          <div className="flex items-center gap-1.5 text-xs">
            {isPending ? (
              <IconSpinner className="w-3 h-3" />
            ) : isError ? (
              <span className="text-destructive">Failed</span>
            ) : (
              <span className="text-muted-foreground">
                {resultCount} {resultCount === 1 ? "result" : "results"}
              </span>
            )}
          </div>

          {/* Expand/Collapse icon */}
          {hasResults && !isPending && (
            <div className="relative w-4 h-4">
              <ExpandIcon
                className={cn(
                  "absolute inset-0 w-4 h-4 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                  isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100",
                )}
              />
              <CollapseIcon
                className={cn(
                  "absolute inset-0 w-4 h-4 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                  isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75",
                )}
              />
            </div>
          )}
        </div>
      </div>

      {/* Results list - expandable */}
      {hasResults && isExpanded && (
        <div className="border-t border-border max-h-[200px] overflow-y-auto">
          {keyItems(results, (result) => result.url).map(({ key, item: result }) => (
            <a
              key={key}
              href={result.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-2.5 py-1 text-xs text-foreground truncate hover:bg-muted/50 transition-colors"
            >
              {result.title}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}, areToolPropsEqual)
