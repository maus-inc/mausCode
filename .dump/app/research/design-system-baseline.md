# Design system baseline

Recorded 2026-09-11, before further renderer work.

The full reference lives in `docs/design-system.md`. This note holds the audit
that produced it and the decisions that came out of it.

## Why this exists

Work on this branch touched six renderer files that draw syntax highlighted
code and mermaid diagrams. Four of those changes removed an HTML injection
point. Before any of that shipped, the existing design was measured and written
down, so a change could be checked against real numbers rather than against a
guess about what the app looks like.

Every figure in `docs/design-system.md` came from counting occurrences in
`src/renderer`, not from reading a component and generalising.

## What the measurement found

The app is dense and quiet. `text-xs` appears 517 times and `text-sm` 437
times, against 33 uses of `text-base` or larger. `rounded-md` appears 262
times. `duration-150` with `ease-out` appears 173 and 165 times.

Two decisions in the source are easy to mistake for accidents.

The `Button` primitive sets its default height to `h-7`, 28px. The shadcn
default of `h-9 px-4 py-2` is still in the file, commented out. That was
deliberate. `Input` stays at `h-9`. The mismatch between them is intended, so
it should not be normalised.

The default button carries a two part shadow. The outer hairline is always
`rgb(23,23,23)` and does not change in dark mode. Only the inner highlight
flips. A comment in the file says so.

## Audit of the renderer changes on this branch

| file | change | visual effect |
| --- | --- | --- |
| `chat-markdown-renderer.tsx` | shiki HTML injection replaced with token spans | none, verified |
| `agent-edit-tool.tsx` | same | none, verified |
| `agent-mcp-tool-call.tsx` | same | none, verified |
| `message-json-display.tsx` | same | none, verified |
| `agent-tool-call.tsx` | subtitle became text, diff counts became a typed prop | none, verified |
| `mermaid-block.tsx` | `securityLevel` strict, sanitizer pass added | one intended change, see below |

### The code block changes

Shiki's `codeToHtml` wraps each line in `<span class="line">`. The old code
regexed those spans out of the output and injected them. The new code renders
the tokens directly, so those wrapper spans are gone.

That is safe because no stylesheet in this repo targets `.shiki` or `.line`.
Both were checked. The `<pre><code>` wrapper, the monospace stack,
`line-height: 1.5`, `tab-size: 2` and `px-4 py-3` are all unchanged, so the
typography plugin rules still apply to the same elements.

Three classes were also removed. `[&_.shiki]:bg-transparent`,
`[&_pre]:bg-transparent`, `[&_code]:bg-transparent` in `agent-edit-tool.tsx` and
`[&>pre]:!bg-transparent` in `agent-mcp-tool-call.tsx`. All four targeted
elements that the regex had already stripped, so they matched nothing. They
were dead selectors.

`src/renderer/lib/highlighted-code.test.ts` locks the equivalence in. It
round-trips seven samples through the real highlighter and asserts the token
stream rebuilds the source byte for byte, including blank lines, a trailing
newline, an empty string, and source that contains `<img src=x onerror=...>`.
One test renders through React into jsdom and asserts the text survives and no
`img`, `script` or `onerror` attribute is created.

Shiki was also checked for a default colour. It does not apply one. Uncoloured
tokens come back with `color: null` and shiki emits no `style` attribute for
them, so leaving the style off in the renderer matches.

### The mermaid change

`securityLevel` moved from `loose` to `strict`. That is the one intended
behaviour change in this batch. Under `strict`, HTML markup written inside a
diagram label is shown as text instead of being rendered. Ordinary diagrams are
unaffected, and `strict` is mermaid's own default. The app had opted out of it.

An earlier version of this work also set `htmlLabels: false`, which forces
labels out of `foreignObject` and into native SVG text. That was reverted. It
changed how every diagram label renders, and the security benefit it was meant
to provide is delivered by the sanitizer instead.

The sanitizer needed `HTML_INTEGRATION_POINTS: { foreignobject: true }`. Without
it DOMPurify reads the inside of `foreignObject` as SVG, where `div` is not a
valid element, and it deletes every label in the diagram. With it, labels
survive untouched and the hostile cases still fail. Measured against five
payloads, the `<img>` beacon, the `<script>`, the `<iframe>`, the nested svg
carrying `onload` and the `javascript:` href are all stripped, and a legitimate
label keeps its text, its class, its `<style>` block and its arrow marker.

`src/renderer/lib/mermaid-security.test.ts` asserts all of that against the
config the renderer actually imports. It also feeds mermaid a diagram that
tries to set `securityLevel` back to `loose` through an `%%{init}%%` directive
and asserts the resolved config is still `strict`.

## Known gap, recorded not fixed

The renderer CSP in `src/renderer/index.html` allows `script-src 'unsafe-inline'
'unsafe-eval'` and `img-src https:`. That means the CSP would not stop an
injected inline script, and it would allow an image request to any https host.
Tightening it needs nonce or hash handling for the inline styles mermaid
emits, which cannot be verified headlessly here. It is a separate change and
should not be folded into this one.
