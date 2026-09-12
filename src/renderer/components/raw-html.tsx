import type { ElementType, HTMLAttributes } from "react"

type RawHtmlProps = {
  /** Element tag to render. Defaults to "div". */
  as?: ElementType
  /** Pre-rendered HTML string. Callers must only pass generator-escaped HTML. */
  html: string
} & Omit<HTMLAttributes<HTMLElement>, "dangerouslySetInnerHTML">

/**
 * Single choke point for rendering pre-generated HTML (Shiki syntax
 * highlighting, mermaid SVG output). Both generators escape untrusted input
 * by construction; do not pass hand-built or user-controlled strings here.
 */
export function RawHtml({ as: Tag = "div", html, ...rest }: RawHtmlProps) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: sole audited use; callers are restricted to generator-escaped HTML (Shiki highlightCode, mermaid.render)
  return <Tag dangerouslySetInnerHTML={{ __html: html }} {...rest} />
}
