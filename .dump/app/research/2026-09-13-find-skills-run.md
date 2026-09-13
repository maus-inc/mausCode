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
| `anthropics/skills@frontend-design` | body read in full | 25, 31, 37, 41, anything with layout, type or density; its core instruction is deliberate choices that do not read as templated defaults, and it names the rejected-proposal failure we keep hitting | **recommend installing**, it is prose-only and cannot widen anything |
| `vercel-labs/agent-skills@vercel-react-best-practices` | listed, not yet read | 30, 17, 18, 25, the renderer perf and re-render work | **recommend after reading**, needs a check that its Next.js assumptions do not smuggle a framework rule into an Electron renderer |
| `vercel-labs/agent-skills@web-design-guidelines` | body read | 25, 39, any UI review pass, it audits against the Web Interface Guidelines | **recommend only with a change**: its step 1 fetches the latest guidelines from a remote URL at review time, which is a network call from a skill body, so it needs the egress treatment from step 27 or a vendored snapshot |
| `vercel-labs/agent-skills@writing-guidelines` | not read | 01, and the prose rules in `AGENTS.md` | hold; `unslop` already covers this ground here |
| `vercel-labs/agent-skills@vercel-react-view-transitions`, `vercel-composition-patterns` | not read | 18, 25, motion and component structure | hold as optional reading for whoever opens those steps, install only if the implementer asks |
| Nothing found | the search endpoint is dead here, so this is not evidence | 07, 08, 10, 13, 14, 24, 26, 27, 28, 43, 44 | no skill exists in the leaderboard set for run state, permissions, MCP registries, migration or agent memory. Those steps proceed on our own design, which is the honest answer rather than a forced install |

## 4. Registry posture, recorded once so nobody re-litigates it

The registry is zero-curation: any GitHub repository with `SKILL.md` files is installable, ranking is by install telemetry, there is no submission or review gate, and researchers have bypassed its malicious-skill detector, with scanning as the response rather than human review. Independent reviews of the ecosystem rate execution quality as the weak half.

What that means for us, already written into `AGENTS.md` skill routing and restated here so the rule has its evidence: an install count is popularity, not review; a skill is read in full before it is recommended or installed; an installed skill is project memory committed by hand, never `-g -y` on the user's behalf; a skill may never widen an approval, skip a gate, or contact a host we do not control; a skill that fetches remote content is treated as egress; and a refusal is recorded in `.dump` with its reason.

## 5. Install commands, for the human's call

Nothing was installed beyond `find-skills` itself, which the human requested. On approval:

```sh
npx skills add anthropics/skills@frontend-design
npx skills add vercel-labs/agent-skills@vercel-react-best-practices
npx skills add vercel-labs/agent-skills@web-design-guidelines
npx skills list
npx skills update
```

The files land in the agent's skills directory for this project, which here is `.agents/skills/<name>/SKILL.md`. Two extra steps the skill does not require but this repository does: append the provenance line naming the source and fetch date, and commit the copy by hand so a review can see what the agent was taught.
