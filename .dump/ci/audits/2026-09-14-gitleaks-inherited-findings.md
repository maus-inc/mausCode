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
