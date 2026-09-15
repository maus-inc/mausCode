# Decision: lint gate semantics on the inherited tree (2026-09-11)

## Problem

Biome CI gating on "changed files" failed in two compounding ways on the real
repo (discovered via CI run feedback, not theory):

1. `arena/*` and `main` have **independent git roots** — `git merge-base
   origin/main HEAD` fails, and a branch-spanning `--since origin/main`
   endpoint diff selects ~70 files (the whole product delta), surfacing
   ~300 inherited lint diagnostics on every push.
2. The rebrand landed on this branch mid-flight; its 79 touched files legitimately
   carried ~230 pre-existing diagnostics (noExplicitAny 52, noNonNullAssertion 42,
   useButtonType 33, noSvgWithoutTitle 29, ...) — none introduced by the change.

A gate that fails on debt it didn't create trains everyone to ignore CI.

## Decisions

1. **Gate scope = PR `base.sha` (pull_request) or `github.event.before` (push).**
   Not a branch-spanning diff against main. Implemented in `.github/workflows/ci.yml`
   via `LINT_BASE` env compiled in the workflow expression.
2. **lint-changed.mjs resolves base robustly**: three-dot diff with two-dot
   fallback (independent-root repos), plus working-tree and untracked files,
   and exits 0 when nothing lintable changed (biome exits 1 on empty sets).
3. **Mechanical hygiene is enforced from day one**: formatter + organizeImports
   are error-level in `biome ci` and gate-pass from now on. A one-time
   `biome check --write` sweep (commit bec0263, 58 files) normalized the
   rebrand range; verified semantically neutral: 13/13 tests, tsc count
   unchanged at 110, all builds green on CI run 34551940631.
4. **Opinionated lint rules demoted to `warn`** (visible, not failing) until
   their domains are cleaned: see `biome.json` — census in
   `.dump/ci/audits/` context (biome-report 2026-09-11: 325 warnings across
   70 files after the sweep). Promoted back to error per-domain as cleanup
   lands (ratchet). `useHookAtTopLevel` intentionally kept active within
   this policy — demoted to warn, not off; it flags real crash risk and is
   top of the promotion list.
5. **Biome 2.5 gotchas recorded** (schema-strict): `--since` requires
   `--changed`; `linter.rules.recommended` → `preset: "recommended"`;
   config group ≠ diagnostic category for `noImplicitAnyLet` (config group
   `suspicious`, category `lint/correctness/...`).

## Consequence

Quality gate passes on the merged rebrand+CI tree (lint exit 0 with 325
visible warnings), and fails when a changed file introduces formatter/import
errors or any warn→error-class rule violation. Re-evaluate rule promotions
when `.github/ci-baselines/typecheck.txt` drops to 0 (app domain owns those).

## Amendment, 2026-09-15: decision 2 was not robust, and it is fixed

Decision 2 claimed the wrapper "resolves base robustly". That held for the two
cases it was written for, the PR base and the independent-root fallback, and
not for a third: a base ref the clone cannot see at all. A force push orphans
the previous head, and the push event's `LINT_BASE` is exactly that head, so
the workflow hands the wrapper a commit that `actions/checkout` did not fetch.
The commit then fails, because both diffs throw an unhandled git error.

Measured on run 34865816781, the push run for `d042966` on
`arena/01a0a08a-mauscode`: the quality job died at step 7, `Lint + format
(changed files only)`, and every later step was skipped. The same commit's
`pull_request` run 34865822930 passed, because `github.event.pull_request.base.sha`
resolves, which is what made the failure look like a flaky gate rather than a
missing ref.

Reproduce it without CI:

```sh
git cat-file -e <the-previous-head> || echo absent   # the clone's view
LINT_BASE=<the-previous-head> node scripts/ci/lint-changed.mjs
# fatal: ambiguous argument '<sha>...HEAD': unknown revision
```

Fixed in `scripts/ci/lint-changed.mjs`: the explicit base is used only when
`git rev-parse --verify --quiet <ref>^{commit}` resolves it, an unresolvable
base falls through to the `origin/main` chain with the reason printed, and when
no base resolves at all the wrapper checks the whole tree instead of dying. The
three behaviours this record already fixed are unchanged, and six scenarios are
verified in the PR that landed the fix, including the force-push case and the
`no base at all` case. What this record got wrong is worth keeping: robustness
claims need the failing case named, not only the cases the author had in mind.

## Amendment, 2026-09-15 (later): the base read no longer reaches git's argument list

The amendment above added an argv read to `lint-changed.mjs`, and SonarCloud
failed the pull-request quality gate on it at `5c9fdf5`: `jssecurity:S8705`,
command argument injection, high severity, condition `C Security Rating on New
Code`. The reported flow was exact: `process.argv[2] ?? process.env.LINT_BASE`
to `resolves(explicit)` to `` `${ref}^{commit}` `` to the `execFileSync("git",
args, ...)` helper, the same values this record just added.

Measured on git 2.39.5 with a `git` shim that logs its argument list:

```sh
PATH=<shim>:$PATH LINT_BASE='--output=/tmp/pwned' node scripts/ci/lint-changed.mjs
# before: rev-parse --verify --quiet --output=/tmp/pwned^{commit}
# after:  no logged git argument list contains the supplied text
```

The pre-fix line is the finding, and it is also why no exploit was
demonstrated: `rev-parse` receives the value as a revision with `^{commit}`
appended, so an option-shaped value is never parsed as an option, and
`resolves()` has to succeed before the value reaches the two `diff` calls,
where `--output=<file>` would have been a real file write. A pattern that
cannot be shown exploitable is still a pattern worth removing, and a security
rating gate is the right place to say so.

The fix removes the flow rather than filtering it. `resolveBase` matches the
supplied string against the ids `git rev-list --all` prints, so the values that
reach the diffs are git's own 40-hex output, and `--end-of-options` now guards
the constant refs in `resolves` and `changedSinceBase`. Every input the
workflow sends behaves as before: `base.sha` and `event.before` are full ids, a
unique abbreviated id still resolves, an id the clone does not know falls back
to `origin/main` with the reason printed, and the literal `origin/main` from
the branch-creation fallback takes the default path it already took. What is
refused is anything that is not an id, which is a deliberate narrowing:
`LINT_BASE=HEAD~1` used to resolve and now widens the diff instead. Ten
scenarios, including both injection strings and the empty-change-set skip, are
recorded in `.dump/app/roadmap/04-open-decisions.md` section 11.

One more correction, because this record carries the claim: the three-dot diff
does not need a merge-base fallback because the branches are unrelated.
`compare/arena/01a097c4-mauscode...main` reports `behind`, so `main` is an
ancestor of this branch and a merge base exists upstream; what produces
`fatal: no merge base` here is this sandbox's shallow clone, which holds seven
commits. The fallback stays, because a shallow clone is exactly what CI hands
the script when a force push orphans the previous head.
