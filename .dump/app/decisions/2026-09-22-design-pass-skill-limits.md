# Decision: design skills this pass could not run, and what it read instead

Date: 2026-09-22. Status: accepted, environment-limited.

## Finding

`docs/design-skills.md` names three execution limits that bind any design pass in this repository.

- impeccable's launcher is never run here. `scripts/impeccable context`, `signals`, `detect` and
  `critique-storage` are refused, so there is no captured context, no signal JSON and no critique
  snapshot to close at the end of the pass.
- Skill installers and their network commands are refused, which includes `find-skills` running
  `npx skills find`.
- Browser probes and screenshots need a browser, Playwright or ffmpeg. None is installed.

## Decision

Read the skills directly and record what each refusal costs.

- Read `impeccable/SKILL.md` plus `reference/craft-floor.md`, `reference/routing.md` and the
  routed playbook `reference/polish.md`, which is the refine-existing-surface route.
- Read `find-skills/SKILL.md` for routing only; its CLI search did not run.
- For every contrast figure, composite the wash over the exact token ground and apply the WCAG
  formula, then label the result computed rather than rendered. `antislop-human/contrast-check.py`
  was used to confirm the same pairs independently.
- Verify layout, states, focus, copy and motion from source, and say in the report which checks
  stayed unverified for want of a rendered surface.

## Consequence

No rendered check exists for the changed settings surfaces. Optical questions, and any check with
`detect: rendered` in the rule set, stay `unknown` with reason `no-rendered-check` rather than
passing or failing. The human sees the pass as source evidence plus computed measurements, and a
later session with a browser should re-run the rendered checks before the CTA is called finished.
