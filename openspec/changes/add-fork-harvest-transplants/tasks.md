# Tasks: add-fork-harvest-transplants

## Intake (done 2026-09-11)

- [x] Pull + read harvest docs (`.dump/ci/research/`) in full
- [x] Spot-verify: 9/9 named repos resolve; SamSammanne confirmed Not Found;
      1Code Apache-2.0 + archived; T3 MIT; aadivar widget files + erenbertr
      normalizer paths exist at their HEADs
- [x] Scaffold this change (no code transplanted)
- [ ] Run `openspec validate add-fork-harvest-transplants --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Approvals (gate for all phases)

- [ ] Human approves this proposal + Phase 1 scope (aadivar widget)
- [ ] Sidebar lineage decision recorded (erenbertr vs sylv — one line)
- [ ] Effect-adoption decision recorded (before Phase 4)
- [ ] Per-phase go-ahead before each subsequent phase

## Phase 1 — aadivar usage widget

- [ ] Re-map the 4 files onto arena HEAD; transplant hunk-level
- [ ] Router registration + widget wiring review (maus branding kept)
- [ ] Verify: tsc baseline-compare, tests, no-secret scan
- [ ] Update catalog action log + checkboxes (keep the live ledger live)

## Phase 2 — erenbertr backend core

- [ ] tRPC routers + `codex-tool-normalizer.ts` + codex 0.137 bump + ACP repair
- [ ] Same verification + ledger update per pickup

## Phase 3 — erenbertr transports + UI + QoL

- [ ] Gemini/OpenRouter/ACP transports, tool UI, selectors, automations inbox
- [ ] Sidebar LAST, only after the lineage decision

## Phase 4 — T3 contracts (needs explicit approval)

- [ ] Port to shared layer (ids/names adapted), tests ported along

## Phase 5 — T3 codex-app-server evaluation (not committed)

- [ ] Evaluate as Codex-adapter upgrade; feeds adapter, not native

## Pending (not in any phase until reviewed)

- [ ] ning / sylv / jhckevin / Locus / T3 server-auth+orchestration+MCP
- [ ] SamSammanne re-check (needs access)
