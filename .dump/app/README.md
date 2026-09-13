# .dump/app — durable engineering memory (app track)

This directory is the long-lived memory of the mausCode application track. It is not
a transcript folder, not a scratchpad, and not a trash folder.

## Curation standard

Every file here must satisfy all of these, or it does not belong:

1. Useful to a future engineer who never saw the session that produced it.
2. States durable facts, decisions, or plans — no process narrative ("I did X"),
   no per-turn logs, no checkbox tracking of ephemeral tasks.
3. No duplication: one fact lives in exactly one file; other files link to it.
4. Provenance over recall: versions, SHAs, paths, and sources are stated, so claims
   can be re-verified.
5. Kept current: when understanding changes, the file changes in the same commit.
   Superseded files are deleted, not left to rot.

## Index

- `second-brain.md` — compact architectural memory; start here.
- `research/product-thesis.md` — product direction and decisions extracted from the
  source-of-truth history.
- `research/current-system-map.md` — inherited 1Code system + JCode architecture +
  replacement seams, module disposition, service coupling points.
- `research/competitive-capabilities.md` — concepts adopted from other runtimes, with
  placement verdicts.
- `research/migration-system.md` — import flow design and documented assumptions.
- `plans/mauscode-architecture-plan.md` — target shape, invariants, models, phases.
- `plans/2026-09-12-jules-port-plan.md` — PROPOSED (unapproved) program to port the Jules changelog
  features the user selected: waves W0–W14, each an OpenSpec change, with the codebase findings that shape
  them. Companion record: `decisions/2026-09-12-jules-feature-triage.md` (54 features: 34 accepted,
  6 scoped to remote work, 8 deferred, 6 rejected). No code has been written for either.
- `plans/release-parity-v0.0.75-0.0.84-plan.md` — RECREATED (2026-09-13) 1Code release-parity program, phases
  P0-P8 across 47 release-note items, each re-verified against this branch; already-fixed items are marked so
  nobody redoes them, and §11 of the port plan sequences the two programs together.
- `research/2026-09-13-t3code-pr-state-spike.md` — how t3code models, discovers, caches and de-duplicates
  pull-request state, and which 55 lines are worth vendoring verbatim.
- `research/2026-09-13-hermes-memory-spike.md` — hermes-agent's memory lifecycle (provider hooks, budgets,
  unattended write gate) mapped onto mausCode's waves, including the store-ownership decision.
- `plans/2026-09-13-mauscode-roadmap.md` — the ordered 35-step program with the dependency
  graph, milestones, standing constraints, and the corpus claims corrected by re-measurement.
- `roadmap/` — the 35 step bodies as filed on GitHub, one file per issue. The issue is the
  working copy; these are the durable originals, so a closed issue can be re-derived.
- `decisions/` — dated decision records and provisional assumptions.
- `benchmarks/` — benchmark methods and results (CI-owned numbers).
- `audits/` — security and architecture audit findings.
