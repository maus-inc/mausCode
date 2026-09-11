/**
 * Canonical ordering helpers for content comparison.
 *
 * `Array.prototype.sort()` without a comparator converts elements to strings
 * and compares UTF-16 code units. That is fine for strings but silently wrong
 * for numbers (`[10, 9].sort()` → `[10, 9]`), and leaving it implicit hides
 * which of the two behaviours a call site actually relies on. Every comparator
 * here is explicit so the intent is part of the code.
 */

/** Total, locale-independent order over strings. Used only to make two
 *  collections comparable, never to present a user-visible ordering. */
const compareCanonical = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Deterministic fingerprint of a collection's members, independent of input
 * order. Two collections with the same members produce the same string.
 */
export function canonicalJoin(values: readonly string[], separator = ","): string {
  return [...values].sort(compareCanonical).join(separator)
}

/**
 * Returns `prev` when it already holds the same members as `next`, otherwise
 * `next`. Lets memoized selectors and React Query keep referential equality
 * (and therefore skip refetch/re-render) when only array identity changed.
 *
 * Compares sorted members element-wise rather than building fingerprint
 * strings, so this stays allocation-light on the render path.
 */
export function stableArrayIfSameContents(prev: string[], next: string[]): string[] {
  if (prev.length !== next.length) return next
  const sortedPrev = [...prev].sort(compareCanonical)
  const sortedNext = [...next].sort(compareCanonical)
  return sortedPrev.every((value, i) => value === sortedNext[i]) ? prev : next
}
