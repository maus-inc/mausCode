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
| `runtime/jcode/crates/jcode-base/src/message/tests.rs:264-330` | `sk-ant-oat01-...`, `sk-or-v1-...`, `ghp_...`, `AKIA...`, `-----BEGIN PRIVATE KEY-----` | Inputs and assertions for the engine's secret-redaction tests |
| `runtime/jcode/crates/jcode-base/src/session_tests/cases.rs:804-1232` | `ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123` | Same, at session-test scope |
| `runtime/jcode/crates/jcode-app-core/src/tool/discover.rs:2466-2468` | JWT shape, private-key header | Same, for the discover tool |
| `.dump/app/decisions/2026-09-13-instruction-truth.md:190-198` | `AKIAABCDEFGHIJKLMNOP` | Step 01's decision record quoting the fixture above |

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
