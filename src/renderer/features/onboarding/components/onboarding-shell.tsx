import { ChevronLeft } from "lucide-react"

type OnboardingShellProps = {
  children: React.ReactNode
  /** Renders the fixed back button when provided. */
  onBack?: () => void | Promise<void>
  backDisabled?: boolean
  /** Container min-height in px (the provider picker needs a fixed slot). */
  minHeight?: number
}

/**
 * Shared frame for every onboarding page: full-screen centered stage, draggable
 * title-bar region, optional back button, and the standard 440px content column.
 */
export function OnboardingShell({
  children,
  onBack,
  backDisabled,
  minHeight,
}: OnboardingShellProps) {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background select-none">
      {/* Draggable title bar area */}
      <div
        className="fixed top-0 left-0 right-0 h-10"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      {onBack && (
        <button
          type="button"
          onClick={() => {
            void onBack()
          }}
          disabled={backDisabled}
          className="fixed top-12 left-4 flex items-center justify-center h-8 w-8 rounded-full hover:bg-foreground/5 transition-colors disabled:opacity-50"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}

      <div
        className="w-full max-w-[440px] space-y-8 px-4"
        style={minHeight ? { minHeight } : undefined}
      >
        {children}
      </div>
    </div>
  )
}
