/**
 * What clicking a suggested next prompt does to the draft already in the
 * composer.
 *
 * The rule is that a click accepts the suggestion, not that it discards what
 * the user typed while the suggestion sat there: an empty or whitespace-only
 * draft is replaced outright, and any other draft keeps every character it
 * had — leading whitespace included — gaining the suggestion after it, joined
 * by the one space the two strings would otherwise be missing.
 *
 * The voice path calls this with its already-trimmed current text, which is
 * what it did inline before; the suggestion path passes the draft untouched.
 * One join, two callers, each deciding its own input.
 */
export function mergeDraftWithSuggestion(draft: string, suggestion: string): string {
  if (draft.trim().length === 0) return suggestion
  const needsSpace = !/\s$/.test(draft)
  return draft + (needsSpace ? " " : "") + suggestion
}
