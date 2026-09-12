type OnboardingHeaderProps = {
  /** Optional icon row (single mark or dual-mark pill) rendered above the title. */
  icon?: React.ReactNode
  title: string
  subtitle: React.ReactNode
}

/**
 * Centered onboarding header: optional icon row, semibold title, muted subtitle.
 */
export function OnboardingHeader({ icon, title, subtitle }: OnboardingHeaderProps) {
  if (!icon) {
    return (
      <div className="text-center space-y-1">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    )
  }

  return (
    <div className="text-center space-y-4">
      {icon}
      <div className="space-y-1">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}
