# UI design refinement pass, the changed surfaces (2026-09-22)

## What this pass is

The human asked for deep multi-pass refinement of every changed or new UI surface in PR
#68, under the mandate in `docs/design-skills.md`. This is refinement against the records,
not a redesign. `DESIGN.md` and `docs/design-system-baseline.md` stay normative, and the
incumbent identity, behavior and copy stay unless a recorded value is violated.

Audited base `8a77cb2a70d9f6a55bea9d822ef87b6641f2d79b`, head `3d4b0b4` plus the edits below.
The eleven changed UI files are the whole scope.

## Sources loaded, and what could not run

Read: `docs/design-skills.md`, `DESIGN.md`, `docs/design-system-baseline.md` (sections
3.5 to 3.10, 4.6, 4.7, 5 to 10), `.agents/skills/impeccable/SKILL.md` with
`reference/craft-floor.md`, `reference/routing.md` and the routed `reference/polish.md`,
`antislop` core, `antislop-ui`, `antislop-human`, `antislop-copywriting`,
`antislop-layoutmobile`, `design-taste-frontend`, `redesign-existing-projects`,
`ui-ux-pro-max` with seven offline searches, `product-design`, `ui-design`,
`emil-design-eng`, `unslop`, and `find-skills` for routing only.

Refused, per the execution limits in `docs/design-skills.md`: the impeccable launcher
(`context`, `signals`, `detect`, `critique-storage`), every skill installer and its network
command, and every remote image tool. No browser, Playwright or ffmpeg exists in this
environment, so no screenshot, browser probe or rendered check ran.
`decisions/2026-09-22-design-pass-skill-limits.md` records what each refusal costs.

Dials. They are inherited from the incumbent system rather than chosen per surface, because
`DESIGN.md` fixes flat by default, one accent (`#0033ff`), the `/5` and `/10` wash scale and
motion only from `src/renderer/lib/motion.ts`. The settings page is a quiet surface inside a
desktop app, so this pass kept ENERGY 2, RHYTHM 2, MOTION 1 and changed no motion value.

## Delivery Gate

| Gate | Result | Evidence |
| --- | --- | --- |
| antislop Delivery Gate, rule ids | Pass after the fixes below | Block 1: no em dash left in a user-visible string or a comment in the changed files (R-02, checked by `grep -P` for U+2014); no contrast below 4.5:1 for the pairs this pass controls (R-25, computed figures in the table below); loading, error and empty states all present (R-27); keyboard reachability comes from the shared Radix primitives and native controls (R-32); no fabricated claim, and the page states only what the main process answered (R-36, R-38). Blocks 2 and 4: no gradient, glow, shadow, capsule badge, template icon, pill-shaped-everything or generic CTA in the changed files (R-01, R-04, R-09, R-12, R-13, R-15, R-16, R-11); the accent count and the radius set are unchanged (R-29, R-31). The R-35 answer is in "Not verified" below |
| Baseline mirror check | Pass | The pill is one implementation used by two pages (baseline section 3.5 plus the `DESIGN.md` badge paragraph); the tab root, header, card shell, `p-4` rows, `divide-y` row list, `size="sm"` outline button with an `h-4 w-4 mr-2` icon, and the shared `AlertDialog` all match the sibling tabs. The inline error moved to the recorded destructive-text pair `text-red-600 dark:text-red-400` (`DESIGN.md` line 271) |
| unslop copy pass | Pass | Every string in the changed files was read against `.agents/skills/unslop/SKILL.md` and the copywriting checklist. Three user-visible em dashes and one `…` character were removed, two vague strings were rewritten (below), and no new string names a fact the app has not checked |
| Motion check | Pass | No new motion. The only animations are the incumbent `animate-spin` on `RefreshCw` and `Loader2`, matching the debug tab's Reload button, and the transition classes already in the sidebar row. Nothing was added from outside `src/renderer/lib/motion.ts` |
| Accessibility pass | Pass for what source can show | The headline is an `<output>`, whose implicit status role announces a state change and which cleared SonarCloud S6819; the refresh button carries `aria-busy` next to its `disabled`; the switch keeps its `label for` and `aria-describedby` pair; the confirm stays on the shared Radix `AlertDialog`, which supplies focus trap, `Esc` and focus restore; every icon-only or text control keeps a text label |
| Skill report | This file | Findings, measurements, decisions and the accepted record change are below |

An outside check agrees with the pass. The `Buoy Design Review` check on `d099125` answers
"No actionable design drift", and `Socket Security` reports no net dependency change. Buoy is
a third-party reviewer, so it is a second opinion, not the gate.

## Findings and changes

| Location | Rule | Consequence before | Smallest fix | Priority |
| --- | --- | --- | --- | --- |
| `ui/status-pill.tsx`, all four tones | R-25, baseline 3.5 | 12px text on its own `/10` wash measured 2.31, 1.99 and 3.29:1 in light mode, below the 4.5:1 floor | Text step to 700 light and 400 dark, mute to `text-foreground/60` | P0 |
| `agents-credential-storage-tab.tsx`, root and header | baseline 3.5 to 3.7 | The page had no padding of its own inside the shell's `max-w-2xl` wrapper and a tighter header than its siblings | Root `p-6 space-y-6`, header `flex flex-col space-y-1.5 text-center sm:text-left` | P2 |
| Same file, keyring tile icons | R-25 | The amber icon measured 2.95:1 on the amber wash | `text-emerald-700` and `text-amber-700`, matching the pill step | P1 |
| Same file, inline error | baseline 3.4 | `text-destructive` is the recorded error-box text, not the inline-text pair, and sits below the floor on white | `text-red-600 dark:text-red-400` | P1 |
| Same file, headline | R-32 adjacent | A state change was silent to assistive technology | `<output>` on the headline, which carries the implicit status role. The explicit attribute was tried first and SonarCloud S6819 flagged it in favor of the element | P2 |
| Same file, refresh button | R-27 | Fetching was visible only through the spinning icon and `disabled` | `aria-busy={status.isFetching}` | P3 |
| Same file, three flex rows | R-03 | A long foreign string in a detail line could not shrink, so the `overflow-hidden` card would clip it at the 500px minimum window width | `min-w-0` on the text column, `shrink-0` on the icon tile, `break-words` on the detail spans | P1 |
| Same file, inventory rows | R-36 | The detail came from cached data under a pill that said "Unknown", and the store row's pill said "Nothing saved" while the page said it could not read the store | `browserRow` in the state module, and the unknown gate first for the sign-in and provider rows | P1 |
| Same file, store row label | unslop | The row was labelled "Browser storage" while its pill and detail reported the app's own store | Label `App credential store`, pill `Saved here` | P2 |
| `credential-storage-state.ts` | DRY | The store row's sentence and pill were assembled in JSX, where only a running app could exercise them | `browserRow` returns both, and the module now has 18 tests | P2 |
| `agents-backends-tab.tsx` | R-02, R-25 | An em dash was the empty-list placeholder, `Loading backends…` broke the `...` rule, and an error line used `text-red-500` at 3.76:1 | `none`, `...`, `text-red-600 dark:text-red-400` | P1 |
| `agents-models-tab.tsx` | R-02, unslop | Two user-visible em dashes, "saved by the app" where the store has a name, and a restore toast that told the user to "Check it again" without saying what to check | Commas and one conjunction, `saved in this app's store`, "The OpenAI API key could not be put back. Try saving it again." | P2 |
| `settings-sidebar.tsx` | R-04 | The new tab's icon alias claimed a filled icon for an outline one, in a file whose other icons are custom filled SVGs | Alias `KeyRound as KeyIcon`. The sidebar already mixes lucide outline and custom filled icons through `ServerIcon` | P3 |
| `settings-content.tsx`, `use-codex-login-flow.ts`, `lib/atoms/index.ts`, `renderer-secrets.ts` | none | No recorded value or rule violated | Left unchanged | none |

## Measured contrast

Computed, not rendered. Each wash is composited over the page ground the token records
(`--background: 0 0% 100%` light, `240 10% 3.9%` dark) and scored with the WCAG relative
luminance formula. `antislop-human/contrast-check.py` was run over the same pairs and agreed.

| Pair | Light | Dark | Verdict |
| --- | --- | --- | --- |
| 500 step on its `/10` wash, before | 2.31 / 1.99 / 3.29 | not the failing side | Fail in light |
| 600 step, the precedent in the two other washed pills | 3.43 / 2.95 / 4.23 | pass | Fail |
| 700 light, 400 dark, chosen | 4.99 / 4.65 / 5.66 | 9.24 / 10.48 / 6.67 | Pass |
| Mute, `text-foreground/60` | 5.09 | 6.81 | Pass |
| Keyring icon on its own tile | 4.99 emerald, 4.65 amber | pass | Pass, above the 3:1 non-text floor |
| Inline error `text-red-600` on white, and `dark:text-red-400` | 4.83 | pass | Pass |

## Accepted record change

`DESIGN.md` line 274 and `docs/design-system-baseline.md` section 3.5 recorded the pill's
solid-500 text. The human chose the 700 light and 400 dark steps over the record after the
four measured options were put to them, and both files now record the step that clears the
floor. `decisions/2026-09-22-status-pill-step.md` holds the measurement, the decision and the
consequence. Two older pills outside this PR's diff still use the 600 step on a `/10` wash,
`all-projects-page.tsx:96` at 11px and `agent-diff-view.tsx:142`, and `decisions/2026-09-22-status-pill-step.md`
records them as a gap for their own pass. The 600 step in plain text without a wash, as in
`agent-diff-view.tsx:726` to `745`, follows the recorded destructive-text pair and is correct.

## A recorded gap this pass measured

The baseline records the error box as `border-destructive/20 bg-destructive/10 text-destructive`
and the token is `0 84.2% 60.2%`, which is about 3.4 to 1 on that wash at `text-xs`, below the
4.5 floor. Nine login components use that box, all outside this PR's diff, and the same tone on
a plain surface measures 3.79 to 1. The pass did not change them, because a recorded value is
not this PR's to move without the same kind of decision the pill step got. The gap is recorded
here so the next pass or the human can decide it.

## Not verified here

- No rendered check ran. Every layout claim is source-level, and the accessibility pass
  could not confirm a visible focus ring, a focus trap at runtime, or dark mode rendering.
  Any rule whose detection needs a rendered surface stays `unknown` with reason
  `no-rendered-check`, never a pass.
- R-35 asks for a recorded click-through. The app was not launched: this sandbox has no
  display and no browser. The window's minimum width is 500 px (`src/main/windows/main.ts:814`),
  which is what makes the `sm:` and `min-w-0` work above load-bearing rather than theoretical.
- Tap targets stay at the recorded `size="sm"` (32 px) because every settings action button
  in the app uses it. Changing that is an app-wide decision, not this page's.
