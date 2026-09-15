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
