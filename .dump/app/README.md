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
- `decisions/` — dated decision records and provisional assumptions.
- `benchmarks/` — benchmark methods and results (CI-owned numbers).
- `audits/` — security and architecture audit findings.
