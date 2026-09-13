## 0. Meta

| Field | Value |
| --- | --- |
| Step | 39 of 45, the fork harvest, `ningzhaoxing` security rows plus Locus security tests |
| Area | main, tests, docs |
| Risk | high, it is the security test suite |
| Depends on | {{S10}}, {{S22}} |
| Blocks | {{S42}} |
| Estimate | medium |

## 1. Outcome

mausCode has a security test suite that a reviewer can run and that fails when a boundary is widened, and a recorded way to note a finding against a commit, the two pieces the forks proved worth having.

## 2. Why it matters

The catalog keeps `ningzhaoxing` for its "security-mining PoC + vuln-research workbench" and lists as a Locus domain worth mining "RCE regression tests, worktree trust tests (mirrors our runtime-permissions guard wiring)". Our tree has the guards and almost nothing testing them: `src/main/lib/git/security/path-validation.ts:54` carries the comment "This is THE critical security boundary", and step 10 adds the permission floor, while `.dump/ci/audits/` holds one scan file and `.dump/app/audits/` holds only `.gitkeep`, verified this session. A guard with no failing test is a guard someone will delete for convenience.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The security boundary exists and is documented as critical | `src/main/lib/git/security/path-validation.ts:54` | E1, this session |
| Audits directories are stubs | `ls -a .dump/app/audits/` shows only `.gitkeep`; `.dump/ci/audits/` holds `bun-audit-2026-09-11.txt` and two research notes | E3, this session |
| The two harvest sources for this step and their care flags | `.dump/ci/research/fork-network-harvest-catalog.md`, Category B security row and Category C `ningzhaoxing` row | E1, this session |
| The floor these tests must pin | step 10, and `src/main/lib/trpc/routers/claude.ts:1778` today mapping non-plan modes to `bypassPermissions` | E1, this session |
| Suggestions are where a finding should land | step 22's `suggestions` table with `kind` and `severity` | by contract |

## 4. Read first, and what already exists

`FULL-REVIEW.md` §6, whose attack surfaces, invariants and minimal models are the checklist this suite encodes. Read `path-validation.ts` and the git lock helpers before writing a test, because several guards are already there in a different shape.

## 6. Implementation plan

1. `src/main/lib/git/security/security.test.ts`, a suite covering path traversal, symlink escape, repository-URL confusion, worktree trust, a `.git` directory written through a link, and a URL handed to `shell.openExternal`.
2. One test per allow rule from step 10's permission file, so a widened default is a red run, generated from the rule table rather than hand-listed, which is the pattern the plan already requires.
3. Spawn-boundary cases: a provider emitting a huge line, a huge total, a non-UTF8 payload, and a SIGKILL mid-write, asserting the caps and the reaped child.
4. Credential cases: nothing secret in a log line, nothing in a suggestion body, and nothing in a repository or PR string the app echoes back.
5. The finding record: one file per finding under `.dump/app/audits/`, named `YYYY-MM-DD-<slug>.md`, carrying the reproduction, the vulnerable revision, the fix revision, and the test that now pins it, which is the "security-mining record workflow" reduced to what a local-first app actually needs.
6. A minimal reproducer convention, a fixture plus one command, required for any finding that is not a static read.
7. Port only test intent from the forks, never their harness, and record what was refused.

## 8. Boundaries

- Always: a finding ships with the test that pins it, and every test states the boundary it defends in one line.
- Ask first: adding a guard that changes what a user can do, which is step 10's surface, and any security work that would touch the user's own provider files.
- Never: a test that only asserts the current weak behaviour, a suppress comment to make a suite pass, or publishing a reproduction of a live vulnerability in a public issue.

## 10. Acceptance criteria

- [ ] The suite runs in `npm run test` and each case fails when its guard is removed, demonstrated for at least three cases in the PR.
- [ ] One test per permission allow rule exists, and the count matches the rules table.
- [ ] `.dump/app/audits/` holds a real record with a reproduction command that works on a clean checkout.
- [ ] No credential appears in any captured log line the suite writes.
- [ ] The catalog's two security rows are checked with the refusal notes.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
npm run test:node
```

## 13. Rollback

Tests and records only, so a revert is safe. Keep any guard they discovered was missing, and file it as its own step instead.

## 14. Out of scope

A dependency on any security scanner or fuzzing tool, since step 29's audit ratchet is the only external check we run, and the vuln-research workbench as a product feature, which is not approved anywhere in triage.

## 15. Handoff notes

Point {{S41}}'s acceptance records at this directory convention, and state in `.dump/app/audits/` whether the worktree trust test found the guard sound or found a hole, since that is the answer the next reader wants.
