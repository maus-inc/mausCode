# mausCode design system

A reference for the visual language already in the app. Every number here was
measured from the source, not inferred. Use it before changing any renderer
component, and check a change against it before shipping.

The short version. This is a dense, quiet, low-contrast interface built on
12px and 13px type, 6px corner radius, 28px controls, and one accent colour
that never changes between light and dark. Nothing shouts. Contrast comes from
type weight and opacity, not from colour or borders.

## Colour

Colours are HSL channels stored in CSS custom properties and consumed through
Tailwind as `hsl(var(--token))`. Defined in `src/renderer/styles/globals.css`,
mapped in `tailwind.config.js`.

`--primary` is `228 100% 50%`, which is `#0034FF`. It is identical in light and
dark mode, and the file says so in a comment. The focus ring uses the same
value, so focus and brand are the same blue everywhere.

Text selection uses primary at 25% opacity in light mode and 30% in dark.

The agents page overrides two tokens, and this matters because almost the whole
app lives under `[data-agents-page]`.

| token | light | dark | why |
| --- | --- | --- | --- |
| `--muted` | `0 0% 94%` | `0 0% 14%` | brighter than the default so code blocks stay visible |
| `--muted-foreground` | `0 0% 45%` | `0 0% 55%` | matched to the muted shift |
| `--sidebar-width` | `240px` | `240px` | sidebar default |

The same muted override is repeated for radix portals, dialogs and toasts, so
overlays match the page rather than falling back to the root value.

Semantic colours are used sparingly. Destructive actions use
`text-red-500` or `bg-red-500/10`. Added and removed diff counts use
`light-dark(#587C0B, #A3BE8C)` and `light-dark(#AD0807, #AE5A62)`. Those two
pairs appear nowhere else, so do not reuse them for anything that is not a diff
count.

## Typography

The interface font is Geist Sans, applied on `[data-agents-page]` at weight
400, and re-applied to radix portals, dialogs and toasts so nothing inherits a
different face.

Monospace text uses this stack, written out in full rather than left to
`font-mono` where it matters most.

```
SFMono-Regular, Menlo, Consolas, 'PT Mono', 'Liberation Mono', Courier, monospace
```

The type scale is narrow and skews small. Measured across `src/renderer`.

| size | uses | role |
| --- | --- | --- |
| `text-xs` | 517 | default for controls, labels, rows, secondary text |
| `text-sm` | 437 | body text, inputs, buttons, primary content |
| `text-base` | 16 | rare |
| `text-lg` | 11 | section headings |
| `text-xl` and up | 6 | page level only |

If a new control is not obviously a heading, it is `text-xs` or `text-sm`.

## Sizing and density

This is the part that is easiest to break by accident.

The `Button` primitive in `src/renderer/components/ui/button.tsx` sets its
default height to `h-7`, which is 28px. The shadcn default of `h-9 px-4 py-2`
is still in the file, commented out. That was a deliberate choice, not an
oversight, and it is what makes the toolbar and sidebar rows feel tight.

| size | value |
| --- | --- |
| `sm` | `h-7 px-3` |
| `default` | `h-7 px-3` |
| `lg` | `h-10 px-8` |
| `icon` | `h-7 w-7` |

`Input` is the exception. It stays at `h-9` with `rounded-lg`. Inputs are meant
to read as larger than buttons, so do not "fix" the mismatch.

Row heights cluster tightly. Measured across all of `src/renderer`, `h-7`
appears 116 times and `h-6` 115 times, then `h-8` 63 times and `h-9` 6 times.
A new list row should be 24px or 28px. `h-9` is reserved for inputs and the
select trigger.

### Spacing

| token | uses | where |
| --- | --- | --- |
| `gap-2` | 243 | default gap for icon plus label, and between controls |
| `gap-1.5` | 174 | tighter groupings inside a row |
| `gap-1` | 128 | icon clusters, badge rows |
| `gap-0.5` | 53 | `Kbd` modifier sequences |
| `px-2` | 195 | default horizontal padding for rows and small controls |
| `px-3` | 113 | inputs, buttons, larger controls |
| `px-1.5` | 94 | compact chips and tags |
| `py-1.5` | 85 | default vertical padding |
| `py-1` | 76 | compact rows |
| `py-0.5` | 68 | dense rows |

### Radius

`--radius` is `0.5rem`. Tailwind derives `rounded-lg` from it, `rounded-md`
subtracts 2px, `rounded-sm` subtracts 4px.

| class | uses | where |
| --- | --- | --- |
| `rounded-md` | 262 | buttons, tooltips, dialogs, most controls |
| `rounded-full` | 129 | badges, avatars, pills, icon-only round buttons |
| `rounded-lg` | 121 | inputs, cards, larger surfaces |
| `rounded` | 117 | inline code, small chips |
| `rounded-[10px]` | 3 | code block and diagram wrappers, and the select trigger |

`rounded-md` is the default answer. Reach for `rounded-lg` only for inputs and
large surfaces.

## Icons

Icons come from `lucide-react` and from a local set in
`src/renderer/components/ui/icons.tsx`.

| class | uses |
| --- | --- |
| `h-4 w-4` | 311 |
| `h-3.5 w-3.5` | 230 |
| `h-3 w-3` | 95 |
| `h-6 w-6` | 72 |
| `h-2.5 w-2.5` and smaller | 73 |

The pairing rule the codebase follows is that an icon sitting next to
`text-xs` is `h-3.5 w-3.5`, and an icon next to `text-sm` is `h-4 w-4`. The
`Kbd` component documents this explicitly. It sizes its modifier glyphs at
`h-3 w-3` with the comment "3 = 12px to match text-xs visually".

Muted icons carry `text-muted-foreground` plus `flex-shrink-0` or `shrink-0` so
they never collapse in a flex row. Icons that only appear on hover use
`opacity-0 group-hover:opacity-100 transition-opacity duration-150`.

## Colour and state on interactive elements

| state | classes | uses |
| --- | --- | --- |
| hover background | `hover:bg-foreground/10` | 77 |
| hover background | `hover:bg-muted/50` | 53 |
| hover background | `hover:bg-accent` | 43 |
| hover background | `hover:bg-foreground/5` | 33 |
| muted text | `text-muted-foreground` | 947 |
| muted text, quieter | `text-muted-foreground/60` | 56 |
| muted text, quietest | `/70`, `/50`, `/40` | 60 |

The opacity ladder is the main way this interface creates hierarchy. Full
`text-muted-foreground` is normal secondary text. `/60` is for de-emphasised
meta, such as tool subtitles and keyboard hints. `/40` and below is for
placeholder-level content.

Focus is handled globally rather than per component. From
`src/renderer/styles/agents-styles.css`.

```css
[data-agents-page] button:focus-visible,
[data-agents-page] [role="button"]:focus-visible,
[data-agents-page] a:focus-visible {
  outline: 2px solid hsl(var(--primary));
  outline-offset: 2px;
}
```

Text inputs deliberately do not get that outline. `Input` uses
`focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/20`
instead. Keep the two approaches separate.

## Motion

| token | uses |
| --- | --- |
| `transition` | 233 |
| `transition-colors` | 207 |
| `duration-150` | 173 |
| `ease-out` | 165 |
| `duration-200` | 89 |
| `duration-75` | 13 |

150ms with `ease-out` is the house default for colour and opacity changes.
200ms is used for entrance animations, defined as `agents-fade-in` and
`agents-slide-up`, both 200ms `ease-out`, with the slide travelling 8px.

Tooltips animate in with `fade-in-0 zoom-in-95` plus a directional
`slide-in-from-*-2`, and reverse on close.

Sidebar open and close uses `SIDEBAR_ANIMATION_DURATION = 0` in
`agents-layout.tsx`, and `ResizableSidebar` defaults to 0 as well, with the
comment "Disabled for performance". Panel resizing is meant to be instant. Do
not add easing to it.

On touch devices the stylesheet removes hover states entirely and replaces them
with an `:active` scale of `0.98` over 100ms, so a tap still gives feedback.

## Component reference

### Button

`bg-primary text-primary-foreground hover:bg-primary/90`, plus a two-part
shadow that gives the button its edge.

```
shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]
dark:shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(0,0,0,0.14)]
```

The outer hairline is always pure black and does not change in dark mode. Only
the inner highlight flips. That is intentional and is called out in a comment
in the file.

### Input

`h-9 rounded-lg border-input bg-background px-3 py-2 text-sm`, with
`placeholder:text-muted-foreground/70`.

### Tooltip

`max-w-[280px] rounded-md border bg-popover px-2 py-1 text-xs shadow-lg`,
`sideOffset` of 4. The component forces the `dark` class, so tooltips are dark
in both themes.

### Kbd

`text-xs font-medium uppercase tracking-wide text-muted-foreground/60`.
Modifier symbols are replaced with icons at `h-3 w-3`. Control stays a unicode
character because there is no icon for it.

### Badge

`rounded-full border px-2 py-[1px]`. The 1px vertical padding is deliberate and
should not be rounded up to `py-0.5`.

### Toast

Restyled to a Google-like layout in `globals.css`. Padding `12px 16px`, gap
8px, icon 16px, title weight 500 at 14px, description 13px in muted. Every
toast variant is forced to the neutral popover colours, so success, error and
info all look the same. The action button is pinned to the bottom right with
`padding-bottom: 44px` on the toast to make room.

### Dialog

Dialogs on the agents page carry a 4px ring rather than a drop shadow.
`rgb(229 231 235 / 0.8)` in light mode, `rgb(38 38 38 / 0.8)` in dark.

## Layout

The agents layout is a resizable left sidebar, main content, and optional
details sidebar.

| value | where |
| --- | --- |
| sidebar default 240px | `--sidebar-width` in `agents-styles.css` |
| sidebar min 160px | `SIDEBAR_MIN_WIDTH` in `agents-layout.tsx` |
| sidebar max 300px | `SIDEBAR_MAX_WIDTH` |
| `ResizableSidebar` defaults | min 200px, max unlimited, animation 0 |
| extended hover area for resize | 8px |

Main content is not width-capped by a single token. Individual pieces cap
themselves, most often at `max-w-2xl` for message bubbles and titles, and
`max-w-[280px]` to `max-w-[350px]` for popovers.

## Code and diff rendering

Code blocks in chat markdown are wrapped in
`mt-2 mb-4 rounded-[10px] bg-muted/50`. The `pre` inside uses `px-4 py-3`,
`line-height: 1.5`, `tab-size: 2`, `whitespace-pre` and the monospace stack
above.

Markdown spacing is Notion-like and deliberately tight. It is controlled by
`:has()` selectors on Streamdown's block wrappers in `agents-styles.css`.
Paragraphs and lists get 1px top and bottom margin. `h1` gets `2em` above,
`h2` gets `1.4em`, `h3` and below get `1em`. The first child never gets a top
margin. Changing these changes the rhythm of every chat message.

Git diffs render at 12px with `line-height: 1.5` in Monaco, Menlo or Consolas,
set through CSS custom properties that `@git-diff-view/react` reads.

Syntax highlighting comes from Shiki and is rendered as React text nodes by
`HighlightedTokens` in `src/renderer/components/highlighted-code.tsx`. It does
not inject an HTML string. That keeps the source text inside text nodes, which
React escapes, and it means there is no Shiki wrapper element in the DOM. No
stylesheet in this repo targets `.shiki` or `.line`, so nothing depends on
those wrappers.

Mermaid diagrams render under `securityLevel: "strict"` with `htmlLabels` left
at mermaid's default, so labels keep using `foreignObject`. The SVG is passed
through DOMPurify before it reaches the DOM. The policy and the sanitizer
config live in `src/renderer/lib/mermaid-security.ts` and are covered by
`mermaid-security.test.ts`.

## Scrollbars

Global scrollbars are 8px. Inside `[data-agents-page]` they are 6px, with the
thumb at `muted-foreground/0.3` rising to `/0.5` on hover and a 3px radius.
`.scrollbar-hide` removes the bar while keeping scrolling.

## Rules to follow when changing the UI

1. Match the existing size before reaching for a new one. Controls are `h-7`,
   inputs are `h-9`, list rows are `h-6` or `h-7`.
2. `text-xs` and `text-sm` cover almost everything. Adding `text-base` to a
   control makes it look out of place.
3. `rounded-md` is the default radius. `rounded-lg` is for inputs and large
   surfaces. `rounded-full` is for pills and avatars.
4. Use the opacity ladder for hierarchy instead of adding new colours.
5. Transitions are 150ms `ease-out` for state, 200ms for entrance. Panel
   resizing stays at 0.
6. Icon size follows the text next to it. `h-3.5 w-3.5` beside `text-xs`,
   `h-4 w-4` beside `text-sm`.
7. Focus rings come from the global stylesheet for buttons and links, and from
   the component for inputs. Do not add a second system.
8. Do not widen the primary colour or make it theme-dependent. It is fixed at
   `#0034FF` on purpose.
9. Never reintroduce `dangerouslySetInnerHTML` for rendered source text. Use
   `HighlightedTokens`.
10. Before removing a class, check whether it is a dead selector. Several
    arbitrary variants in this codebase target elements that are no longer in
    the DOM, and removing those is safe, but removing a live one is not.
