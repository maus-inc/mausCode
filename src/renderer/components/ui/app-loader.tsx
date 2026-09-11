import { DotmSquare12 } from "@/components/ui/dotm-square-12"
import { cn } from "../../lib/utils"

/**
 * App-wide page/panel loading indicator.
 *
 * Mirrors the loading idiom it replaces (centered flex stack, `text-muted-foreground`,
 * `text-sm` label): the dots default to `currentColor`, so they follow the light/dark
 * theme automatically with no per-theme config.
 *
 * Sizes map 1:1 to the old spinner sizes:
 * - `lg` (32px) replaces `h-8 w-8` spinners (file viewer panels)
 * - `md` (24px) replaces `h-6 w-6` spinners (chat gate, editor)
 * - `sm` (20px) replaces `h-5 w-5` spinners (settings panels)
 */
const SIZE_MAP = {
  sm: { size: 20, dotSize: 3 },
  md: { size: 24, dotSize: 3.5 },
  lg: { size: 32, dotSize: 4 },
} as const

type AppLoaderProps = {
  /** Visual size. @default "lg" */
  size?: keyof typeof SIZE_MAP
  /** Optional label under the dots (e.g. "Loading file..."). */
  label?: string
  /**
   * Outer layout: `"full"` centers in an `h-full` area, `"flex"` centers in a
   * `flex-1` area, `"bare"` renders just the dot stack (parent already centers).
   * @default "bare"
   */
  layout?: "full" | "flex" | "bare"
  className?: string
}

export function AppLoader({ size = "lg", label, layout = "bare", className }: AppLoaderProps) {
  const dims = SIZE_MAP[size]

  const stack = (
    <div className="flex flex-col items-center gap-3 text-muted-foreground">
      <DotmSquare12 size={dims.size} dotSize={dims.dotSize} ariaLabel={label ?? "Loading"} />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )

  if (layout === "bare") {
    return stack
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center",
        layout === "full" ? "h-full" : "flex-1",
        className,
      )}
    >
      {stack}
    </div>
  )
}
