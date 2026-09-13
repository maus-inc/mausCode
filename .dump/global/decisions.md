# Ratified decisions, project-wide

The decisions that constrain every capability, and where the full record lives. A later
change must cite this file, or the record it points at, before reversing anything here.
Nothing on this list is implied by convenience; each was chosen by the human or by an agent
under delegated authority with the reasoning written down.

## Chosen by the human

| Decision | Date | Recorded in | Effect |
| --- | --- | --- | --- |
| Display name `mausCode`, company `maus-inc`, CLI `mauscode`, data dir `.mauscode`, scheme `mauscode` | 2026-09-11 | `rebrand/decisions/open-decisions.md` D1, `rebrand/decisions/naming-system.md` | Identity constants in `src/shared/app-identity.ts`; no other product name in user-visible strings |
| Public runtime name `mausCode Runtime`, daemon `mausCode Node` | 2026-09-11 | `rebrand/decisions/open-decisions.md` D2 | JCode appears only in `UPSTREAM.md` and `NOTICE` |
| Legacy 1Code paths are read-only detection, never written, never migrated | 2026-09-11 | `rebrand/decisions/open-decisions.md` D3 | `src/shared/worktree-paths.ts`, `src/main/lib/claude-config.ts` |
| Local-only by default, control plane and update feed by build-time env, empty means off | 2026-09-11 | `rebrand/decisions/open-decisions.md` D4 | `MAIN_VITE_API_URL`, `MAIN_VITE_UPDATE_FEED_URL`; `src/main/lib/auto-updater.ts` |
| External CLIs are grouped as compatibility agents | 2026-09-11 | `rebrand/decisions/open-decisions.md` D5 | Future picker and settings copy |
| Version line restarts at `0.1.0` | 2026-09-11 | `rebrand/decisions/open-decisions.md` D6 | Decided and **not applied on `arena/01a097c4-mauscode`**, where `package.json` still reads `mauscode` `0.0.72`. Enforced by roadmap step 31 |
| Five modes, Plan, Ask, Edit, Agent, Turbo, model-agnostic | 2026-09-11 | `app/decisions/user-decisions-2026-09-11.md` | Mode taxonomy across atoms, input, routers |
| T3 adoption, contracts phase plus server evaluation spike | 2026-09-11 | `app/decisions/user-decisions-2026-09-11.md`, `app/decisions/effect-adoption-t3-layers-2026-09-11.md` | `src/shared/contracts/` verbatim plus `effect` pinned exact, isolated to that tree |
| Local-only guard is an opt-in setting, default off | 2026-09-11 | `app/decisions/user-decisions-2026-09-11.md` | `src/shared/local-only.ts` |
| JCode vendored as a copied tree with `UPSTREAM.md`, pinned SHA and patch list | 2026-09-11 | `app/decisions/provisional-assumptions.md` PA-3, ratified same day | `runtime/jcode/` |
| Lint policy: fix every finding, tests included, no exemptions, no suppressions, do not re-ask | 2026-09-12 | `app/plans/2026-09-12-jules-port-plan.md` §6.1 | Closed at 0 findings, all rules at `error` |
| No CLI product, `--parallel` escalated to sub-chat orchestration, repo inference redirected to sidebar state detection | 2026-09-12 | `app/decisions/2026-09-12-jules-feature-triage.md` rows 19-24 | Waves W3 and W6 instead of a CLI surface |
| Memory and instruction loading are a deep port of hermes-agent logic, automatic and performance-positive | 2026-09-12 | `app/decisions/2026-09-12-jules-feature-triage.md` rows 31-32 | Wave W10, steps 23 and 24 |
| MCP management follows our own UX standard, not the upstream paste-a-key panel | 2026-09-12 | `app/decisions/2026-09-12-jules-feature-triage.md` row 47 | Wave W13, step 28 |
| Every feature item from the inherited changelog got its own question and recorded verdict | 2026-09-12 | `app/decisions/2026-09-12-jules-feature-triage.md` | 54 verdicts, waves W1-W14 |
| `ken-jo`'s built-in sign-in removal is adopted, its diff is not | 2026-09-13 | the human, reversing the Category D rejection in `ci/research/fork-network-harvest-catalog.md` | Roadmap step 45, which must still ask the scope question before deleting anything |
| `find-skills` runs before every roadmap step, and installed skills are project memory | 2026-09-13 | the human, `AGENTS.md` skill routing, `.agents/skills/find-skills/SKILL.md` fetched from `vercel-labs/skills` | Every issue body carries the rule, and a skill may never widen an approval |
| The self-improvement loop follows the agentskills.io skill format and hermes' disclosure model | 2026-09-13 | `app/research/2026-09-13-self-improvement-loop.md`, sources listed there | Steps 24, 43 and 44; `name` and `description` are validated at write time, and a skill body loads on trigger only |

## Chosen by an agent under delegated authority

| Decision | Where | Reason in one line |
| --- | --- | --- |
| Port upstream verbatim with attribution, or do not port it | `docs/backend-porting-recipe.md` §0 | A silent rewrite loses the ability to re-port and to credit |
| Capability profile decides what the UI offers; a backend that cannot report a capability must not have it | `app/decisions/provider-agnostic-backends-upstream-policy-2026-09-11.md` | No silent special powers |
| Credentials are references, stored only via `src/main/auth-store.ts` and `safeStorage` | Same file, plus `AGENTS.md` | One owner, one encryption path |
| Held credential instead of writing a provider's own config file, for qwen, cline and openclaw | `app/decisions/{qwen,cline,openclaw}-provider-adoption-2026-09-11.md` | Those CLIs store keys in plaintext; the user's files stay untouched |
| Ratchet the inherited debt, never fake green | `ci/plans/initial-ci-plan.md`, `ci/decisions/2026-09-11-lint-gate-and-format-sweep.md` | A gate that fails on debt nobody created trains people to ignore CI |
| Vendored contracts are vocabulary until used, adopt per use | `app/decisions/effect-adoption-t3-layers-2026-09-11.md` and step 13 of the roadmap | 24,860 lines with zero importers is not a live path |
| OpenSpec changes are scaffolded by hand, validated where the CLI exists | `app/decisions/2026-09-11-openspec-cli.md` | The CLI is unobtainable from verified sources |

## Deliberately rejected

| Rejected | Why |
| --- | --- |
| Blanket replacement of every `21st` or `1code` string | Breaks legacy worktree detection, attribution comments and a file-format enum |
| Auto-migrating 1Code data on first launch | Moving live worktrees with uncommitted changes is a data-integrity decision needing its own design |
| `npm overrides` to fix the renderer build | The failure was dependency drift in a sandbox, not a code bug |
| Four-host pull request provider registry | We are GitHub-only through `gh`; four providers is four maintenance surfaces |
| Wholesale merges from any fork, and every fork's deletions | Their removals are exactly what the human asked to keep away |
| A pirate persona day feature | Asked and declined |
| Wholesale replacement of the credential and OAuth plumbing on the strength of the auth-removal decision | Provider credentials and MCP OAuth are not the app account; step 45 keeps `auth-store.ts`, `auth-manager.ts` and the loopback callback server that MCP auth depends on |
| A persistent psychological model of the user, which upstream implements with Honcho | Needs its own consent conversation, held at `questions.md` item 17 |
