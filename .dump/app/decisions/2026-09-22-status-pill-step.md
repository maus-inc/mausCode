# Decision: status pill text step (light 700, dark 400)

Date: 2026-09-22. Status: accepted by the human in session; the docs changed in the same commit.

## Finding

The settings status pill draws its 12px label on a 10 percent wash of its own hue. Measured
against that wash in light mode, the recorded 500 step fails the 4.5:1 floor for small text.
Figures are computed from the token values by compositing the wash over the page ground
(`--background: 0 0% 100%`) and applying the WCAG relative-luminance formula; no browser exists
in this environment, so this is a computation, not a rendered check.

| Tone | 500 step, light | 700 step, light | 400 step, dark |
| --- | --- | --- | --- |
| ok, emerald | 2.31:1 | 4.99:1 | 9.24:1 |
| warn, amber | 1.99:1 | 4.65:1 | 10.48:1 |
| bad, red | 3.29:1 | 5.66:1 | 6.67:1 |
| mute | 4.36:1 (`muted-foreground` on the foreground wash) | 5.09:1 (`text-foreground/60`) | 6.81:1 |

`DESIGN.md` and `docs/design-system-baseline.md` section 3.5 both recorded the 500 step, so this
was a conflict between two normative records and the accessibility gate, not a local slip. Three
older pills elsewhere in the app use the 600 step (emerald 3.43:1, amber 2.95:1, red 4.23:1),
which also misses the floor.

## Decision

The human chose the 700 step in light mode with the 400 step in dark, keeping the recorded pill
shape, the 10 percent wash and the tone meanings. The mute tone moved to `text-foreground/60`.

Changed in this commit:

- `src/renderer/components/ui/status-pill.tsx`, all four tones.
- `src/renderer/components/dialogs/settings-tabs/agents-credential-storage-tab.tsx`, the keyring
  tile icons (emerald-700, amber-700), because the amber icon measured 2.95:1 on its own tile.
- `DESIGN.md` and `docs/design-system-baseline.md` section 3.5, which now record the step.

## Consequence

The two older 600-step pills on a `/10` wash (`all-projects-page.tsx:96` at 11px and
`agent-diff-view.tsx:142`) sit outside this PR's diff and still miss the floor. They need their
own pass. Leaving them is a recorded gap, not agreement.
