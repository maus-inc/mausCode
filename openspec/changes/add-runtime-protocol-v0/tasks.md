# Tasks: add-runtime-protocol-v0

## Proposal

- [x] Draft proposal.md, design.md, tasks.md, spec deltas
- [ ] Human approves this proposal (gate for the execution follow-up)
- [ ] Run `openspec validate add-runtime-protocol-v0 --strict --no-interactive`
      in an environment with the OpenSpec CLI (unavailable in sandbox; see
      `.dump/app/decisions/2026-09-11-openspec-cli.md`) and resolve findings

## Specification

- [ ] Write `docs/protocol.md` v0 from design.md (envelope, kinds, versioning,
      transports, security invariants)
- [ ] Archive design decisions that don't belong in `docs/protocol.md` back into
      `.dump/app/research/` (no duplication)

## Runtime client skeleton

- [ ] Fork `@1jehuang/jcode-sdk` into `packages/runtime-client/` (license +
      attribution preserved, see UPSTREAM handling in the follow-up change)
- [ ] Prove `connect`/`ping`/`list_sessions` against stock JCode v0.84.0 daemon
- [ ] Add schema-drift test mirroring upstream (fail on unknown tag divergence)

## Benchmarks

- [ ] Create `benchmarks/` harness (method doc + runnable scripts)
- [ ] Reproduce stock-JCode single-session PSS + per-client delta; record method,
      versions, hardware, and numbers in `.dump/app/benchmarks/`
- [ ] Record 1Code-baseline app numbers that are CI-measurable (cold start,
      first-token Claude/Codex, session create/resume, RSS idle/loaded)

## Hygiene (no behavior change)

- [x] Remove `src/main/lib/credential-manager.ts` (dead: broken imports, zero refs — proof in commit)
- [x] Investigate `src/renderer/lib/mock-api.ts` — KEEP: imported by 6 files as the live tRPC bridge (CLAUDE.md DEPRECATED label is stale)
- [ ] Update `.dump/app/second-brain.md` and this change's task states on completion
