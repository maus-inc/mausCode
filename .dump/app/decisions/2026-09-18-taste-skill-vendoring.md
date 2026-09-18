# 2026-09-18: the taste-skill set is vendored and added to the mandate

Decision: the 13 skills from `Leonxlnx/taste-skill` join the design set in
`docs/design-skills.md`, and the taste set led by `design-taste-frontend` is
mandatory for any UI or design work. The mandate is written in `AGENTS.md`
(skill routing section and the `design-set` rule row) and in `FULL-REVIEW.md`
section 15, where the taste pre-flight gets its own ledger row. This extends
the 2026-09-16 set; nothing in that set changes, and `DESIGN.md` plus
`docs/design-system-baseline.md` stay the recorded values the skills apply
against.

## What was installed

`npx skills add Leonxlnx/taste-skill -s '*' -a universal --copy -y` at
`e79ca9ec7e071eb3a3b623c4fb752e853fc3ed58` (2026-09-16), 13 skills. Each
directory is upstream content, byte-for-byte, and `skills-lock.json` records a
folder hash per skill, written by the installer.

| Directory | Front-matter name | Source path |
| --- | --- | --- |
| `design-taste-frontend` | `design-taste-frontend` | `skills/taste-skill` |
| `design-taste-frontend-v1` | `design-taste-frontend-v1` | `skills/taste-skill-v1` |
| `gpt-taste` | `gpt-taste` | `skills/gpt-tasteskill` |
| `high-end-visual-design` | `high-end-visual-design` | `skills/soft-skill` |
| `minimalist-ui` | `minimalist-ui` | `skills/minimalist-skill` |
| `industrial-brutalist-ui` | `industrial-brutalist-ui` | `skills/brutalist-skill` |
| `redesign-existing-projects` | `redesign-existing-projects` | `skills/redesign-skill` |
| `stitch-design-taste` | `stitch-design-taste` | `skills/stitch-skill` |
| `image-to-code` | `image-to-code` | `skills/image-to-code-skill` |
| `imagegen-frontend-web` | `imagegen-frontend-web` | `skills/imagegen-frontend-web` |
| `imagegen-frontend-mobile` | `imagegen-frontend-mobile` | `skills/imagegen-frontend-mobile` |
| `brandkit` | `brandkit` | `skills/brandkit` |
| `full-output-enforcement` | `full-output-enforcement` | `skills/output-skill` |

Fidelity check, run at install: a raw clone of the upstream at the commit above
was diffed directory by directory against `.agents/skills/`, all 13 identical,
and the clone was then deleted. `node scripts/ci/verify-skills.mjs` verifies
50 of 50 locked skills.

## What is limited

Same rule as the 2026-09-16 set: the bodies stay, the calls are out of bounds,
and the limits live in `docs/design-skills.md`.

- `imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit`,
  `image-to-code`: image generation only, through whatever image tool the
  environment offers. No key, no prompt, no image leaves the machine. Read for
  composition, section, palette and mockup rules; build the look in HTML and
  CSS.
- `design-taste-frontend` and `gpt-taste`: their section-asset image step and
  the `npm install` and `npx shadcn` of the component libraries they recommend
  are never run to satisfy a skill. A dependency is its own proposal under the
  closed-list rule.
- `stitch-design-taste`: the Stitch MCP Server its body mentions is optional
  upstream and is never connected here. The skill is semantic rules;
  `DESIGN.md` is the recorded baseline.
- The remaining seven ask for nothing executable.

Note for reviewers: this is a different `stitch` skill from the
`google-labs-code/stitch-skills` refused on 2026-09-16. That one declared
`stitch*` MCP tools and `web_fetch` in `allowed-tools` and drove a hosted
service; this one is a rules body, the MCP is optional, and nothing in its
front matter declares a tool.

## What was left out

The upstream `research/` folder (laziness study: root causes, remediation,
findings) is reading material for the skill author, not a skill. It was read
during the review of this install and stays outside the tree.

## Verification

- `node scripts/ci/verify-skills.mjs`: 50 of 50 locked skills verified, 2
  unrecorded project-owned (`find-skills`, `unslop`), same as before.
- Byte-for-byte diff of all 13 directories against the raw upstream clone:
  identical.
- No source file under `src/` is touched, so the typecheck, lint and test
  gates run on an unchanged tree.
