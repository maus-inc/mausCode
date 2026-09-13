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
| Both `docs/current-system-map.md` and the `.dump/app/research/` copy exist and disagree with each other in places | `git ls-files docs .dump/app/research` | E1 | verified |

## 4. Read first

`AGENTS.md`, then `.dump/app/second-brain.md`, then `.dump/app/research/current-system-map.md`.

## 5. What already exists

`.github/ISSUE_TEMPLATE/docs-drift.md` is the template for the individual claims. `openspec/project.md` exists and is short. The system map already has the module disposition table this step needs to reconcile against.

## 6. Implementation plan

1. Measure, do not copy: `ls src/main/lib/trpc/routers`, count exported procedures, grep the mode union in `src/shared`, and read `package.json` dependencies for the real SDK name and version.
2. Rewrite the `CLAUDE.md` sections that are wrong: router inventory, mode taxonomy, SDK package name, directory map. Keep the release and notarization sections, they are inherited process, not architecture.
3. Same pass on `openspec/project.md`.
4. Reconcile `docs/current-system-map.md` with the `.dump` copy, then delete one of the two copies and leave a pointer. One fact, one file.
5. Resolve the `mock-api.ts` contradiction in favour of the tree, record the decision in `.dump/app/decisions/`, and fix the plan file that asserted the deletion.
6. Decide `ts:check`: answer in `.dump/global/questions.md` item 11, then either wire it into the `quality` job or delete the script.

## 8. Boundaries

- Always: the tree wins, and the correcting change lands in the same commit.
- Ask first: deleting a document, or rewriting a release procedure that a human may still rely on.
- Never: state a count, path or name that you did not open, and never paste a `.dump` file into `AGENTS.md` to make it look complete.

## 10. Acceptance criteria

- [ ] Every file path in `CLAUDE.md`, `openspec/project.md` and the surviving system map resolves: `git ls-files --error-unmatch <path>` succeeds for each.
- [ ] The mode list in the docs matches the mode union in `src/shared`, with the same five names.
- [ ] The router count in the docs equals `ls src/main/lib/trpc/routers | wc -l`.
- [ ] One system map exists, not two.
- [ ] `ts:check` is either in a CI job or gone.

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
