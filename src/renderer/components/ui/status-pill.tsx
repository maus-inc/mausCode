import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

/**
 * The settings status pill: one 12px label on a 10% wash, the tone naming the
 * state and never the value. The shape, the wash and the tone meanings are the
 * ones `docs/design-system-baseline.md` section 3.5 records.
 *
 * The light-mode text step sits one step darker than that record. On this wash
 * the 500 step measured 2.31:1 for emerald, 1.99:1 for amber and 3.29:1 for red,
 * all below the 4.5:1 floor for small text, while the 700 step measures 4.99,
 * 4.65 and 5.66. Dark mode keeps the 400 step it already passed with. The mute
 * tone leaves `muted-foreground` for the same reason, at 4.36:1 on the
 * foreground wash against 5.09:1 for the stop it now uses.
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
        tone === "ok" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        tone === "warn" && "bg-amber-500/10 text-amber-700 dark:text-amber-400",
        tone === "bad" && "bg-red-500/10 text-red-700 dark:text-red-400",
        tone === "mute" && "bg-foreground/5 text-foreground/60",
        className,
      )}
    >
      {children}
    </span>
  )
}
