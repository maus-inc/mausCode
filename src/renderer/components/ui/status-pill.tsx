import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/**
 * The settings status pill: one 12px label on a 10% wash, the tone naming the
 * state and never the value. The tones and their classes are the ones
 * `docs/design-system-baseline.md` section 3.5 records, so every settings
 * surface that reports a state looks the same.
 */
export function StatusPill({
  tone,
  className,
  children,
}: {
  readonly tone: "ok" | "warn" | "bad" | "mute"
  readonly className?: string
  readonly children: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/10 text-emerald-500",
        tone === "warn" && "bg-amber-500/10 text-amber-500",
        tone === "bad" && "bg-red-500/10 text-red-500",
        tone === "mute" && "bg-foreground/5 text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  )
}
