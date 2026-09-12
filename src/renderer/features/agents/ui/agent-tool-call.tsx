"use client"

import { memo } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"

interface AgentToolCallProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  subtitle?: string | React.ReactNode
  tooltipContent?: string
  isPending: boolean
  isError: boolean
  isNested?: boolean
  onClick?: () => void
}

export const AgentToolCall = memo(
  function AgentToolCall({
    icon: _Icon,
    title,
    subtitle,
    tooltipContent,
    isPending,
    isError: _isError,
    isNested,
    onClick,
  }: AgentToolCallProps) {
    // Ensure title is a string (copied from canvas); subtitle may be a node
    // (e.g. Edit +/- counts) and renders as-is. Plain strings stay XSS-safe.
    const titleStr = String(title)
    const subtitleContent = subtitle ? subtitle : undefined

    // Render subtitle with optional tooltip
    const clickableClass = onClick
      ? " cursor-pointer hover:text-muted-foreground transition-colors"
      : ""

    const subtitleElement = subtitleContent ? (
      tooltipContent ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* biome-ignore lint/a11y/useSemanticElements: compact inline action; a native button would require style resets. */}
            <span
              role="button"
              className={`text-muted-foreground/60 font-normal truncate min-w-0${clickableClass}`}
              onClick={onClick}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onClick?.()
                }
              }}
            >
              {subtitleContent}
            </span>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            className="px-2 py-1.5 max-w-none flex items-center justify-center"
          >
            <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap leading-none">
              {tooltipContent}
            </span>
          </TooltipContent>
        </Tooltip>
      ) : (
        /* biome-ignore lint/a11y/useSemanticElements: compact inline action; a native button would require style resets. */
        <span
          className={`text-muted-foreground/60 font-normal truncate min-w-0${clickableClass}`}
          onClick={onClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              onClick?.()
            }
          }}
        >
          {subtitleContent}
        </span>
      )
    ) : null

    return (
      <div className={`flex items-start gap-1.5 py-0.5 ${isNested ? "px-2.5" : "rounded-md px-2"}`}>
        {/* Content container */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 min-w-0">
            <span className="font-medium whitespace-nowrap flex-shrink-0">
              {isPending ? (
                <TextShimmer
                  as="span"
                  duration={1.2}
                  className="inline-flex items-center text-xs leading-none h-4 m-0"
                >
                  {titleStr}
                </TextShimmer>
              ) : (
                titleStr
              )}
            </span>
            {subtitleElement}
          </div>
        </div>
      </div>
    )
  },
  (prevProps, nextProps) => {
    // Custom comparison for memoization (copied from canvas)
    return (
      prevProps.title === nextProps.title &&
      prevProps.subtitle === nextProps.subtitle &&
      prevProps.tooltipContent === nextProps.tooltipContent &&
      prevProps.isPending === nextProps.isPending &&
      prevProps.isError === nextProps.isError &&
      prevProps.isNested === nextProps.isNested &&
      prevProps.onClick === nextProps.onClick
    )
  },
)
