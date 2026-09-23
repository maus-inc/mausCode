# mausCode Design System Baseline

**Status:** binding reference for all UI work on this branch.
**Baseline commit:** `6b0de32` (`init`) — the pre-branch design system the user knows and likes.
**Method:** every rule below was verified against baseline sources (≥2 sightings unless noted
as a single-precedent rule). `HEAD:` paths refer to baseline; worktree deviations found during
the audit are listed in §10 with their dispositions.

Related decisions:

- 2026-09-11 — Batch C adopted the 1code sidebar lineage (rail + grouped list + usage footer).
  Structure stays; visual execution must be re-skinned to this baseline (user: "match").
- 2026-09-11 — Orphaned visible features (multi-select, pinning, row meta, accent tint, thread
  hierarchy) must be re-wired into visible UI, not deleted (user: "restore-ui").

---

## 1. Color tokens

### 1.1 Semantic tokens (CSS vars; never hardcode their hex)

`background` `foreground` `muted` (+`muted-foreground`) `accent` (+`accent-foreground`)
`primary` (+`primary-foreground`) `secondary` `destructive` `border` `input` `ring` `popover`
`card` `sidebar` (+`sidebar-foreground`/`sidebar-accent`/`sidebar-border`/`sidebar-ring`)
`tl-background` (titlebar/sidebar chrome). Status dots may use `bg-current` (loading dot).

### 1.2 The wash scale (foreground-over-background tints)

Baseline builds hierarchy from **foreground alpha washes**, not grays:

| value | meaning |
|---|---|
| `bg-foreground/5` + `rounded-md` | selected row / hover row (sidebar rows, tab pills via `bg-muted`) |
| `bg-foreground/[0.08]` | NOT baseline (transplant invention; use `/5`) |
| `bg-foreground/[0.06]`, `/[0.04]`, `/0.03` | NOT baseline in sidebar context |
| `bg-foreground/10` | rail active tile only (new surface; acceptable there) |
| `hover:bg-foreground/10` | primary button hover (`Feedback` button), dev-server icon button |
| `bg-primary/10` + `hover:bg-primary/15` | checked (multi-select) rows |
| `bg-muted`, `hover:bg-muted/80` | tab pills, icon-button hover (`hover:bg-muted/50` in footer) |
| `bg-muted/50` | search wells, footer rows, aside rows |

Rule: **/5 is the row wash; /10 is the checked/primary wash.** Arbitrary `[0.0x]` washes are out.

### 1.3 Hardcoded hex (the only ones allowed)

- `bg-[#E8E8E8] dark:bg-[#1B1B1B]` selected badge halo; `bg-[#F4F4F4] group-hover:bg-[#E8E8E8]
  dark:bg-[#101010] dark:group-hover:bg-[#1B1B1B]` unselected halo (`ChatIcon` corner badge).
- `bg-[#0034FF]`-family theme accents in appearance previews (theme system, not app chrome).
- `bg-[#307BD0]` — the `LoadingDot` default dot: tab unseen dots, sidebar unseen dots, rail
  unseen dots, project-page unseen badges. Baseline-original; do not "fix" to a token.
- `#fff` initial on rail tile accent bg: allowed only with a dark-enough accent (see §10).

No other raw hex/rgba in app chrome. `rgba(255,255,255,…)` fallbacks are banned (break light mode).

### 1.4 Semantic color map (one meaning → one color)

| meaning | light | dark | notes |
|---|---|---|---|
| additions / success | `text-green-600` | `dark:text-green-400` | file stats, Edit `+N`, plan dots |
| deletions / destructive text | `text-red-600` | `dark:text-red-400` | file stats, Edit `-N` |
| error box | `border-destructive/20 bg-destructive/10 text-destructive` | same | login forms |
| pending question | `text-blue-500` | same | badges, icons |
| pending plan | `bg-amber-500` | same | dots |
| needs-auth dot | `bg-yellow-500` | same | MCP indicator (baseline-original) |
| unseen / done | `bg-[#307BD0]` dot | same | `LoadingDot` default; sidebar/rail/page dots; names stay muted (see §4.1) |
| enabled / connected | `bg-emerald-500` / `text-emerald-500` | same | settings states (beta, plugins); pushed Check (new state, success-family) |
| awaiting-answer banner | `bg-orange-500/10 border-orange-500/… text-orange-500` | same | chat banner; bare `text-orange-500` ×3 precedent |
| high quota (≥80%) | `text-orange-500` | same | NOT `orange-400` (zero baseline precedent) |
| pushed | `text-emerald-500` Check | same | new bucket state; emerald = done-family ✓ |
| sky accents | — | — | `sky-500` has NO baseline precedent; do not use in sidebar |

`yellow-500` (dots) and `amber-500` (plans/badges) coexist in baseline; both stay.

---

## 2. Type

- App font: system stack via CSS vars; mono via `font-mono` for ids, code, numbers-with-units.
- Tabular numbers: `tabular-nums` on times, counts, percents (`formatTimeAgo` spans, quota chips).
- Sizes: `text-xs` (12px) labels/meta/buttons; `text-[11px]` second-line meta and dense rows;
  `text-[10px]` micro-labels (with uppercase, see §3.6); `text-[9px]` footer micro — transplant
  size, keep only in the usage footer; `text-sm` (14px) row titles, body, inputs; `text-base`
  dialog titles + card titles; `text-lg` page/section titles + dialog titles (`Archive Thread`,
  `Backends`); `text-2xl` full-page headers (`Projects`).
- Row titles are `font-normal`; selected/active row titles add `font-medium` (never semibold).
- Section titles: `text-xs font-medium` sentence-case (sidebar), `text-sm font-medium` (settings
  cards), NEVER semibold for these two levels.
- Ellipsis: three ASCII dots `...` (`Archiving...`, `Opening...`). The `…` char has ZERO
  baseline precedent — banned in UI strings.

---

## 3. Global patterns

### 3.1 Focus (non-negotiable, on every interactive row/button)

```
outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70
```

Icon buttons without visible affordance use the same ring (never `outline-none` without a
replacement). `tabIndex={-1}` on hover-only row actions (they're mouse conveniences; the row
itself is the tab stop).

### 3.2 Motion

- Row/tab hover cross-fades: `transition-colors duration-75` (sidebar rows AND tab pills).
- Everything else hover: `duration-150 ease-out` (occasionally `duration-100` for icon buttons).
- Press: `active:scale-[0.97]` (buttons), `active:scale-90` (tiny icon buttons).
- Hover-reveal actions: `opacity-0 group-hover:opacity-100` + optional `translate-x-1 →
  translate-x-0` slide; baseline archive button adds `scale-95 → scale-100` + `pointer-events`
  choreography (`pointer-events-none group-hover:pointer-events-auto`).
- Expand/collapse: `AnimatePresence` height+opacity (`TRANSITION_EXPAND` / `duration: 0.15`-class).
- Stagger: `STAGGER_DELAY`/`STAGGER_DELAY_CHILDREN` for list entrance (sub-chat lists).
- Status icon swaps: `AnimatePresence mode="wait"` + `DURATION_INSTANT` + `EASE_OUT`.
- Spinners: `animate-spin` on `RefreshCw`/`IconSpinner`/`Loader2`; grid-pulse is transplant-only
  (allowed as the loading glyph where adopted, keep 12px in rows).

### 3.3 Tooltips

- `delayDuration={500}` everywhere in app chrome (sidebar: 6/6 baseline usages). 300ms and
  default (700ms) are out.
- Content pattern: `TooltipContent` plain text, or title + `Kbd` hotkey (`Settings ⌘,`).
- Rich breakdowns (usage footer) use `min-w-[180px]` + `font-medium` title + `text-[11px]`
  label/value rows (`text-muted-foreground` / `font-mono text-foreground`).

### 3.4 Icon buttons

- Row-inline hover actions: `h-6 w-6` (footer/header) or `w-5 h-5` (dense rows), `rounded`
  (dense) / `rounded-md` (chrome), `text-muted-foreground/… → hover:text-foreground`,
  `hover:bg-foreground/[0.05..0.08]` in sidebar context, `hover:bg-muted/50` in footer context.
- 18px chrome icons use `strokeWidth={1.5}`; 12–14px row icons `strokeWidth={1.8–2.2}`;
  status glyphs (`Check`, channel dots) `strokeWidth={2.5}` / solid dots.
- Destructive menu items: `text-destructive focus:text-destructive` + icon, after a separator.

### 3.5 Badges, pills, dots

- Count pill: `rounded-full bg-primary/10 text-primary` (chat card) — the pill shape reference.
- Status pill (settings): `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`
  with `/10` wash + solid-700 text in light and 400 in dark (`emerald/amber/red`), `mute` =
  `bg-foreground/5 text-foreground/60`. The light 500 step measured 2.31, 1.99 and 3.29:1 at
  12px, below the 4.5:1 floor, so the recorded step moved one darker.
- Corner badge on icons: `absolute -bottom-1 -right-1 w-3 h-3 rounded-full` halo + `w-1.5/w-2.5`
  glyph inside; priority question > loader > plan > unseen.
- Standalone dots: `w-1.5 h-1.5 rounded-full` (rows), `w-2 h-2` (status wells).

### 3.6 Section / micro labels

- Sidebar sections: `h-4 mb-1 pl-2` + `h3 text-xs font-medium text-muted-foreground`
  sentence-case (`Pinned workspaces`, `Recent workspaces`).
- Micro labels (settings, dense lists): `text-[10px] font-medium text-muted-foreground uppercase
  tracking-wider` — 10px, medium, full muted, `tracking-wider` (NOT `wide`, NOT semibold).
- Settings card headers: `h4 text-sm font-medium text-foreground` + `p text-xs
  text-muted-foreground` (NEVER uppercase at this level).

### 3.7 Search inputs

- Settings search: `h-7 w-full rounded-lg text-sm bg-muted border border-input px-3
  placeholder:text-muted-foreground/40 outline-none` (mcp tab).
- Pole search (⌘K-triggered sidebar): `rounded-md text-[12.5px] bg-transparent border
  border-border/30 focus:bg-foreground/[0.03] focus:border-border/60 px-2.5 h-7`, collapses to
  `h-0 opacity-0 border-0 p-0 m-0` when empty+closed.

### 3.8 Dialogs

- Confirms: shared `AlertDialog` (`AlertDialogContent/Header/Title/Description/Footer/Cancel/
  Action`); destructive action = `bg-destructive text-destructive-foreground
  hover:bg-destructive/90`. Custom portal+motion dialogs are out (see §10).
- Login shells: `AlertDialogContent w-[380px] p-6` + absolute X
  (`absolute right-4 top-4 h-6 w-6 p-0 border-0 bg-transparent hover:bg-muted rounded-sm
  opacity-70 hover:opacity-100` + `sr-only` Close).
- Rename inputs: raw `input` with `bg-transparent … outline-none` is allowed ONLY with autofocus
  + Enter/Escape/blur commit (project rename); otherwise use `Input`.

### 3.9 Skeletons, empty states, gradients

- Skeleton rows: `Skeleton h-[14px] rounded-sm` at 65%/45% widths, `py-px space-y-px`.
- Card skeletons: `h-[88px] animate-pulse rounded-xl border border-border/60 bg-foreground/[0.03]`.
- Empty states: `border-dashed` rounded-xl panel, `h-8 w-8 text-muted-foreground/60` icon,
  `text-sm font-medium` title + `text-xs text-muted-foreground` hint + action button.
- Scroll fades: `h-10/h-12 pointer-events-none bg-gradient-to-b/t from-tl-background
  via-tl-background/50 to-transparent transition-opacity duration-150`, opacity flipped via
  refs (no re-render), 5px edge threshold.

### 3.10 Scrollbars, dividers, borders

- Thin scrollbars: `scrollbar-thin scrollbar-thumb-muted-foreground/10
  hover:scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent`.
- Dividers: `border-border/40..60`, `divide-border`, hairlines `h-px bg-foreground/[0.08]`
  (rail divider, new surface — allowed).
- Cards: `rounded-lg border border-border` (settings), `rounded-xl border-border/60
  bg-background/50 hover:border-border hover:bg-foreground/[0.03]` (project cards).

---

## 4. Surface specs

### 4.1 Sidebar workspace rows (the reference component)

Baseline `AgentChatItem` (`HEAD:features/sidebar/agents-sidebar.tsx:551+`):

```
w-full text-left py-1.5 cursor-pointer group relative
transition-colors duration-75
<focus ring>
pl-2 pr-2  (+ rounded-md when NOT multi-select; px-3 in multi-select)
selected/focused: bg-foreground/5 text-foreground
else:             text-muted-foreground hover:bg-foreground/5 hover:text-foreground
checked:          bg-primary/10 (hover:bg-primary/15)
```

- Layout: `flex items-start gap-2.5`; icon in `pt-0.5` (`ChatIcon w-4 h-4`: avatar/logo +
  corner badge + checkbox cross-fade on multi-select); body `flex-1 min-w-0 flex flex-col
  gap-0.5`.
- Line 1: `truncate block text-sm leading-tight flex-1` (`TypewriterText`, placeholder
  `New workspace`) + hover archive (`w-3.5 h-3.5` box, scale/pointer-events choreography,
  `ArchiveIcon h-3.5`, `aria-label="Archive workspace"`, `tabIndex={-1}`).
- Line 2 (meta): `flex items-center gap-1 text-[11px] text-muted-foreground/60`:
  `CloudIcon h-2.5` if remote; `truncate flex-1` displayText (`{repo} • {branch}` or branch or
  path); right cluster `flex items-center gap-1.5`: `+N` green / `-N` red (only when > 0) +
  compact time (`now 5m 3h 2d 4w 9mo 1y`).
- Context menu `w-48`: Pin/Rename/Copy-branch/Export-sub/Open-in-new-window/Archive(+Kbd)/
  Archive-all-below/Archive-others; multi-select variant with bulk items + `pluralize()`.
- Truncated-name tooltip: DOM-manipulated portal (`fixed z-[100000] max-w-xs px-2 py-1 text-xs
  bg-popover border border-border rounded-md shadow-lg`), 1000ms hover delay, no state.

Draft rows: same shell (`py-[7px]`, `pl-[22px]` when nested), blue `bg-blue-500/60` dot,
single-line `text-[13px]`, trash `w-5 h-5 / h-3`.

### 4.2 Sidebar frame

- Container: `group/sidebar flex flex-col gap-0 overflow-hidden select-none h-full
  bg-tl-background`, `data-sidebar-content`.
- Traffic-light spacer above content (desktop non-fullscreen).
- Beta nav: full-width `px-2.5 py-1.5 rounded-lg text-[13px] border border-border/50`
  buttons (`Inbox`, `Automations` with `ArrowUpRight h-3.5` reveal, `Kanban` with `Kbd`).
- Project groups: `group/project-header flex items-center gap-1 mt-4 first:mt-1 cursor-pointer`;
  label `text-[14px] text-foreground/70 font-medium truncate flex-1 py-1`; hover icon buttons
  (`h-6 w-6 rounded text-muted-foreground/55 hover:text-foreground/90`, mark-read is
  `text-sky-500`→out, see §10); `ContextMenuContent`: Collapse/Project-settings/New-agent/
  Mark-all-read.
- Status buckets (transplant structure, re-skinned): header
  `group/bucket-header flex items-center px-3 pt-1.5 pb-0.5 select-none` + micro label per §3.6
  + hover `Archive all` (`h-5 w-5`, `Archive size={13}`); rows per §4.1 adapted to
  single-line + status well (see §10).
- Archived section: same header + `ChevronRight size={11}` rotate-90, `hover:bg-foreground/[0.02]`,
  rows dimmed `text-muted-foreground/50 → hover:text-foreground/80`.
- Footer: swaps (instant, `duration: 0`) between **multi-select toolbar** (`p-2`: `text-xs`
  count + `Cancel` + `Button outline sm flex-1 h-8 gap-1.5 text-xs rounded-lg` Archive) and
  **usage footer** (transplant; dense `text-[11px]` provider rows + quota chips, tooltips right).
  Normal footer (settings/help/kanban/archive icons + Feedback) is retired: settings moved to
  rail, kanban to top nav; help popover + Feedback button dropped with the rewrite (accepted).
- Layout tint: sidebar column is `bg-background` (no `bg-white/[0.03]` wash — reverted, §10).

### 4.3 Projects rail (new surface; Batch C)

- `width: 56`, `border-r bg-background/60` (0.5px), `pb-3`, top pad 36 (traffic lights) / 12.
- `RailButton`: `h-9 w-9 rounded-lg`, active `bg-foreground/10 text-foreground` + left bar
  (`absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground`),
  idle `text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground`,
  focus ring, `aria-pressed`, tooltip right `sideOffset={8}`.
- Tiles: `h-7 w-7 rounded-md border border-foreground/10`, accent bg + `text-[11px] font-semibold
  uppercase` initial (contrast-safe color, see §10) or `img object-cover`; divider
  `my-1 h-px w-6 bg-foreground/[0.08]`.
- Status dots on `bg-background ring-1 ring-border/60` halos: TL blue awaiting, BL emerald
  unseen, BR loader in-progress. Drag-reorder: `opacity-40` while dragging, `h-[2px]
  rounded-full bg-foreground` drop bars.
- Context menu: Open / Reveal in Finder (baseline string ✓) / Refresh git info / Hide from
  rail / Manage on projects page / Remove (destructive). Delete confirm via AlertDialog.

### 4.4 Sub-chat tabs

- Bar: `flex items-center gap-1 px-2 h-9 border-b border-border/40` (approx; see
  `sub-chat-selector.tsx`).
- Pill (baseline `rounded-md text-sm bg-muted`, `max-w-[180px]` open / `max-w-[150px]` recent,
  `px-1.5`, `transition-colors duration-75`, `hover:bg-muted/80`): close X
  (`h-4 w-4 rounded-sm hover:bg-foreground/10`, `X h-3`), edge fade gradients
  (`rounded-r-md … from-muted`) for overflow. `rounded-full` pills are OUT (§10).
- Unseen dot: emerald; loading: spinner; dirty: dot. Mode icon `w-2.5` inline.

### 4.5 Chat: bubbles, banners, tool calls

- User bubble: right-aligned card; hover actions live in the message-group overlay row
  (`isolated-message-group.tsx:233`, `group-hover/user-message`), using shared `CopyButton`
  (copy↔check morph + haptic). Floating `-bottom-6` buttons are OUT (§10).
- Assistant `Awaiting your answer`: `bg-orange-500/10` wash + `border-orange-500` + bare
  `text-orange-500` (§1.4).
- Tool calls: one-line header (`text-[13px]` title + `text-[11px]` plain-text subtitle —
  subtitles are PLAIN TEXT, never HTML: `a<b` filenames must render literally, XSS-safe),
  `text-muted-foreground/70` meta, expand chevron, `+N/−N` in green/red §1.4; Edit rows show
  old→new path tokens (`text-[11px] text-green-600 dark:text-green-400` /
  `text-red-600 dark:text-red-400`). MCP rows: same shell + `MCP` tag + server name.
- Review blocks: `h-6` icon buttons (baseline-original `sub-chat-status-card.tsx:224-234`).
- Mode icons: `ModeIcon w-2.5/w-4`, selected-state colors preserved (chat card, quick-switch).

### 4.6 Settings tabs

- Page: `space-y-4 p-6` (Backends) / tab container `space-y-6`; page header `text-lg
  font-semibold` + `text-sm text-muted-foreground` lede.
- Cards: `bg-background rounded-lg border border-border overflow-hidden` + `p-4`; card header
  `h4 text-sm font-medium` + `text-xs/​text-sm text-muted-foreground` description; rows
  `flex items-center justify-between` + `Switch`/ghost `Reset` (`text-muted-foreground
  hover:text-foreground`).
- Label/value rows: `flex items-start justify-between gap-4 py-1 text-sm`
  (`text-muted-foreground` label / `text-foreground` value).
- Status pills per §3.5; provider rows `divide-y divide-border px-4 py-2.5` + name
  `text-sm font-medium` + id `text-[10px] font-mono text-muted-foreground/70` + meta
  `text-[11px] text-muted-foreground`; search per §3.7.
- Accent swatches: `w-7 h-7 rounded-md border-2` (`border-foreground scale-110` selected,
  `border-transparent hover:scale-110` idle), `transition-all duration-150 cursor-pointer`,
  `title={hex}`, focus ring + `aria-pressed` required (§10).

### 4.7 Login dialogs

- Content mirrors `CodexLoginContent` exactly: `space-y-8` > `text-center space-y-4` > dual
  badge (`flex … gap-2 p-2 mx-auto w-max rounded-full border border-border`; `w-10 h-10
  rounded-full bg-primary` + `Logo w-5 h-5 invert`; `bg-foreground` + provider `w-6 h-6
  text-background`) > `space-y-1` (`h1 text-base font-semibold tracking-tight` +
  `p text-sm text-muted-foreground` + url-fallback `text-xs` link `text-primary hover:underline`
  + device-code chip `rounded-lg border bg-muted px-3 py-1.5 font-mono text-sm font-semibold
  tracking-[0.2em]`) > footer `space-y-6` (error box §1.4, `Button secondary w-full` Retry,
  `Button w-full` Connect).
- Credential forms (Qwen/Cline/Roo/OpenClaw): `space-y-4 text-left`, `space-y-2` Label+Input/
  Select groups, Test(secondary)+Connect `flex-1` pair, `text-[11px] leading-relaxed` footnote.

---

## 5. Motion constants (`lib/motion.ts`, transplant-centralized — values match baseline usage)

`DURATION_INSTANT` (status swaps) · `DURATION_FAST` + `EASE_OUT` (list entrances) ·
`TRANSITION_EXPAND` (collapse) · `STAGGER_DELAY`/`STAGGER_DELAY_CHILDREN` (stagger).
Inline `transition={{ duration: 0.15 }}` in unported files is equivalent, not a violation.

---

## 6. Icons

- Custom SVGs: `IconProps` (`React.SVGProps<SVGSVGElement>`), `viewBox="0 0 24 24"`,
  `fill="currentColor"` (paths), `{...props}` last so `className` sizes them. Sizing is ALWAYS
  via `className` (`h-4 w-4` etc.); no `width/height` attrs (16px defensive defaults on the five
  provider icons are grandfathered but new icons must omit them).
- Lucide sizing: chrome 18 (`strokeWidth 1.5`), rows 12–15 (`1.8–2.2`), glyphs per §3.4.
- Provider logos: `GitHubLogo h-4` in rows; `GitHubAvatar` (64px, `rounded-sm`, `bg-muted`
  placeholder, logo fallback on error; `rounded-full` variant for circular contexts).

---

## 7. Copy & strings

- `...` not `…` (§2). Sentence-case headers/labels except 10px micro-labels (§3.6).
- Destructive verbs: `Archive` (threads/workspaces), `Remove` (projects),
  `Delete draft` (drafts). Confirm copy: `Archive Thread` / `Remove this project?`.
- Tooltips: `Archive`, `Help`, `Settings`, `Reveal in Finder` (all platforms — baseline string),
  `Mark all as read`, `Click to restore`.
- `pluralize(n, "workspace")` for bulk menu items. Compact time: `now/5m/3h/2d/4w/9mo/1y`;
  `formatTimeAgo` for thread rows.
- `aria-label` on every icon-only button; `role="status"` on badge clusters;
  `aria-pressed` on toggle tiles; `aria-expanded` on collapsers; `aria-busy` on refresh.

---

## 8. What is INTENTIONALLY new (ratified, not violations)

- Projects rail (§4.3), All-projects page, usage-stats footer, status buckets, thread hierarchy
  under workspaces, Backends tab, OpenRouter browser, provider login clones, project accent
  colors, dev-server button, `RenderErrorBoundary` generalization, grid-pulse loader,
  `lib/motion.ts` centralization, subtitle plain-text hardening (bugfix + XSS win).
- Batch C drops (accepted): normal footer icon row, Feedback button, Help popover entry point,
  two-line baseline rows (replaced by single-line + status well + meta line, §10 item 3).

---

## 9. Audit method (so the next pass trusts this doc)

Three-way attribution for every hunk: baseline (`git show HEAD:`) vs d3-absorbed
(`git diff FETCH_HEAD`, whitespace-insensitive) vs branch work. d3 hunks preserved baseline
rows/pills/classes verbatim and were absorbed as-is; all §10 items are branch-side deviations
(including transplant-era inventions and this session's pills/tint/banner/copy work).

---

## 10. Branch deviations found → dispositions (the punchlist)

| # | deviation | disposition |
|---|---|---|
| 1 | Greeting block simplified (`new-chat-form.tsx`) | RESTORED to baseline 1638–1645 |
| 2 | Dead pane atoms (`agentsSubChatsSidebarModeAtom/WidthAtom`, stale `"sidebar"`) | REMOVED, migrated to `"tabs"` |
| 3 | Tab pills `rounded-full text-[13px]` foreground washes | RE-MIRRORED to §4.4 (`rounded-md text-sm bg-muted …`) |
| 4 | Sidebar layout tint `bg-white/[0.03]` | REVERTED to `bg-background` |
| 5 | Orange banner wash/border (`/5`, `orange-400`) | ALIGNED to §1.4 (`/10`, `orange-500`) |
| 6 | Floating `-bottom-6` user-bubble copy button | RELOCATED into group overlay row with shared `CopyButton` |
| 7 | `tool-Edit` subtitle HTML spans rendering raw | Subtitle type → `string \| ReactNode`; Edit returns JSX filerow tokens |
| 8 | Sidebar rows: `py-[7px] pl-[22px] rounded-lg /[0.08]` + `duration-150` | RE-SKINNED to §4.1 (`py-1.5 pl-2 pr-2 rounded-md /5 duration-75`) |
| 9 | Row meta line dropped (branch/time/stats) | RESTORED per §4.1 line 2 |
| 10 | Multi-select UI invisible (no checkboxes/toolbar) | RESTORED: `ChatIcon` checkbox cross-fade + footer toolbar swap |
| 11 | Pinning invisible (no menu items, no sections) | RESTORED: context-menu Pin/Unpin + bulk items + per-group Pinned section above buckets |
| 12 | `AgentChatItem`/`ChatIcon`/`ConfirmThreadArchiveDialog`/footer sections dead | DELETED (~1400 lines); hierarchy dialog rebuilt on AlertDialog |
| 13 | Thread hierarchy never rendered | WIRED: expand chevron per workspace row → `WorkspaceSubChats` |
| 14 | Accent tint invisible in sidebar | WIRED: `border-l-2` + tint per existing code, on baseline row shell |
| 15 | Bucket headers `12px semibold /50` | ALIGNED to §3.6 micro-label idiom |
| 16 | Footer labels `9px /50`, quota `orange-400`, tooltips 300ms | ALIGNED (`10px` full muted, `orange-500`, 500ms) |
| 17 | `…` in `probing…`/`Loading…`/placeholders | `...` everywhere |
| 18 | Backends-tab uppercase `tracking-wide semibold` labels | ALIGNED to §3.6 |
| 19 | OpenRouter search well borderless `rounded-md bg-muted/50` | ALIGNED to §3.7 (`rounded-lg bg-muted border-input border`) |
| 20 | `text-sky-500` mark-read + unseen names/dots | `sky` has no baseline precedent → mark-read neutral-muted, unseen dots `#307BD0`, names muted |
| 21 | Rail tile `rgba(255,255,255,0.04)` fallback + `#fff` initial | Theme-token fallback + contrast-safe initial color |
| 22 | Project-card rename input `outline-none` w/o focus affordance | focus-visible ring |
| 23 | Accent swatches lack focus ring + `aria-pressed` | ADDED |
| 24 | Rail `Tooltip` default delay (700ms) | `delayDuration={500}` |
| 25 | `InboxButton`/`AutomationsButton` orphaned (beta nav gone) | RE-RENDERED above list (null when gated off — zero visual change) |
| 26 | Single-line `text-[13/14px]` transplant rows | `text-sm` titles + `text-[11px]` meta per §4.1 |

Items 12–14 note: `SubChatItem`/`WorkspaceSubChats`/`GridPulseSpinner`/expansion state are
KEPT (they become live via item 13); only truly dead code is deleted.
