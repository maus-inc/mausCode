# Audit: gitleaks findings that fail the security job (2026-09-14)

## Conclusion

The CI `security` job fails on the gitleaks step on `arena/01a097c4-mauscode`
and on branches stacked on it, including the step 02 branch
`arena/01a09f6e-mauscode`. Every finding is a deliberate fake-secret literal
in vendored upstream test code, not a leaked credential. Fixing the gate is a
gate-semantics change and belongs to its own step, not to step 02.

## Findings (E3, grep of the tree at 5ef2214 with gitleaks default patterns)

| File | Pattern | Why it is there |
| --- | --- | --- |
| `runtime/jcode/crates/jcode-base/src/message/tests.rs:264-330` | `sk-ant-oat01-...`, `sk-or-v1-...`, `ghp_...`, `AKIA...`, a PEM `BEGIN PRIVATE KEY` marker pair | Inputs and assertions for the engine's secret-redaction tests |
| `runtime/jcode/crates/jcode-base/src/session_tests/cases.rs:804-1232` | `ghp_` plus 30 alphabet characters | Same, at session-test scope |
| `runtime/jcode/crates/jcode-app-core/src/tool/discover.rs:2466-2468` | JWT shape, private-key header | Same, for the discover tool |
| `.dump/app/decisions/2026-09-13-instruction-truth.md:190-198` | `AKIA` plus 16 uppercase | Step 01's decision record quoting the fixture above |

All literals are alphabet placeholders. `runtime/jcode` is the pinned engine,
vendored under its provenance rules, and its test fixtures are upstream code.

## Evidence the failure predates step 02

- Base-branch push run 34831545902 on `arena/01a097c4-mauscode`, 2026-09-14:
  `Security gates` failed on the gitleaks step, every other job green.
- PR #51 (step 01) check rollup shows `Security gates: FAILURE`.
- Step 02's diff touches none of the finding files.

## What a fix looks like, for the owning step

A gitleaks allowlist, either a `.gitleaksignore` carrying the finding
fingerprints or an `[allowlist]` paths entry for `runtime/jcode` in a repo
config, decided by a human because it changes what the security gate sees.
This step's own rule applies: an exemption names what it excuses and links
the issue that tracks it. `lock-regen-temp.yml` failing on every push with a
workflow file issue is a second inherited red item; roadmap step 31 owns it.

## Update, 2026-09-15: ownership answer, and the scan becomes triageable

Step 04 was asked whether any roadmap step owns this gate. `grep -rln
"gitleaks\|security gate\|secrets scan" .dump/app/roadmap` returns no owner:
step 02 governs the audit gate's policy sentence, step 29 is the audit's
critical-to-high promotion, and step 39 is the security *test suite*. So the
fix lands in the step 04 pull request, and the config it adds is owned by
`.dump/ci` from here.

Two things changed ahead of the config itself. First, the literals in this file
and in `.dump/app/decisions/2026-09-13-instruction-truth.md` are redacted: this
repository's own prose should not quote a credential-shaped value, so those are
fixed rather than excused. Second, the CI step now reports its findings: it runs
`gitleaks dir --verbose --redact --report-format json`, and on a non-zero exit
it emits one `::error file=...,line=...` annotation per finding and writes the
same rule/file/line table to `$GITHUB_STEP_SUMMARY`. Both channels are needed,
and that is a measured correction rather than a preference: a step summary
appears on the job page but is **not** exposed through the check-run API
(`output.summary` stayed null on run 34976766972 for a step that wrote one),
while annotations are, and that API is the only route available here, where job
logs are unreachable and the default annotation says nothing but
`Process completed with exit code 1`. The JSON report stays on the runner, no
secret value is printed, and a missing report is itself reported. An `ERR` trap
annotates an unexpected failure with its line, so a broken download is
distinguishable from a real leak.

Behaviour verified with a stub `gitleaks` on this host, three cases: one finding
(exit 1, table written), no findings (exit 0, no summary), and a scanner error
(exit 126, table says no report was written). The step's exit status is still
the scan's status, so the gate itself is unchanged.

## The findings, measured 2026-09-15 (E4: the job's own annotations)

Seventeen findings at `8e3cdf9`, not four. Every one is a fake fixture, and the
list below replaces the grep-based inventory above: that inventory missed every
`generic-api-key` hit and every file outside `runtime/jcode`, which is the gap
between "matches gitleaks' default patterns" and "gitleaks' defaults match it".

| Rule | File | Line | Remedy |
| --- | --- | --- | --- |
| `generic-api-key` | `runtime/jcode/crates/jcode-base/src/auth/cursor_tests.rs` | 305 | allowlist the fixture value |
| `generic-api-key` | `runtime/jcode/crates/jcode-base/src/gateway_tests.rs` | 90, 91, 113, 114 | allowlist the two hex runs |
| `generic-api-key` | `runtime/jcode/crates/jcode-base/src/secret_input_pty_tests.rs` | 119 | allowlist the fixture value |
| `generic-api-key` | `runtime/jcode/crates/jcode-fuzzy/src/lib.rs` | 758, 761 | allowlist the two model-name strings |
| `jwt` | `runtime/jcode/crates/jcode-base/src/auth/tests.rs` | 731 | allowlist the unsigned JWT fixture |
| `generic-api-key` | `runtime/jcode/crates/jcode-base/src/auth/copilot_auth_tests.rs` | 550 | allowlist the host key |
| `generic-api-key` | `runtime/jcode/crates/jcode-provider-anthropic-runtime/src/lib.rs` | 44 | allowlist the re-export name |
| `aws-access-token` | `runtime/jcode/crates/jcode-base/src/message/tests.rs` | 324, 330 | allowlist the `AKIA` fixture |
| `generic-api-key` | `runtime/jcode/scripts/repro/tls-bad-record-mac/src/main.rs` | 191 | allowlist the repro header |
| `generic-api-key` | `runtime/jcode/tests/e2e/test_support/mod.rs` | 673 | allowlist the hex run |
| `generic-api-key` | `src/main/lib/codex-app-server/src/protocol.test.ts` | 122, 126 | allowlist the fixture UUID, the file is a verbatim upstream port |

## The fix, and what it deliberately does not excuse

`.gitleaks.toml` at the repository root, `[extend] useDefault = true`, and one
`[[allowlists]]` entry whose `regexes` list the sixteen placeholder values with
`regexTarget = "line"`. There is no `paths` key anywhere in the file, so no file
is exempt: a real credential committed to one of these ten vendored files, or to
any other file, still fails the gate. That is why this is value-scoped rather
than the `runtime/jcode` path entry the earlier section proposed, and the cost
of the choice is a config that grows by one line per fixture.

The two findings in `src/main/lib/codex-app-server/src/protocol.test.ts` are
excused by value as well, and the reason is worth keeping. The first attempt
edited the fixture UUID to `"fixture"`, which turned out to be the wrong trade
twice over. The file's own header says "Verbatim except this header. Upstream
schema ref 678157ac", so the edit broke a provenance claim this repository
makes about ported upstream code, and DeepSource, which reviews every file a
pull request touches, then reported that file's pre-existing backlog as 36 new
issues for this pull request. The file is now byte-identical to the base commit
and the UUID is one more line in the config. The literals `.dump` prose used to
quote were rewritten to shape descriptions, which is a fix and not an excuse,
because that prose is this repository's own. The vendored files are untouched,
because `runtime/jcode` is pinned upstream code and its fixtures are the tests
for the engine's redaction.

The CI step passes `--config .gitleaks.toml` explicitly even though `dir .`
would load the file by convention: an explicit path fails loudly if the file is
renamed or moved, while the convention would fail closed into a red gate with
no explanation of what changed. Local checks before pushing: the TOML parses,
every one of the eleven regexes matches the line gitleaks reported for at least
one of the seventeen findings, and every finding is covered by exactly one
remedy.

## Verified on CI, 2026-09-15 (E4)

- Push run 34977510721 for `8cd66af`: `Security gates` success, and step 6,
  `Secrets scan (gitleaks, pinned + checksum-verified)`, success with the config
  in place. First green secrets step on this branch, and the first time the rest
  of the job could even run.
- `234a8bf` is the negative control. It adds `gitleaks-detection-probe.txt`, a
  temporary file holding a JWT-shaped value and a generic-api-key-shaped value,
  neither of them in the allowlist. The job fails, and its annotations name
  `gitleaks-detection-probe.txt:7` (`jwt`) and `:8` (`generic-api-key`). The
  probe file is deleted in the next commit; the two fake values survive only as
  history, and if a scanner alerts on commit `234a8bf`, it is this probe.
- Both facts were read through `gh api .../check-runs/<id>/annotations`, which is
  also the only way to read the finding list itself.

## The third gate in that job, and the setting it needed

Fixing gitleaks unblocked the rest of the `security` job, and the next step
failed: `Dependency review (PR-affecting changes)` reported "Dependency review
is not supported on this repository. Please ensure that Dependency graph is
enabled". The repository is public, so this is a setting rather than a licence:
Settings, Code security and analysis, Dependency graph. This session cannot
change it (`PATCH /repos/maus-inc/mausCode` returns 403, Resource not accessible
by integration, and `security_and_analysis` is not returned to the token at
all), and neither can a roadmap step, because none mentions the gate:
`grep -rln "dependency.review\|dependency graph\|dependency-graph"
.dump/app/roadmap` returns nothing.

The repository owner enabled the feature on 2026-09-15, so the step runs as
written and needs no workflow change. Recorded here rather than quietly fixed,
because a red security job that is really a repository setting is the same trap
as the gitleaks red: the log said one thing and the cause was another.

## DeepSource JavaScript, measured 2026-09-15 (E4 from the pasted report)

The analyzer posts its findings to its dashboard and not to the GitHub API, and
it posted no inline review comments on PR 54, so the first pass here recorded
it as inherited and unreadable. The report itself, pasted by the human, shows
37 findings and the split matters.

- 36 are in `src/main/lib/codex-app-server/src/protocol.test.ts`, and they are
  the file's pre-existing backlog, not new code. DeepSource reviews every file a
  pull request touches, so the one-line fixture edit described above pulled all
  36 into this pull request's scope. They are `JS-0333` on `void` type
  arguments, `JS-W1042` on explicit `undefined` arguments and `JS-C1003` on
  namespace imports, which are the idiomatic shapes for Effect and TypeScript
  and read as findings only to a JavaScript-only parse. Restoring the file to
  its upstream bytes returns them to the dashboard, where they were before.
- 1 is `JS-0833`, a parse error, on `scripts/ci/lint-changed.mjs`, the only
  JavaScript file this pull request puts in front of that analyzer. Its parser
  reads `.mjs` as a script and reports the first `import`.
  `module_system = "es-modules"` was already set in `.deepsource.toml`, added by
  an earlier session for exactly this error, and it does not change the outcome.
- `DeepSource: Shell` is red on `main` and green here, so it stays out of scope
  with the same status query recorded above.

### What the exclusion attempt measured about the analyzer's configuration

`scripts/ci/**` was added to `exclude_patterns` in `.deepsource.toml` and
pushed at `ad93a44`. The JavaScript check stayed red, which turns the earlier
prose claim into a measurement: **the analyzer reads its configuration from the
default branch.** `main` is that branch, and it carries neither
`.deepsource.toml` nor `scripts/ci`, so the file this pull request writes is
never consulted and an exclusion written inside a pull request is inert for that
pull request. The same comparison says the check is diff-scoped rather than
snapshot-wide: `d042966` was green while all four `.mjs` files sat in the tree,
and red at `79b63bc`, `f83e874` and `ad93a44`, the three commits that put one of
them in the diff. The entry stays in the file because it is the durable fix once
the configuration reaches the default branch, and because it now carries this
measurement next to it.

### The format fix, implemented and reverted, with the reason

The one lever that works inside a pull request is the format of the file the
analyzer reads, so `lint-changed.mjs` became `lint-changed.cjs` at `1d75ddf`:
`require` instead of `import`, `__dirname` instead of `import.meta.url`, no
`export`. It was verified locally rather than assumed, `node --check` parsing it
under the script goal, Biome 2.5.13 reporting it clean, the four base-resolution
paths unchanged, and the injection control still showing no supplied string in
any logged git argv.

It was then reverted, because it failed a required gate. A renamed file is new
code in Sonar, all of it, and two `javascript:S4036` findings that had been
sitting on those two `execFileSync` lines since 2026-09-12 as old code entered
the leak period with it: `AaClg8tpNQMeXjMSkZEr` on line 40 and
`AaClg8tpNQMeXjMSkZEs` on line 138, "Make sure the "PATH" variable only
contains fixed, unwriteable directories", one MINOR vulnerability each, which is
security rating B on new code against a required A. Repository-wide that rule
has exactly one other open instance, `scripts/download-codex-binary.mjs:199`,
open since 2026-02-15 in old code, so the established position is that these
findings are tolerated where they are and not dragged into a diff.

The trade is therefore measured in both directions and the required gate wins: a
non-required analyzer's false positive stays, a required gate's security rating
does not fall. Whoever wants the format fix can have it, in the order that does
not cost the gate: first make the PATH handling of these wrappers Sonar-clean,
then change the format.

### Where DeepSource stands at this head

Every DeepSource check at `1d75ddf` is `skipped`, with this output: "Analysis
quota is exhausted. Your current Analysis quota has been exhausted. Upgrade your
subscription plan to increase your Analysis quota." The organization runs out of
analysis minutes, so no verdict exists for that commit, and the earlier red is
absent for that reason rather than because anything fixed it. Three ways out,
all of them the human's: raise the quota and let the analyzer run, add the
exclusion to the default branch so it stops parsing `.mjs` at all, or change the
path-handling of the wrappers and take the CommonJS conversion afterwards.
