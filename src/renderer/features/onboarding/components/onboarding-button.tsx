import { IconSpinner } from "../../../components/ui/icons"
import { cn } from "../../../lib/utils"

type OnboardingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "muted"
  /**
   * Adds the hairline ring shadow. Primary buttons always have it; muted
   * buttons only on some pages (the repo picker's secondary action).
   */
  ring?: boolean
  /** Swaps the label for the standard inline spinner. */
  loading?: boolean
}

const PRIMARY_RING =
  "shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]"
const MUTED_RING =
  "shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.06)] dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.06)]"

/**
 * The onboarding button idiom: h-8 rounded-lg, press-down scale, optional
 * loading spinner. Width/padding stay at the call site (`w-full px-3`,
 * `flex-1 px-3`, `px-4 min-w-[85px]`) since they vary per page.
 */
export function OnboardingButton({
  variant = "primary",
  ring,
  loading,
  className,
  children,
  ...rest
}: OnboardingButtonProps) {
  return (
    <button
      className={cn(
        "h-8 rounded-lg text-sm font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed",
        variant === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-muted text-foreground hover:bg-muted/80",
        variant === "primary" ? PRIMARY_RING : ring ? MUTED_RING : undefined,
        className,
      )}
      {...rest}
    >
      {loading ? <IconSpinner className="h-4 w-4" /> : children}
    </button>
  )
}
