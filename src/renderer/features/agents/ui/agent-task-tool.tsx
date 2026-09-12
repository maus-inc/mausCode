"use client"

import { useAtomValue } from "jotai"
import { ChevronRight } from "lucide-react"
import { memo, useEffect, useRef, useState } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { cn } from "../../../lib/utils"
import { selectedProjectAtom } from "../atoms"
import { useFileOpen } from "../mentions"
import { AgentToolCall } from "./agent-tool-call"
import { AgentToolInterrupted } from "./agent-tool-interrupted"
import { AgentToolRegistry, type ToolDisplayPart, getToolStatus } from "./agent-tool-registry"
import type { ToolPartLike } from "./agent-tool-state"
import { areTaskToolPropsEqual } from "./agent-tool-utils"

interface AgentTaskToolProps {
  part: ToolPartLike
  nestedTools: ToolPartLike[]
  chatStatus?: string
}

// Constants for rendering
const MAX_VISIBLE_TOOLS = 5
const TOOL_HEIGHT_PX = 24

// Format elapsed time in a human-readable format
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return ""
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (remainingSeconds === 0) return `${minutes}m`
  return `${minutes}m ${remainingSeconds}s`
}

export const AgentTaskTool = memo(function AgentTaskTool({
  part,
  nestedTools,
  chatStatus,
}: AgentTaskToolProps) {
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectPath = selectedProject?.path
  const { isPending, isInterrupted } = getToolStatus(part, chatStatus)
  const onOpenFile = useFileOpen()

  // Default: collapsed
  const [isExpanded, setIsExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const wasPendingRef = useRef(isPending)

  // Auto-collapse when task completes (transition from pending -> done)
  useEffect(() => {
    if (wasPendingRef.current && !isPending) {
      setIsExpanded(false)
    }
    wasPendingRef.current = isPending
  }, [isPending])

  // Track elapsed time for running tasks
  const [elapsedMs, setElapsedMs] = useState(0)

  const taskInput = part.input as { description?: string } | undefined
  const taskMeta = part as {
    startedAt?: unknown
    callProviderMetadata?: { custom?: { startedAt?: unknown } }
  }
  const description = taskInput?.description || ""

  // Get startedAt from providerMetadata (passed through AI SDK)
  const startedAt =
    (taskMeta.callProviderMetadata?.custom?.startedAt as number | undefined) ??
    (taskMeta.startedAt as number | undefined)

  // Tick elapsed time while task is running
  useEffect(() => {
    if (isPending && startedAt) {
      setElapsedMs(Date.now() - startedAt)

      const interval = setInterval(() => {
        setElapsedMs(Date.now() - startedAt)
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isPending, startedAt])

  // Use output duration from Claude Code if available, otherwise use our tracked time
  const taskOutput = part.output as
    | { totalDurationMs?: number; duration?: number; duration_ms?: number }
    | undefined
  const outputDuration =
    taskOutput?.totalDurationMs || taskOutput?.duration || taskOutput?.duration_ms
  const displayMs = !isPending && outputDuration ? outputDuration : elapsedMs
  const elapsedTimeDisplay = formatElapsedTime(displayMs)

  // Auto-scroll to bottom when streaming and new nested tools added
  useEffect(() => {
    if (isPending && isExpanded && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [isPending, isExpanded])

  const hasNestedTools = nestedTools.length > 0

  // Build subtitle - show latest tool activity when running, description otherwise
  const getSubtitle = () => {
    if (isPending && hasNestedTools) {
      const lastTool = nestedTools[nestedTools.length - 1]
      const lastToolType = lastTool?.type
      const meta = lastToolType ? AgentToolRegistry[lastToolType] : null
      if (meta && lastTool) {
        const title = meta.title(lastTool as ToolDisplayPart)
        const sub = meta.subtitle?.(lastTool as ToolDisplayPart)
        return typeof sub === "string" && sub ? `${title} ${sub}` : title
      }
    }
    if (description) {
      const truncated = description.length > 60 ? `${description.slice(0, 57)}...` : description
      return truncated
    }
    return ""
  }

  const subtitle = getSubtitle()

  // Get title text based on status
  const getTitle = () => {
    return isPending ? "Running Subagent" : "Completed Subagent"
  }

  // Show interrupted state if task was interrupted without completing
  if (isInterrupted && !part.output) {
    return <AgentToolInterrupted toolName="Subagent" subtitle={subtitle} />
  }

  return (
    <div>
      {/* Header - clickable to toggle, same style as AgentExploringGroup */}
      {/* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
        className="group flex items-start gap-1.5 py-0.5 px-2 cursor-pointer"
      >
        <div className="flex-1 min-w-0 flex items-center gap-1">
          <div className="text-xs flex items-center gap-1.5 min-w-0">
            {/* Title with shimmer effect when running */}
            {isPending ? (
              <TextShimmer
                as="span"
                duration={1.2}
                className="font-medium whitespace-nowrap flex-shrink-0"
              >
                {getTitle()}
              </TextShimmer>
            ) : (
              <span className="font-medium whitespace-nowrap flex-shrink-0 text-muted-foreground">
                {getTitle()}
              </span>
            )}
            {subtitle && <span className="text-muted-foreground/60 truncate">{subtitle}</span>}
            {/* Show elapsed time while running or final time when done */}
            {elapsedTimeDisplay && (
              <span className="text-muted-foreground/50 tabular-nums flex-shrink-0">
                {elapsedTimeDisplay}
              </span>
            )}
            {/* Chevron right after text - rotates when expanded */}
            <ChevronRight
              className={cn(
                "w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 ease-out flex-shrink-0",
                isExpanded && "rotate-90",
                !isExpanded && "opacity-0 group-hover:opacity-100",
              )}
            />
          </div>
        </div>
      </div>

      {/* Nested tools - only show when expanded */}
      {hasNestedTools && isExpanded && (
        <div className="relative mt-1">
          {/* Top gradient fade when streaming and has many items */}
          <div
            className={cn(
              "absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none transition-opacity duration-200",
              isPending && nestedTools.length > MAX_VISIBLE_TOOLS ? "opacity-100" : "opacity-0",
            )}
          />

          {/* Scrollable container - auto-scrolls to bottom when streaming */}
          <div
            ref={scrollRef}
            className={cn(
              "space-y-1.5",
              isPending &&
                nestedTools.length > MAX_VISIBLE_TOOLS &&
                "overflow-y-auto scrollbar-hide",
            )}
            style={
              isPending && nestedTools.length > MAX_VISIBLE_TOOLS
                ? { maxHeight: `${MAX_VISIBLE_TOOLS * TOOL_HEIGHT_PX}px` }
                : undefined
            }
          >
            {nestedTools.map((nestedPart, idx) => {
              const nestedMeta = nestedPart.type ? AgentToolRegistry[nestedPart.type] : undefined
              if (!nestedMeta) {
                return (
                  /* biome-ignore lint/suspicious/noArrayIndexKey: nested tool parts are positional and append-only. */
                  <div key={idx} className="text-xs text-muted-foreground py-0.5 px-2">
                    {nestedPart.type?.replace("tool-", "")}
                  </div>
                )
              }
              const { isPending: nestedIsPending, isError: nestedIsError } = getToolStatus(
                nestedPart,
                chatStatus,
              )
              const nestedInput = nestedPart.input as { file_path?: string } | undefined
              const nestedReadPath =
                nestedPart.type === "tool-Read" ? nestedInput?.file_path : undefined
              const handleClick =
                nestedReadPath && onOpenFile ? () => onOpenFile(nestedReadPath) : undefined
              return (
                <AgentToolCall
                  key={idx}
                  icon={nestedMeta.icon}
                  title={nestedMeta.title(nestedPart as ToolDisplayPart)}
                  subtitle={nestedMeta.subtitle?.(nestedPart as ToolDisplayPart)}
                  tooltipContent={nestedMeta.tooltipContent?.(
                    nestedPart as ToolDisplayPart,
                    projectPath,
                  )}
                  isPending={nestedIsPending}
                  isError={nestedIsError}
                  onClick={handleClick}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}, areTaskToolPropsEqual)
