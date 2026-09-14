## 0. Meta

| Field | Value |
| --- | --- |
| Step | 01 of 45, wave W0, parity P0-4 |
| Area | docs |
| Risk | medium |
| Depends on | nothing |
| Blocks | {{S04}}, {{S07}}, {{S19}}, {{S23}}, {{S24}} |
| Estimate | small |

## 1. Outcome

`AGENTS.md`, `CLAUDE.md`, `openspec/project.md` and both copies of the system map describe the tree that exists: every router, the five modes, the SDK name, the directories that are real. A new agent can pick a path out of a document and find it.

## 2. Why it matters

Every later step quotes these documents. A wrong path costs an agent a read cycle, and a wrong capability claim costs a design decision: an agent that believes there are two modes will not design a five-mode UI. This is why the plan made instruction truth a prerequisite wave rather than a footnote.

## 3. Evidence

| Fact | Path | Level | Measured |
| --- | --- | --- | --- |
| The plan records `CLAUDE.md` documenting 3 of 36 routers, two modes instead of five, a wrong SDK name and a non-existent `src/renderer/features/sub-chats/` | `.dump/app/plans/2026-09-12-jules-port-plan.md` §5 F-findings, W0 | E2, recorded at `1a37e0b` | re-measure each claim before editing |
| `.dump` corpus claims `mock-api.ts` should be deleted while the system map says keep it, because six renderer files import it | `.dump/app/research/current-system-map.md` §18 vs `.dump/app/plans/mauscode-architecture-plan.md` P0 | E1 contradiction on the record | resolve in favour of the tree, then re-check with `grep -rln "mock-api" src/renderer` |
| `npm run ts:check` runs `tsgo` and no CI job calls it | `package.json` scripts, `AGENTS.md` facts section | E1, this session | verified |
| CORRECTED 2026-09-14. Only one system map exists, at `.dump/app/research/current-system-map.md`. `docs/current-system-map.md` is not tracked and never existed on this branch | `git ls-files docs` returns five files, none of them a map | E1, re-measured this session | task 4 was already satisfied, so no document was deleted |
| CORRECTED 2026-09-14. The router count is 36 mounted from 37 files, not 36 files and not 20 | `ls src/main/lib/trpc/routers \| wc -l`, `createAppRouter` in `src/main/lib/trpc/routers/index.ts` | E1, re-measured this session | the docs state both numbers separately |
| CORRECTED 2026-09-14. Step 6 cannot be executed here. `.dump/global/questions.md` item 11 is answered and assigns wiring `tsgo` to step 02 after measuring the disagreement with `tsc` | `.dump/global/questions.md` item 11, `.github/workflows/ci.yml` | E1, read this session | step 01 left the script alone and documented the handoff |

## 4. Read first

`AGENTS.md`, then `.dump/app/second-brain.md`, then `.dump/app/research/current-system-map.md`.

## 5. What already exists

`.github/ISSUE_TEMPLATE/docs-drift.md` is the template for the individual claims. `openspec/project.md` exists and is short. The system map already has the module disposition table this step needs to reconcile against.

## 6. Implementation plan

1. Measure, do not copy: `ls src/main/lib/trpc/routers`, count exported procedures, grep the mode union in `src/shared`, and read `package.json` dependencies for the real SDK name and version.
2. Rewrite the `CLAUDE.md` sections that are wrong: router inventory, mode taxonomy, SDK package name, directory map. Keep the release sections, since they are inherited process rather than architecture, but correct them: the artifacts are unsigned by design, there is no notarization identity and none is planned, a decision the human settled on 2026-09-14 and recorded in `.dump/global/decisions.md`.
3. Same pass on `openspec/project.md`.
4. CORRECTED 2026-09-14. There is one system map and there always was on this branch, so there is nothing to reconcile and nothing to delete. Correct its false rows in place under a dated correction record and keep the `9f1bc76` provenance. One fact, one file.
5. Resolve the `mock-api.ts` contradiction in favour of the tree, record the decision in `.dump/app/decisions/2026-09-14-mock-api-disposition.md`, and fix the plan file that asserted the deletion.
6. CORRECTED 2026-09-14. Do not decide `ts:check` here. `.dump/global/questions.md` item 11 already answers it and assigns the wiring to step 02, after `tsgo` and `tsc` are compared and every disagreement justified. Deleting the script would destroy step 02's work and wiring it would skip the measurement. State the handoff in `CLAUDE.md` and leave the script alone.

## 8. Boundaries

- Always: the tree wins, and the correcting change lands in the same commit.
- Ask first: deleting a document, or rewriting a release procedure that a human may still rely on.
- Never: state a count, path or name that you did not open, and never paste a `.dump` file into `AGENTS.md` to make it look complete.

## 10. Acceptance criteria

- [x] Every file path in `CLAUDE.md`, `openspec/project.md` and the surviving system map resolves: `git ls-files --error-unmatch <path>` succeeds for each. Verified 2026-09-14.
- [x] The mode list in the docs matches the five names the tree declares. CORRECTED 2026-09-14: the declaration is `AgentMode` in `src/renderer/features/agents/atoms/index.ts`, not in `src/shared`. The docs cite that path.
- [x] The router count in the docs equals `ls src/main/lib/trpc/routers | wc -l`, which is 37 files, and the docs also state the 36 mounted routers, because the two numbers are different and both matter.
- [x] One system map exists, not two. CORRECTED 2026-09-14: this was already true. The map's false rows are corrected under a dated record at the top of the file.
- [x] `ts:check` is neither in a CI job nor gone, and that is the ratified outcome. `.dump/global/questions.md` item 11 assigns the wiring to step 02 after a measurement step 01 must not pre-empt. `CLAUDE.md` states the handoff.

## 11. Verification

```sh
for p in $(grep -ohE '`src/[a-zA-Z0-9_./-]+`' CLAUDE.md openspec/project.md | tr -d '`' | sort -u); do
  [ -e "$p" ] || echo "MISSING $p"
done   # must print nothing
bun x biome check .                # 0 findings
node scripts/ci/typecheck-ratchet.mjs
```

## 13. Rollback

Docs only. Revert the commit. No data and no behaviour.

## 14. Out of scope

The rule text in `AGENTS.md` is already updated by this branch; do not re-litigate it here. Behaviour changes belong to their own steps.

## 15. Handoff notes

Record the resolved contradictions in `.dump/app/decisions/2026-09-13-instruction-truth.md`, including any plan claim you found false, so the next reader does not re-verify it.

Written 2026-09-14. That file exists and holds the record. Two further files were touched for the same reason: `.dump/app/decisions/2026-09-14-mock-api-disposition.md` for the module verdict, and `.dump/app/plans/mauscode-architecture-plan.md` where the "zero refs" claim was false. `.dump/app/second-brain.md` carries a dated summary. Finding recorded and left unowned: the five agent mode names are written out in 38 places beside the declaration, 14 zod enums and 24 TypeScript unions, and no roadmap step covers it.
