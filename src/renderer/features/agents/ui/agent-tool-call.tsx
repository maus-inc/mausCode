"use client"

import { memo } from "react"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip"

/**
 * The subtitle span, wearing button semantics only when there is an action to
 * press. A `role="button"` whose Enter and Space do nothing is a control that
 * lies: keyboard and screen-reader users can focus it, it announces itself as
 * interactive, and nothing happens — which is every `TaskOutput` and
 * `TaskStop` row, since neither offers an action beyond being read.
 *
 * Without an action but WITH a tooltip, the span still takes a tab stop:
 * `TooltipTrigger` hangs off focus, and a truncated path that only a mouse
 * can reveal is not keyboard-accessible. A bare tab stop is not a button —
 * no role, no Enter/Space handler — so it does not claim an affordance it
 * does not have; it only lets focus open the tooltip that is already there.
 */
function subtitleSpan(
  content: React.ReactNode,
  className: string,
  onClick?: () => void,
  tooltipFocusable = false,
): React.ReactElement {
  // Reset the native button's UA styles so it sits in the row like the span it
  // replaces — same fonts, colors, spacing — while keeping real button
  // semantics (implicit role, keyboard activation, no hand-rolled keydown).
  const buttonReset =
    "appearance-none border-0 bg-transparent p-0 m-0 font-[inherit] text-[inherit]"
  if (!onClick) {
    if (!tooltipFocusable) return <span className={className}>{content}</span>
    return (
      /* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard entry point for the tooltip trigger; focus opens it, and the span deliberately claims no interactive role. */
      <span className={className} tabIndex={0}>
        {content}
      </span>
    )
  }
  return (
    <button type="button" className={`${buttonReset} ${className}`} onClick={onClick}>
      {content}
    </button>
  )
}

/** The subtitle, wrapped in its tooltip when the meta describes one. */
function subtitleWithTooltip(
  span: React.ReactElement,
  tooltipContent?: string,
): React.ReactElement {
  if (!tooltipContent) return span
  return (
    <Tooltip>
      <TooltipTrigger asChild>{span}</TooltipTrigger>
      <TooltipContent
        side="top"
        className="px-2 py-1.5 max-w-none flex items-center justify-center"
      >
        <span className="font-mono text-[10px] text-muted-foreground whitespace-nowrap leading-none">
          {tooltipContent}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}

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

    // Render subtitle with optional tooltip; only an actionable one is a button.
    const clickableClass = onClick
      ? " cursor-pointer hover:text-muted-foreground transition-colors"
      : ""
    const subtitleClass = `text-muted-foreground/60 font-normal truncate min-w-0${clickableClass}`

    const subtitleElement = subtitleContent
      ? subtitleWithTooltip(
          subtitleSpan(subtitleContent, subtitleClass, onClick, Boolean(tooltipContent)),
          tooltipContent,
        )
      : null

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
