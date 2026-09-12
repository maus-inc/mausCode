import { IconSpinner } from "../../../components/ui/icons"
import { Input } from "../../../components/ui/input"

type OnboardingCodeInputProps = {
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  placeholder: string
  /** Shows the in-field spinner and disables the input. */
  busy?: boolean
  /** Monospace face for codes/keys (off for the repo URL field). */
  mono?: boolean
}

/**
 * Centered single-line input with the spinner-inside-right submitting state.
 * Validation/auto-submit stay in the pages since the rules differ per flow.
 */
export function OnboardingCodeInput({
  value,
  onChange,
  onKeyDown,
  placeholder,
  busy,
  mono = true,
}: OnboardingCodeInputProps) {
  return (
    <div className="relative">
      <Input
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={mono ? "font-mono text-center pr-10" : "text-center pr-10"}
        autoFocus
        disabled={busy}
      />
      {busy && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <IconSpinner className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
