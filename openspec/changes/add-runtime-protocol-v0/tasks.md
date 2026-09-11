# Tasks: add-runtime-protocol-v0

## Proposal

- [x] Draft proposal.md, design.md, tasks.md, spec deltas
- [x] Human approves this proposal — approved 2026-09-11 ("do what's best")
- [ ] Run `openspec validate add-runtime-protocol-v0 --strict --no-interactive`
      in an environment with the OpenSpec CLI (unavailable in sandbox; see
      `.dump/app/decisions/2026-09-11-openspec-cli.md`) and resolve findings

## Specification

- [x] Write `docs/protocol.md` v0 from design.md (envelope, kinds, versioning,
      transports, security invariants)
- [x] Confirmed no duplication: design.md holds rationale, docs/protocol.md holds
      the contract, .dump holds analysis (checked 2026-09-11)

## Runtime client skeleton

- [x] Fork `@1jehuang/jcode-sdk` into `packages/runtime-client/` (LICENSE + UPSTREAM.md
      patch list; see packages/runtime-client/UPSTREAM.md)
- [x] Prove `connect`/`ping`/`list_sessions` against stock JCode (binary 1.1.0;
      launch 52–57ms, createSession 5–12ms — see .dump/app/benchmarks/)
- [x] Schema-parity tests green (43/43 incl. typecheck); Rust path configurable via
      JCODE_HARNESS_API_SRC, default = future runtime/jcode vendor location

## Benchmarks

- [x] Create `benchmarks/` harness (verified runnable from repo root)
- [x] Record stock-JCode sandbox numbers in `.dump/app/benchmarks/` (RSS, honestly
      caveated; PSS + per-client delta await CI with pinned hardware)
- [ ] Record 1Code-baseline app numbers that are CI-measurable (needs bun +
      Electron run; still CI-owned, not started)

## Hygiene (no behavior change)

- [x] Remove `src/main/lib/credential-manager.ts` (dead: broken imports, zero refs — proof in commit)
- [x] Investigate `src/renderer/lib/mock-api.ts` — KEEP: imported by 6 files as the live tRPC bridge (CLAUDE.md DEPRECATED label is stale)
- [x] Update `.dump/app/second-brain.md` and this change's task states on completion
