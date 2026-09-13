/**
 * List keys that are derived from the item, never from the array index.
 *
 * `key={index}` is the shape that breaks when a list is filtered, prepended to or
 * reordered: React then reuses the wrong component instance and the row keeps the
 * previous row's state. `keyItems` keeps the same guarantee without needing an id
 * field on data that has none — the key is the item's own content, and repeated
 * content is disambiguated with an occurrence suffix (`"a"`, `"a#1"`, `"a#2"`).
 *
 * The returned `index`/`isLast` fields exist so call sites that need position for
 * *logic* (separators, "streaming last group" checks) can keep it, while the React
 * key stays content-derived.
 */

export type KeyedItem<T> = {
  key: string
  item: T
  index: number
  isFirst: boolean
  isLast: boolean
}

/** Fallback identity for items with no cheap id field: their own content. */
function contentId(item: unknown): string {
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    return String(item)
  }
  try {
    return JSON.stringify(item) ?? String(item)
  } catch {
    return String(item)
  }
}

export function keyItems<T>(
  items: readonly T[],
  idOf: (item: T) => string = contentId,
): KeyedItem<T>[] {
  const seen = new Map<string, number>()
  const lastIndex = items.length - 1
  return items.map((item, index) => {
    const base = idOf(item) || String(index)
    const repeat = seen.get(base) ?? 0
    seen.set(base, repeat + 1)
    return {
      key: repeat === 0 ? base : `${base}#${repeat}`,
      item,
      index,
      isFirst: index === 0,
      isLast: index === lastIndex,
    }
  })
}
