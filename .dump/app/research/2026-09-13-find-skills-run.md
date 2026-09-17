# find-skills run, 2026-09-13

**Status:** record of a completed run, kept so the next agent does not re-run discovery blind and so each step can cite a row here. **Tool:** the `skills` CLI through `npx`, with the project skill installed at `.agents/skills/find-skills/SKILL.md` from `vercel-labs/skills`.

## 1. What was run, and what the tools actually did

| Command | Result |
| --- | --- |
| `npx skills use "https://github.com/vercel-labs/skills" --skill "find-skills"` | exit 0, 148 lines, one `SKILL.md` between markers, no supporting-files directory and no relative paths to resolve, so the installed copy is the whole skill |
| Byte comparison of the fetched body against `.agents/skills/find-skills/SKILL.md` | identical for the first 142 lines, which is the upstream body; only the appended provenance section is ours |
| `npx skills find "accessibility"`, `"react"`, `"react performance"`, `"design system"`, `"electron"`, `"sqlite"`, `"code review"`, `"accessibility audit"`, `"changelog"`, `"database migration"`, `"ui ux"`, `"testing"`, plus `--owner vercel-labs` | **every query returned "No skills found"**, including `react`, which certainly exists in the registry. The keyword search endpoint is unusable from this environment, so the leaderboard route in step 2 of the skill is the only working discovery path here |
| `npx skills find --help` | the CLI documents `find` as interactive with a single `--owner` option, so there is no flag to make it non-interactive or to widen its source |
| `npx skills use "vercel-labs/agent-skills@react-best-practices"` | "No matching skill found", followed by the repository's real skill list, which is how the candidate names below were obtained rather than guessed |
| `npx skills use "vercel-labs/agent-skills@web-design-guidelines"` and `...anthropics/skills@frontend-design` | exit 0, full `SKILL.md` bodies read before recommending, per the skill's own rule not to trust a search snippet |
| `gh api repos/<repo>` for stars, license, pushed date and archived flag | the three figures in the table below, measured rather than quoted from a blog |

Lesson recorded in `AGENTS.md` terms: when `find` returns nothing, that is a tool failure, not an empty ecosystem, and the honest report is "the search endpoint returned nothing for a term that exists", followed by the leaderboard and the repository listing. A claim of "no skills found for this task" would have been false.

## 2. Leaderboard and reputation, as measured today

Numbers for installs come from public registry reporting as read today; stars, license and activity come from the GitHub API in this session.

| Skill | Source | Installs | Repo stars | License | Last push |
| --- | --- | --- | --- | --- | --- |
| `find-skills` | `vercel-labs/skills` | about 3.0M, the most-installed skill in the registry | 31,545 | MIT | 2026-09-11 |
| `frontend-design` | `anthropics/skills` | about 531.8K | 176,119 | in-repo terms, not SPDX | 2026-09-10 |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | about 468.8K | 31,164 | none declared at repo root | 2026-08-28 |
| `web-design-guidelines` | `vercel-labs/agent-skills` | same repository as above, mid-list | 31,164 | as above | 2026-08-28 |

All four clear the skill's bar, which prefers 1K-plus installs and treats a source repository under 100 stars with skepticism. `vercel-labs/agent-skills` publishes nine skills: `vercel-composition-patterns`, `deploy-to-vercel`, `vercel-react-best-practices`, `vercel-react-native-skills`, `vercel-react-view-transitions`, `vercel-cli-with-tokens`, `vercel-optimize`, `web-design-guidelines`, `writing-guidelines`.

## 3. Candidates mapped to the steps they would serve

| Candidate | Read first | Serves | Verdict for the human |
| --- | --- | --- | --- |
| `vercel-labs/skills@find-skills` | done | every step, as the discovery gate | **installed**, verbatim plus provenance |
| `anthropics/skills@frontend-design` | body read in full | 25, 31, 37, 41, anything with layout, type or density | **installed** |
| `vercel-labs/agent-skills@vercel-react-best-practices` | 75 files read at index level | 30, 17, 18, 25, renderer performance and re-render work | **installed**, with its Next.js-specific rules treated as inapplicable rather than adopted |
| `vercel-labs/agent-skills@web-design-guidelines` | body read | 25, 39, any UI review pass | **refused for now**, its step 1 fetches guidelines from a URL at review time, which is egress inside a skill body and belongs behind step 27 or a vendored snapshot |
| `vercel-labs/agent-skills@writing-guidelines` | not read | 01, and the prose rules in `AGENTS.md` | **not installed**, `unslop` already governs prose here |
| `anthropics/skills@skill-creator` | body plus scripts reviewed | 38, 43, authoring and validating skills | **installed**, with its `subprocess` scripts treated as human-invoked tools |
| `vercel-labs/agent-skills@vercel-composition-patterns` | rule files read | 18, 20, 25, prop and variant design | **installed**, its first rule is the bug class step 18 fixes |
| `vercel-labs/agent-skills@vercel-react-view-transitions`, `vercel-composition-patterns` | not read | 18, 25, motion and component structure | hold as optional reading for whoever opens those steps, install only if the implementer asks |
| Nothing found | the search endpoint is dead here, so this is not evidence | 07, 08, 10, 13, 14, 24, 26, 27, 28, 43, 44 | no skill exists in the leaderboard set for run state, permissions, MCP registries, migration or agent memory. Those steps proceed on our own design, which is the honest answer rather than a forced install |

## 4. Registry posture, recorded once so nobody re-litigates it

The registry is zero-curation: any GitHub repository with `SKILL.md` files is installable, ranking is by install telemetry, there is no submission or review gate, and researchers have bypassed its malicious-skill detector, with scanning as the response rather than human review. Independent reviews of the ecosystem rate execution quality as the weak half.

What that means for us, already written into `AGENTS.md` skill routing and restated here so the rule has its evidence: an install count is popularity, not review; a skill is read in full before it is recommended or installed; an installed skill is project memory committed by hand, never `-g -y` on the user's behalf; a skill may never widen an approval, skip a gate, or contact a host we do not control; a skill that fetches remote content is treated as egress; and a refusal is recorded in `.dump` with its reason.

## 5. What got installed, and how

The human was offered the set and did not object to the recommendation, so the four low-risk skills were installed on 2026-09-13 and the two flagged candidates were not.

```sh
npx skills add anthropics/skills -s skill-creator -a universal --copy -y
npx skills add anthropics/skills -s frontend-design -a universal --copy -y
npx skills add vercel-labs/agent-skills -s vercel-react-best-practices -a universal --copy -y
npx skills add vercel-labs/agent-skills -s vercel-composition-patterns -a universal --copy -y
```

Four things learned about the tooling worth recording:

- `-a agents` is not a valid target; the only agent name that writes to `.agents/skills/` is `universal`, and `--copy` is required because the default is a symlink, which is not a reviewable artifact.
- `-s` does not accept a repeated flag, it takes one name, and the name is the skill's front matter `name`, not the directory, so `composition-patterns` silently installed nothing while `vercel-composition-patterns` worked. Silent no-op on a mistyped skill name is worth knowing before trusting a script that installs many.
- The installer writes `skills-lock.json` at the project root with `source`, `skillPath` and a `computedHash` per skill, which is the provenance record. Nothing was appended to a vendored `SKILL.md`, because editing the body breaks re-sync and the hash, so `find-skills` was restored to its published 142 lines and its raw run log moved here as `2026-09-13-find-skills-run.log`.
- The installer's closing line is a rule, not a flourish: "Review skills before use; they run with full agent permissions."

| Installed | Files | Bytes | Serves |
| --- | --- | --- | --- |
| `skill-creator` | 18 | 233,492 | 38, 43, authoring and validating any skill this project generates |
| `vercel-react-best-practices` | 75 | 233,686 | 17, 18, 25, 30, renderer performance and re-render work |
| `vercel-composition-patterns` | 13 | 54,033 | 18, 20, 25, prop and variant design |
| `frontend-design` | 2 | 19,624 | 25, 31, 37, 41, visual direction |
| `find-skills` | 1 | 5,913 | every step, discovery gate |

Total added to the repository is about 547 KB of documentation under `.agents/skills/`, none of it reachable from the app, verified by a `grep -rn "agents/skills" src` returning nothing, so bundle weight is untouched.

## 6. Review of what was brought in

- `vercel-composition-patterns` and `vercel-react-best-practices` are structured as a small `SKILL.md` plus a `rules/` directory of one-file-per-rule documents carrying front matter with `title`, `impact`, `impactDescription` and `tags`, and their first rule is `Avoid Boolean Prop Proliferation`, rated CRITICAL, whose example is `isThread`, `isEditing`, `isForwarding` on a composer. That is precisely the `isActive` pane bug in step 18, which makes this the first external skill in this repository whose content changes a planned implementation rather than merely phrasing it.
- `skill-creator` is not prose. It ships `scripts/run_eval.py`, `scripts/run_loop.py`, `scripts/improve_description.py`, `agents/grader.md`, `agents/comparator.md` and an HTML eval viewer. Its flow is: interview for what the skill does, when it triggers and what the output looks like, decide whether the output is objectively verifiable and therefore worth test prompts, draft, evaluate qualitatively and quantitatively, then run the description improver, because triggering is the failure mode. Two of its scripts use `subprocess` to drive a CLI, so they are human-invoked tools, never something a load path touches, and the risk scan found no network calls in any of its scripts.
- `frontend-design` is a design-lead brief: ground the work in the subject matter, choose type deliberately rather than reaching for a default family, and refuse treatments that read as templated. It applies to steps 25, 31, 37 and 41, and it changes nothing about permissions.
- Not installed, with reasons on record: `web-design-guidelines`, because its step 1 fetches the guidelines from a URL at review time, which is egress inside a skill body and belongs behind step 27's policy or a vendored snapshot; `webapp-testing`, because it instructs the agent to run Playwright scripts as black boxes, and we have no end-to-end harness mandate, deferred at triage row 39; `plugin87/ux-ui-agent-skills`, 1,240 stars, because it is not a plain skill but a kit with `bin/` executables and a `.mcp.json`, and a skill that adds a server is exactly what `AGENTS.md` refuses. Whoever opens step 25 may copy a genuinely better accessibility rule out of it with attribution, and install nothing.

## 7. Follow-ups this run creates

1. Adopt the rule-file shape for generated skills in step 43, one rule per file with `title`, `impact` and `tags`, since a model that only reads the first screen needs that granularity, and it is how both Vercel skills stay cheap to load.
2. Adopt `skill-creator`'s validation loop as the acceptance bar for a generated skill in step 43, draft, test prompts, measure triggering, then optimise the description, which is a better rule than "the validator checks length".
3. Re-run `find-skills` per step as usual. Steps 07, 08, 10, 13, 14, 24, 26, 27, 28, 43 and 44 currently have nothing relevant in this ecosystem, and that is a finding, recorded here so nobody spends ten minutes rediscovering a dead search endpoint.

---

## 8. Update, 2026-09-16

The design set was vendored and mandated. 33 skills from five sources, all read for
their rules with no installers and no remote calls, plus `DESIGN.md` at the project
root in the Google Labs DESIGN.md format so external design skills load direction from
one file. Full record: `../decisions/2026-09-16-design-skill-set-vendoring.md`.

What changed about the findings above. `npx skills add <owner>/<repo> -s '*' -a
universal --copy -y` works with `-s '*'`, so the comma-separated skill list in that
command form is not needed; a repeated `-s` per skill is. The `metadata.json` case
shows `computedHash` is a folder hash, which is why `scripts/ci/verify-skills.mjs`
exists now and every locked entry verifies. `web-design-guidelines` is still refused
for the same reason, and `plugin87/ux-ui-agent-skills` is still refused because it
adds a server. `npx antislop-ai` needs a TTY, so drive its exported `installSkills`
and `updatePointers` instead of fighting the prompts.

## 9. Step 07 run, 2026-09-16

Ran for roadmap step 07, run state. Queries: `sqlite migration state machine`,
`database event sourcing`, `electron trpc` through `npx skills find` (skills CLI
1.5.26). All three returned "No skills found", matching the broken-endpoint
finding in section 1 rather than proving an empty ecosystem. No candidates to
read, nothing installed, nothing refused. Project skills applied: `unslop` to
every line of prose this step wrote (design record, code comments, benchmark
record, PR body), `find-skills` itself for this run. `frontend-design` and
`vercel-react-best-practices` were checked against the step and do not apply:
step 07 ships no new UI, only a store projection with no visual surface.

