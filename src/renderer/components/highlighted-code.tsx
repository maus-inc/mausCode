import { Fragment, memo, useEffect, useState } from "react"
import {
  highlightCodeTokens,
  type HighlightedLine,
} from "../lib/themes/shiki-theme-loader"
import { useCodeTheme } from "../lib/hooks/use-code-theme"

export type { HighlightedLine }

/**
 * Renders highlighted tokens as React text nodes.
 *
 * Shiki can also return an HTML string, but that string can only reach the DOM
 * through dangerouslySetInnerHTML. Rendering the tokens directly leaves every
 * piece of source text inside a text node, which React escapes. A file whose
 * name or contents contain markup stays text instead of becoming markup.
 */
export const HighlightedTokens = memo(function HighlightedTokens({
  lines,
}: {
  lines: HighlightedLine[]
}) {
  return (
    <>
      {lines.map((line, lineIndex) => (
        <Fragment key={lineIndex}>
          {lineIndex > 0 && "\n"}
          {line.map((token, tokenIndex) => (
            <span
              key={tokenIndex}
              style={token.color ? { color: token.color } : undefined}
            >
              {token.content}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  )
})

/**
 * Highlights code for the active editor theme.
 *
 * Returns null until the first result arrives, and keeps the previous result
 * while a later one is loading so the block does not flash.
 */
export function useHighlightedCode(
  code: string,
  language: string,
  options: { enabled?: boolean; themeId?: string } = {},
): HighlightedLine[] | null {
  const contextThemeId = useCodeTheme()
  const themeId = options.themeId ?? contextThemeId
  const enabled = options.enabled ?? true
  const [lines, setLines] = useState<HighlightedLine[] | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    highlightCodeTokens(code, language, themeId)
      .then((result) => {
        if (!cancelled) setLines(result)
      })
      .catch((error) => {
        console.error("Failed to highlight code:", error)
      })

    return () => {
      cancelled = true
    }
  }, [code, language, themeId, enabled])

  return lines
}

/**
 * A highlighted code block that falls back to plain text until highlighting
 * finishes, or permanently if it fails.
 */
export const HighlightedCode = memo(function HighlightedCode({
  code,
  language,
  className,
  fallbackClassName,
  enabled = true,
}: {
  code: string
  language: string
  className: string
  fallbackClassName?: string
  enabled?: boolean
}) {
  const lines = useHighlightedCode(code, language, { enabled })

  if (!lines) {
    return <pre className={fallbackClassName ?? className}>{code}</pre>
  }

  return (
    <pre className={className}>
      <HighlightedTokens lines={lines} />
    </pre>
  )
})
