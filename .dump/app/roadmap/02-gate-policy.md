## 0. Meta

| Field | Value |
| --- | --- |
| Step | 02 of 42, parity P0-3 |
| Area | ci, docs |
| Risk | medium |
| Depends on | {{S01}} |
| Blocks | {{S12}}, {{S29}}, {{S30}} |
| Estimate | small |

## 1. Outcome

One paragraph, in `CONTRIBUTING.md` and `docs/backend-porting-recipe.md` §9, says what the typecheck ratchet is, that `.github/ci-baselines/typecheck.txt` is currently empty, and therefore that zero errors is the gate. It also says what adding a line to a baseline file means and who may do it.

## 2. Why it matters

The recipe asserts zero errors and attributes it to a mechanism that is not how the gate works. A reader who trusts the recipe runs one command and gets a different answer than CI. And a baseline entry is the cheapest way to make a regression invisible, so the permission to add one has to be written down.

## 3. Evidence

| Fact | Path | Level | Measured |
| --- | --- | --- | --- |
| The baseline file contains a single newline, so the ratchet permits zero errors | `.github/ci-baselines/typecheck.txt`, `wc -c` | E3 | this session |
| The ratchet script is what CI runs, not `tsc` directly | `.github/workflows/ci.yml` `quality` job, `node scripts/ci/typecheck-ratchet.mjs` | E1 | this session |
| The audit gate has the same shape with three pinned criticals listed | `.github/ci-baselines/audit-critical.txt` | E1 | this session, 3 rows |
| `biome.json` contains no `"warn"` severities, so `bun x biome check .` exiting 0 means a clean tree | `grep -c '"warn"' biome.json` → 0 | E3 | this session |
| `AGENTS.md` already states the zero-error and zero-finding facts | `AGENTS.md` facts section | E1 | this session |

## 4. Read first

`AGENTS.md` verification gate, `docs/backend-porting-recipe.md` §9, `docs/ci-gotchas.md`, `ci/decisions/2026-09-11-lint-gate-and-format-sweep.md` in `.dump`.

## 5. What already exists

`scripts/ci/lint-ratchet.mjs` and `audit-ratchet.mjs` implement the same policy in code. This step writes the sentence, not the mechanism.

## 6. Implementation plan

1. Read `scripts/ci/typecheck-ratchet.mjs` and `audit-ratchet.mjs` and confirm the behaviour you are about to document: an empty baseline means an error count of zero is required, and a listed row is an exemption for one named advisory.
2. Write the policy paragraph once. Put it in `CONTRIBUTING.md` and link it from the recipe rather than restating it.
3. Add the rule: a baseline line may only be added by a PR that links an issue, carries the advisory id or the file and error text, and never for a warning the author did not want to fix.
4. Delete nothing from `AGENTS.md`. Its facts already agree, and this step exists so the other documents agree with it.

## 8. Boundaries

- Always: describe the script as it is, with the file it reads named.
- Ask first: any change to a baseline file's meaning, which is a gate change.
- Never: add a baseline entry in the same PR as the regression it excuses.

## 10. Acceptance criteria

- [ ] `grep -n "typecheck" CONTRIBUTING.md` shows the zero-error sentence with the baseline path.
- [ ] `docs/backend-porting-recipe.md` §9 no longer attributes the gate to a mechanism CI does not use.
- [ ] The rule for adding a baseline line exists in exactly one document and is linked from the other.

## 11. Verification

```sh
node scripts/ci/typecheck-ratchet.mjs    # passes, 0 errors
node scripts/ci/lint-changed.mjs         # passes
```

## 13. Rollback

Revert the two documents. The gate is unchanged, so no code risk.

## 14. Out of scope

Driving the remaining `tsc` debt in inherited files, which each owning step fixes as it arrives, and the promotion of the audit gate from critical to high, which step {{S29}} owns.

## 15. Handoff notes

If you find the script's behaviour differs from its documentation, fix the script in a separate commit and say so in the PR, because every agent's numbers depend on it.
