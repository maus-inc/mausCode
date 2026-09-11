# Provisional assumptions (app track)

The human skipped the naming/identity questions (2026-09-11), so work proceeds on
these safe, easily-reversed assumptions. Each is recorded here so it can be confirmed
or overturned without code archaeology. Nothing below changes user-visible behavior
yet — all current work is research/docs.

- PA-1. CLI command will be `mauscode`; app id `dev.maus-inc.mauscode`. No renames
  performed anywhere until confirmed (another track may own the rebrand).
- PA-2. Canonical wordmark undecided; no logo committed to product surfaces by this
  track. Branding PNGs stay in `new mauscode branding/` untouched.
- PA-3. JCode will be vendored as a copied tree under `runtime/jcode/` with
  `UPSTREAM.md` (pinned SHA, MIT license + Jeremy Huang attribution, patch list).
  Rationale: mausCode refines the runtime deeply, so a subtree/submodule that tracks
  fast-moving upstream creates more churn than value; a pinned copy with an explicit
  patch list keeps history honest and rebases deliberate. Overturn to subtree if the
  human wants upstream-history preservation.
- PA-4. Harness-api v1 is the integration surface (not the legacy internal protocol,
  not the TUI crates). If v1 proves insufficient, extend via `maus.*` minor kinds
  before considering any fork.
- PA-5. No `src/` behavior changes until the OpenSpec protocol proposal is approved.
  Research, docs, benchmarks, and dead-code removal (after proof of zero refs) only.
- PA-6. Benchmark environment: CI (bun + full matrix). Sandbox numbers (node-only,
  no bun, no Electron run) will be labeled as such and never presented as releases.
