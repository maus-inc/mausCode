## 0. Meta

| Field | Value |
| --- | --- |
| Step | 29 of 42, CI phase 4 ratchet promotion, plus the audit baseline |
| Area | deps, ci |
| Risk | high |
| Depends on | {{S02}}, {{S03}}, {{S12}} |
| Blocks | {{S32}} |
| Estimate | medium |

## 1. Outcome

The three pinned critical advisories are gone, the caret ranges that caused a build failure once before are exact, and the audit gate moves from critical to high so a new high finding fails CI too.

## 2. Why it matters

The audit baseline file lists exactly three rows, `protobufjs`, `simple-git` and `tar`, each a critical, verified by reading `.github/ci-baselines/audit-critical.txt` this session. The underlying scan recorded 229 advisories, 3 critical, 95 high, 111 moderate and 20 low, and one of the criticals is a direct dependency with 18 call sites: `package.json` pins `"simple-git": "^3.28.0"` while the fix is 3.32.3, verified this session. A floating range on a library that shells out to git is the same class of hazard that already broke this repository once, when a caret on `@pierre/diffs` let a resolver pick 1.4.2 and the renderer build died on a missing shiki export.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Three critical rows in the baseline | `.github/ci-baselines/audit-critical.txt` | E1, this session |
| Severity census of the recorded scan | `.dump/ci/audits/bun-audit-2026-09-11.txt`, counted by pattern this session: 3 critical, 95 high, 111 moderate, 20 low | E3 |
| `simple-git` at a caret range, direct, 18 imports | `package.json`, `grep -rn "simple-git" src/main` | E3, this session |
| `vite` at a caret range, resolved to a version with a dev-server file read advisory | `package.json` `^6.3.4`, `.dump/ci/research/repository-infrastructure-audit.md` §5 | E1 plus recorded |
| Effect and the SDK are already exact, which is the pattern to follow | `package.json` `"effect": "4.0.0-rc.112"`, `"@anthropic-ai/claude-agent-sdk": "0.2.45"` | E1, this session |
| The audit ratchet script exists and is what CI runs | `scripts/ci/audit-ratchet.mjs`, `.github/workflows/ci.yml` `security` job | E1, this session |
| `lock-regen-temp.yml` is marked temporary and pinned to another agent's branch | `.github/workflows/lock-regen-temp.yml:1-8` | E1, this session |

## 4. Read first, and what already exists

`docs/ci-gotchas.md` and `ci/decisions/2026-09-11-lint-gate-and-format-sweep.md` in `.dump`, which explain why the ratchet exists and what a fake-green gate does to discipline. `scripts/ci/audit-ratchet.mjs` is the mechanism; this step shrinks the baseline it reads and then raises its severity, which is the promotion the CI plan already scheduled.

## 6. Implementation plan

1. Run `bun install` and `bun audit --json`, and produce the current census rather than citing the 2026-09-11 numbers. Put the table in the PR.
2. Bump `simple-git` to the fixed version and read the changelog for the option-parsing behaviour the advisory describes. 18 call sites, so review each for reliance on unsafe-operation behaviour, and add a test that the plugin's guard rejects what the advisory describes.
3. Bump `vite` within the major so the dev-server file read is closed, and re-check the renderer build in the same commit, since this is the pin whose drift broke a build before.
4. Move the transitive criticals with a lockfile regeneration. If a transitive cannot move, add an exact override in the package manager's supported form, say so in `package.json` adjacent notes, and record why in `.dump`. Overrides are a stopgap with a named owner, not a baseline.
5. Audit every caret range among the direct dependencies and make exact the ones that carry a version-sensitivity risk, which the dependency records already prove for `effect`, `@pierre/diffs` and the SDK. Record the list of those you deliberately left floating, with the reason, so the next reader does not redo this by hand.
6. Regenerate `bun.lock` with `bun install`, confirm `bun install --frozen-lockfile` passes, and delete the temporary lockfile-regeneration workflow now that the lock is stable, since it points at another agent's branch.
7. When the baseline has zero critical rows, delete them, and promote the gate from critical to high in `scripts/ci/audit-ratchet.mjs` plus the CI plan's note. Do not promote while a row remains.

## 8. Boundaries

- Always: the same package manager CI uses, exact pins where drift has already cost us, and one dependency change per commit so a bisect works.
- Ask first: a major bump, an override that changes resolution for the renderer, and any new dependency at all.
- Never: add a row to the audit baseline to pass CI, run `npm install` and commit its lockfile, or bump a provider binary pin as a side effect here, which belongs to step 12.

## 10. Acceptance criteria

- [ ] `bun audit` reports zero criticals and `.github/ci-baselines/audit-critical.txt` is empty.
- [ ] The gate fails on a test that introduces a high advisory row, proven by temporarily adding one and showing the red run in the PR.
- [ ] `simple-git` and `vite` resolve to the fixed versions and the 18 call sites pass existing tests plus the new guard test.
- [ ] `bun install --frozen-lockfile` and `bun run build` are green with the 4 GB heap flag.
- [ ] `.github/workflows/lock-regen-temp.yml` is gone or documented as still needed, with the reason.
- [ ] The floating-pin list with reasons exists in `.dump`.

## 11. Verification

```sh
bun install --frozen-lockfile
node scripts/ci/audit-ratchet.mjs
bun x biome check . && npm run typecheck && npm run test
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

## 12. Benchmark record

Bundle bytes per target before and after the `vite` movement, in `.dump/app/benchmarks/`, because a resolver change is exactly how a bundle silently grows.

## 13. Rollback

Revert the lockfile and manifest together. Never revert one without the other, since a mismatch is how the 1.4.2 incident happened.

## 14. Out of scope

The 95 high advisories in transitive development dependencies that no code path reaches, which the census will let you list and defer honestly. Signing and release infrastructure, step 32. The SDK line decision, step 12.

## 15. Handoff notes

Write the census, the promoted gate and the floating-pin list to `.dump/ci/audits/2026-09-13-advisory-census.md`, and mark the CI plan's phase 4 item as done there so the promotion is not attempted twice.
