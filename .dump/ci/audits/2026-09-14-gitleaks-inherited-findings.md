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
| `generic-api-key` | `src/main/lib/codex-app-server/src/protocol.test.ts` | 122, 126 | **fixed**, fixture UUID replaced |

## The fix, and what it deliberately does not excuse

`.gitleaks.toml` at the repository root, `[extend] useDefault = true`, and one
`[[allowlists]]` entry whose `regexes` list the fifteen placeholder values with
`regexTarget = "line"`. There is no `paths` key anywhere in the file, so no file
is exempt: a real credential committed to one of these ten vendored files, or to
any other file, still fails the gate. That is why this is value-scoped rather
than the `runtime/jcode` path entry the earlier section proposed, and the cost
of the choice is a config that grows by one line per fixture.

The two findings in `src/main/lib/codex-app-server/src/protocol.test.ts` are this
repository's own test code, so the fixture UUID became `"fixture"` rather than a
config entry, and the literals `.dump` prose used to quote were rewritten the
same way. The vendored files are untouched, because `runtime/jcode` is pinned
upstream code and its fixtures are the tests for the engine's redaction.

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

## The checks that are still red, and why they are not this fix's to make

`DeepSource: JavaScript` fails on this pull request and on `main`. Statuses at
2026-09-15: JavaScript red on `main`, on this branch's head, and on PRs 50 and
52, green on PRs 51 and 53. The `Shell` analyzer is red on `main` as well. The
analyzer posts no inline review comments on PR 54, so there is nothing in the
diff for the API to show, and its dashboard is behind authentication. The
finding text is therefore not reachable from this environment, and the check is
recorded here instead of being chased with blind edits to the two files this
branch touches.
