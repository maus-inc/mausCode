import { OnboardingButton } from "./onboarding-button"

type OnboardingErrorProps = {
  message: string
  onRetry: () => void
  retryLabel?: string
}

/**
 * Standard onboarding failure block: red tinted message card + muted retry.
 */
export function OnboardingError({
  message,
  onRetry,
  retryLabel = "Try Again",
}: OnboardingErrorProps) {
  return (
    <div className="space-y-4">
      <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
        <p className="text-sm text-destructive">{message}</p>
      </div>
      <OnboardingButton variant="muted" className="w-full px-3" onClick={onRetry}>
        {retryLabel}
      </OnboardingButton>
    </div>
  )
}
