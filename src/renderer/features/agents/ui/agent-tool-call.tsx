"use client"

import { memo } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../components/ui/tooltip"

interface AgentToolCallProps {
  icon: React.ComponentType<{ className?: string }>
  title: string
  /** Rendered as text. Tool subtitles are built from agent/repository
   *  controlled input, so this must never be treated as markup. */
  subtitle?: string
  /** Styled +/- line counts (Edit tool). Structured rather than an HTML
   *  string so the shared subtitle stays a plain-text, memo-friendly value. */
  diffStats?: { added: number; removed: number }
  tooltipContent?: string
  isPending: boolean
  isError: boolean
  isNested?: boolean
  onClick?: () => void
}

function DiffStatsBadge({ added, removed }: { added: number; removed: number }) {
  return (
    <>
      <span style={{ fontSize: 11, color: "light-dark(#587C0B, #A3BE8C)" }}>+{added}</span>
      {" "}
      <span style={{ fontSize: 11, color: "light-dark(#AD0807, #AE5A62)" }}>-{removed}</span>
    </>
  )
}

export const AgentToolCall = memo(
  function AgentToolCall({
    icon: _Icon,
    title,
    subtitle,
    diffStats,
    tooltipContent,
    isPending,
    isError: _isError,
    isNested,
    onClick,
  }: AgentToolCallProps) {
    // Ensure title is a string (copied from canvas)
    const titleStr = String(title)
    const subtitleStr = subtitle ? String(subtitle) : undefined
    const hasSubtitle = !!subtitleStr || !!diffStats
    // Built only when there is something to show, so the common case of a
    // subtitle-less tool row allocates nothing extra.
    const subtitleNode = hasSubtitle ? (
      <>
        {subtitleStr}
        {diffStats ? <DiffStatsBadge added={diffStats.added} removed={diffStats.removed} /> : null}
      </>
    ) : null

    // Render subtitle with optional tooltip
    const clickableClass = onClick
      ? " cursor-pointer hover:text-muted-foreground transition-colors"
      : ""

    const subtitleElement = hasSubtitle ? (
      tooltipContent ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={`text-muted-foreground/60 font-normal truncate min-w-0${clickableClass}`}
              onClick={onClick}
            >
              {subtitleNode}
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
        <span
          className={`text-muted-foreground/60 font-normal truncate min-w-0${clickableClass}`}
          onClick={onClick}
        >
          {subtitleNode}
        </span>
      )
    ) : null

    return (
      <div
        className={`flex items-start gap-1.5 py-0.5 ${
          isNested ? "px-2.5" : "rounded-md px-2"
        }`}
      >
        {/* Icon container - commented out like canvas, uncomment to show icons */}
        {/* <div className="flex-shrink-0 flex text-muted-foreground items-start pt-[1px]">
          <_Icon className="w-3.5 h-3.5" />
        </div> */}

        {/* Content container - matches canvas exactly */}
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
