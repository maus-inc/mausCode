---
version: alpha
name: mausCode
description: >-
  Design direction for the mausCode desktop renderer, written in the DESIGN.md
  format so design skills and external agents load it in one pass. Every value
  here was read out of the running source: docs/design-system-baseline.md,
  src/renderer/styles/globals.css, src/renderer/styles/fonts.css,
  src/renderer/lib/motion.ts, src/renderer/components/ui/button.tsx and
  tailwind.config.js. Those files stay normative. Where this page disagrees
  with them, they win and this page is corrected in the same commit.
colors:
  background: "#ffffff"
  foreground: "#09090b"
  surface: "#ffffff"
  overlay: "#ffffff"
  chrome: "#fafafa"
  muted: "#f4f4f5"
  muted-foreground: "#71717a"
  border: "#e4e4e7"
  input: "#e4e4e7"
  ring: "#0033ff"
  primary: "#0033ff"
  primary-foreground: "#ffffff"
  secondary: "#f4f4f5"
  secondary-foreground: "#18181b"
  destructive: "#ef4444"
  destructive-foreground: "#f8fafc"
  plan-mode: "#f1b265"
  plan-mode-foreground: "#141414"
  selection: "rgb(0 51 255 / 0.25)"
  unseen-dot: "#307bd0"
  badge-halo-selected: "#e8e8e8"
  badge-halo-idle: "#f4f4f4"
  search-highlight: "rgb(250 204 21 / 0.35)"
  search-highlight-current: "rgb(250 204 21 / 0.85)"
  success: "#16a34a"
  danger: "#dc2626"
  question: "#3b82f6"
  pending-plan: "#f59e0b"
  needs-auth: "#eab308"
  connected: "#10b981"
  awaiting-answer: "#f97316"
  dark-background: "#09090b"
  dark-foreground: "#f4f4f5"
  dark-surface: "#09090b"
  dark-overlay: "#171717"
  dark-chrome: "#2f2f2d"
  dark-muted: "#18181b"
  dark-muted-foreground: "#8f8f99"
  dark-border: "#27272a"
  dark-input: "#27272a"
  dark-input-background: "#2f2f2d"
  dark-destructive: "#7f1d1d"
  dark-success: "#4ade80"
  dark-danger: "#f87171"
typography:
  page-title:
    fontFamily: Geist Pixel Circle
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: -0.025em
  section-title:
    fontFamily: Geist Pixel Circle
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: -0.025em
  card-title:
    fontFamily: Geist Pixel Circle
    fontSize: 16px
    fontWeight: 500
    lineHeight: 1.4
  row-title:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.25
  row-title-active:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.25
  body-md:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.4
  label-sm:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.33
  meta-dense:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.3
  micro-label:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 10px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: 0.05em
  button-label:
    fontFamily: Pathway Extreme
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1
    letterSpacing: -0.03em
  telemetry-data:
    fontFamily: Source Code Pro
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  footer-micro:
    fontFamily: Neue Haas Grotesk Display
    fontSize: 9px
    fontWeight: 400
    lineHeight: 1.3
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  full: 9999px
spacing:
  xxs: 2px
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 24px
  sidebar-width: 240px
  rail-width: 56px
  row-height: 30px
  input-height: 28px
  tab-bar-height: 36px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    height: 28px
    padding: 12px
    rounded: "{rounded.md}"
    typography: "{typography.button-label}"
  button-primary-hover:
    backgroundColor: "rgb(0 51 255 / 0.9)"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    height: 28px
    padding: 12px
    rounded: "{rounded.md}"
  button-destructive:
    backgroundColor: "{colors.destructive}"
    textColor: "{colors.destructive-foreground}"
    height: 28px
    padding: 12px
    rounded: "{rounded.md}"
  button-destructive-hover:
    backgroundColor: "rgb(239 68 68 / 0.9)"
  focus-ring:
    height: 2px
    rounded: "{rounded.md}"
  row:
    backgroundColor: "transparent"
    height: 30px
    padding: 8px
    rounded: "{rounded.md}"
    typography: "{typography.row-title}"
  row-hover:
    backgroundColor: "rgb(9 9 11 / 0.05)"
  row-checked:
    backgroundColor: "rgb(0 51 255 / 0.1)"
  tab-pill:
    backgroundColor: "{colors.muted}"
    height: 28px
    padding: 6px
    rounded: "{rounded.md}"
    typography: "{typography.body-md}"
  tab-pill-hover:
    backgroundColor: "rgb(244 244 245 / 0.8)"
  icon-button:
    width: 24px
    height: 24px
    rounded: "{rounded.md}"
    textColor: "{colors.muted-foreground}"
  input-field:
    backgroundColor: "{colors.muted}"
    height: 28px
    padding: 12px
    rounded: "{rounded.lg}"
    typography: "{typography.body-md}"
  status-pill:
    height: 20px
    padding: 8px
    rounded: "{rounded.full}"
    typography: "{typography.label-sm}"
  tooltip:
    backgroundColor: "{colors.overlay}"
    textColor: "{colors.foreground}"
    padding: 8px
    rounded: "{rounded.md}"
    typography: "{typography.label-sm}"
  card:
    backgroundColor: "{colors.background}"
    rounded: "{rounded.lg}"
    padding: 16px
---

# Design System: mausCode

## Overview

mausCode is a desktop workbench for running coding agents. The visitor is the
operator, the surface is `Operate` mode, and the job is scanability: many rows,
fast comparison, low ceremony. The UI reads as a tool the user lives inside, not
a marketing page about a tool.

Three ideas govern every choice here.

**Density over decoration.** Hierarchy comes from size, weight, position and the
foreground wash scale, not from color. A row earns attention by being 14px medium
on a 5 percent wash, not by being colored.

**One accent, spent deliberately.** `#0033ff` means "act here" or "you selected
this". It is the focus ring, the primary button and the checked wash. It is never
a gradient, a background or a heading tint.

**Native chrome.** Traffic-light spacing, `aria-pressed` tiles, hover-reveal
row actions and instant status swaps come from how macOS and Linear-class tools
behave. A control that looks native and behaves generically is a defect.

The voice is flat and technical. Copy states what happened and what to do next:
`Archiving...`, `Remove this project?`, `Reveal in Finder`. No hype, no
reassurance, no emoji, and no ellipsis character.

## Colors

`src/renderer/styles/globals.css` defines every app color as an HSL triplet on a
CSS variable and `tailwind.config.js` maps it to a semantic utility. Name the
variable, never the hex. The hex values in the front matter are the decoded form
of the shipped triplet, recorded for tools that cannot read CSS variables.

**Primary.** `#0033ff` from `--primary: 228 100% 50%`, shared by both themes. The
repo comment beside it claims `#0034FF`. The variable is normative and the comment
is one unit off in the blue channel. Fix the comment, not the token.

**Ground.** Light `background` and `surface` are `#ffffff`; dark `background` is
`#09090b` and `popover` is `#171717`. `--tl-background`, the titlebar and sidebar
chrome, is `#fafafa` in light and `#2f2f2d` in dark, which is the same value as
`--input-background`. Claude's input gray is the deliberate reference.

**Text.** `foreground` is `#09090b` on light and `#f4f4f5` on dark. Muted text is
`#71717a` on light and `#8f8f99` on dark, and it carries every label, subtitle and
timestamp.

**Wash scale.** Hierarchy builds from foreground alpha, not grays. `/5` is the row
wash for hover and selection. `/10` is the checked and primary wash. Rail active
tiles take `bg-foreground/10`. An invented step such as `/[0.06]` or `/[0.08]` is
out of the system.

**Status map.** One meaning, one color, no substitutions.

| Meaning | Token to reach for | Light | Dark |
| --- | --- | --- | --- |
| Addition, success | `text-green-600` | `#16a34a` | `dark:text-green-400` `#4ade80` |
| Deletion, destructive text | `text-red-600` | `#dc2626` | `dark:text-red-400` `#f87171` |
| Error box | `border-destructive/20 bg-destructive/10 text-destructive` | `#ef4444` | same |
| Pending question | `text-blue-500` | `#3b82f6` | same |
| Pending plan | `bg-amber-500` | `#f59e0b` | same |
| Needs auth | `bg-yellow-500` | `#eab308` | same |
| Unseen, done | `bg-[#307bd0]` | `#307bd0` | same, baseline-original |
| Connected, pushed | `bg-emerald-500`, `text-emerald-500` | `#10b981` | same |
| Awaiting answer | `bg-orange-500/10` with `text-orange-500` | `#f97316` | same |
| Quota at or above 80 percent | `text-orange-500` | `#f97316` | `orange-400` is out |

**Hardcoded hex is allowed only where the baseline names it**: the `#e8e8e8` and
`#1b1b1b` badge halos on `ChatIcon`, the `#307bd0` `LoadingDot` default, and the
`#0034ff` family inside appearance previews, which show themes rather than use
them. `rgba(255, 255, 255, ...)` as a fallback is banned because it erases light
mode. `sky-500` has zero baseline precedent and stays out of the sidebar.

## Typography

Four families ship in `src/renderer/styles/fonts.css` and `tailwind.config.js`.

**Neue Haas Grotesk Display** is the body and UI face at every size in the
interface. Its cuts map to the Tailwind weight scale: 100 XXThin, 200 XThin,
250 Thin, 300 Light, 400 Roman, 500 Medium, 700 Bold, 900 Black, with 600 and 800
falling back to Bold and Black.

**Geist Pixel Circle** is the display face for brand text and headings.
`globals.css` applies it to `h1` through `h6`, so a heading is pixel-faced by
default and a title rendered with a `div` is not. Keep the heading on a heading
element or state why it is not one.

**Pathway Extreme** is the button face. `globals.css` sets every `button` element
to weight 100 with `--button-tracking`, which is `-0.03em`. The direction asked for
`-3px`; at 13 to 14px button text that overlaps glyphs, so the shipping value is
the equivalent tight tracking and the comment in `globals.css` records the trade.
A `Button` that also carries `font-medium` renders at 500, because the utility
layer beats the base layer. That is why chrome buttons look medium and raw
`<button>` elements look thin. Pick one and mean it.

**Source Code Pro** carries ids, paths, diffs and terminal output through
`font-mono`. Times, counts and percentages take `tabular-nums` so digits align.

Sizes are a closed set: 24px full-page headers, 18px dialog and section titles,
16px card titles, 14px row titles and body, 12px labels, meta and buttons, 11px
dense second-line meta, 10px uppercase micro-labels with `tracking-wider`, and 9px
footer micro, which survives only in the usage footer. Row titles are `font-normal`
and gain `font-medium` when selected. Never semibold at those two levels.

Ellipsis is three ASCII dots. `…` has zero baseline precedent and is banned in UI
strings.

## Layout

The window is three columns: a 56px projects rail, a 240px sidebar, then the
chat surface. The rail is `border-r bg-background/60` at 0.5px; the sidebar is
`bg-tl-background` with a traffic-light spacer of 36px on desktop non-fullscreen
and 12px elsewhere.

Spacing runs on Tailwind's 4px scale, with two half steps that the baseline
records: 6px row padding and 2px hairlines. Reference rows are `py-1.5` with
`pl-2 pr-2`, a `gap-2.5` icon-to-body gap, and two lines: a `text-sm` title over
an `text-[11px]` meta row that carries the repo, branch, `+N` and `-N` stats and a
compact age in `now 5m 3h 2d 4w 9mo 1y` form.

Settings pages run `space-y-4 p-6`, tab containers `space-y-6`, cards `p-4`. The
login shell is `w-[380px] p-6` with an absolute close button at `right-4 top-4`.
Content column pills cap at `max-w-[180px]` for open tabs and `max-w-[150px]` for
recent ones, and overflow gets an edge fade rather than a scrollbar.

Measure stays under 80 characters. Chat text does not stretch to the window; when
a surface grows past that, add a max width instead of letting lines run.

## Elevation & Depth

The app is flat by default. Depth comes from borders, washes and a single inset
hairline, which is what makes density readable.

**Shadows are functional.** The primary button carries
`shadow-[0_0_0_0.5px_rgb(23,23,23),inset_0_0_0_1px_rgba(255,255,255,0.14)]` and
swaps the inner ring to `rgba(0,0,0,0.14)` in dark; that reads as a beveled edge,
not a lift. `outline`, `secondary` and `destructive` take `shadow-sm shadow-black/5`.
Everything else sits flat.

**Popovers float.** A truncated-name tooltip renders `bg-popover border-border
rounded-md shadow-lg` at `z-[100000]` with a 1000ms hover delay. Rail status dots
sit on `bg-background ring-1 ring-border/60` halos.

**Scroll fades, not shadows.** Overflowing columns get
`h-10` to `h-12 pointer-events-none bg-gradient-to-b from-tl-background
via-tl-background/50 to-transparent`, with opacity flipped through refs so no
render happens, at a 5px edge threshold.

**Scrollbars stay thin.** `scrollbar-thin
scrollbar-thumb-muted-foreground/10 hover:scrollbar-thumb-muted-foreground/20
scrollbar-track-transparent`.

## Shapes

One radius variable drives the scale: `--radius: 0.5rem`, so `lg` is 8px, `md` is
6px and `sm` is 4px, with `calc()` steps rather than new numbers. `rounded-full`
belongs to pills, dots and count badges and to nothing else. Sidebar rows are
`rounded-md` and go square when multi-select widens their hit area; settings cards
are `rounded-lg`; project cards and empty states are `rounded-xl`, which is the one
step above `lg` the baseline tolerates. Corner badges on icons are 12px circles
holding a 6px or 10px glyph.

Do not mix radii inside one view for style. A radius change is a hierarchy
decision and needs the same justification as a color change.

## Components

**Buttons.** `rounded-md text-sm font-medium h-7 px-3`, with `h-10 px-8` for `lg`,
`h-7 w-7` for icon and `disabled:opacity-50`. Variants are `default`, `brand`,
`destructive`, `outline`, `secondary`, `ghost` and `link`.

**Focus.** Every interactive row and button carries
`outline-offset-2 focus-visible:outline focus-visible:outline-2
focus-visible:outline-ring/70`. The primary button uses the `outline-primary/70`
form. `outline-none` without a replacement focus affordance is a finding.

**Rows.** A row is `w-full text-left py-1.5 cursor-pointer group relative` with
`transition-colors duration-75`. Selected and hovered land on
`bg-foreground/5 text-foreground`; idle is `text-muted-foreground`. Checked rows
take `bg-primary/10` and `hover:bg-primary/15`.

**Hover-reveal actions.** `opacity-0 group-hover:opacity-100`, optionally with a
1px translate, plus `pointer-events-none group-hover:pointer-events-auto` so an
invisible control is not clickable. They are mouse conveniences: `tabIndex={-1}`,
and the row itself is the tab stop.

**Icon buttons.** `h-6 w-6` in chrome, `w-5 h-5` in dense rows, `rounded` in dense
rows and `rounded-md` in chrome, `text-muted-foreground` rising to
`text-foreground` on hover. Lucide icons run 18px at `strokeWidth={1.5}` in chrome
and 12 to 15px at `strokeWidth={1.8-2.2}` in rows; status glyphs go to 2.5.

**Tooltips.** `delayDuration={500}` in app chrome, always. 300ms and the 700ms
default are out. Content is plain text, or a title plus a `Kbd` such as
`Settings ⌘,`. A usage breakdown gets `min-w-[180px]`, a `font-medium` title and
`text-[11px]` label and value rows.

**Badges and dots.** Count pill is `rounded-full bg-primary/10 text-primary`.
Status pill is `inline-flex items-center rounded-full px-2 py-0.5 text-xs
font-medium` over a 10 percent wash with solid-500 text. Dots are `w-1.5 h-1.5`
in rows and `w-2 h-2` in status wells. Priority order for a corner badge:
question, loader, plan, unseen.

**Inputs.** Settings search is `h-7 w-full rounded-lg text-sm bg-muted
border border-input px-3 placeholder:text-muted-foreground/40 outline-none`. The
command-palette search is `rounded-md text-[12.5px] bg-transparent
border border-border/30 focus:bg-foreground/[0.03] focus:border-border/60 px-2.5
h-7` and collapses to zero height when closed. A bare `input` with `outline-none`
is allowed only when it autofocuses and commits on Enter, Escape and blur;
otherwise use `Input`.

**Dialogs.** Confirms use the shared `AlertDialog` primitives, with the destructive
action on `bg-destructive text-destructive-foreground hover:bg-destructive/90`. A
hand-rolled portal dialog is out. A Radix `Checkbox` is a `role="checkbox"` button,
so a `<label>` cannot point at it; name it with `aria-label`, and use
`aria-pressed` on toggle buttons.

**Skeletons and empty states.** Skeleton rows are `Skeleton h-[14px] rounded-sm` at
65 and 45 percent widths; card skeletons are
`h-[88px] animate-pulse rounded-xl border border-border/60
bg-foreground/[0.03]`. An empty state is a dashed `rounded-xl` panel with an
`h-8 w-8 text-muted-foreground/60` icon, a `text-sm font-medium` title, an
`text-xs text-muted-foreground` hint and an action.

**Motion.** `src/renderer/lib/motion.ts` is the only source of timing. `EASE_OUT`
is `[0.23, 1, 0.32, 1]`, `EASE_OUT_EXPO` is `[0.16, 1, 0.3, 1]`, `DURATION_INSTANT`
is 0.1s for status swaps, `DURATION_FAST` is 0.15s for entrances,
`DURATION_NORMAL` is 0.18s with the expo curve for expand and collapse, and
stagger runs 0.025s between children after a 0.02s lead-in. Row and tab hovers use
`transition-colors duration-75`; every other hover is `duration-150 ease-out`, with
`duration-100` acceptable on icon buttons. Press feedback is `active:scale-[0.97]`
on buttons and `active:scale-90` on tiny icon buttons. A new duration belongs in
that module, not inline.

## Do's and Don'ts

- Do read `docs/design-system-baseline.md` before touching interface code, and
  mirror the exact layout, sizing, placement, prop shapes and micro-details it
  records.
- Do re-check your own UI change against the surrounding screens before you call it
  done. The app must feel like one product.
- Do pull every color from a CSS variable, and every duration from `lib/motion.ts`.
- Do keep the focus ring on any control a keyboard can reach, and give every
  icon-only button an `aria-label`.
- Do use `...` for ellipsis, sentence case for headings and labels, and
  `uppercase tracking-wider` only at 10px micro labels.
- Don't invent a new wash step, a new accent, or a new radius to solve a hierarchy
  problem. Choose among the recorded values.
- Don't tint a heading with `primary`, gradient a surface, or glass a panel because
  the section felt flat. Antislop calls that technique without purpose.
- Don't use `sky-500`, `rgba(255,255,255,...)` fallbacks, `rounded-full` pills in
  the tab bar, or the `…` character.
- Don't fade sections in on page load or transition every card on hover. Motion
  answers an action.
- Don't ship a component that borrows another product's name or look. Identity
  lives in `src/shared/app-identity.ts`.
- Don't trust this page over the code. `brand` on `src/renderer/components/ui/button.tsx`
  reads `--primary-gradient-start` and `--primary-gradient-end`, which no stylesheet
  in the repo defines, so that variant's gradient resolves to nothing today. Fix the
  variant or delete it, and record the outcome here.

## Provenance and precedence

The token format follows the DESIGN.md alpha spec at
`https://github.com/google-labs-code/design.md`, so `impeccable`, `antislop` and
other design skills can load this file without a translation step. Tailwind configs,
Figma variables and `tokens.json` all round-trip through the same shape.

Precedence, highest first:

1. The user's instruction in the current turn.
2. `docs/design-system-baseline.md`, including its section 10 punchlist.
3. This file.
4. A design skill's house taste, including antislop's dials and impeccable's
   references. Skill guidance never overrides a recorded value, and it never
   supplies one either.

Load the routing table and the execution limits in
`docs/design-skills.md` alongside this file for any UI or design work.
