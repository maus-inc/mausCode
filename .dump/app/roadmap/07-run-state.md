## 0. Meta

| Field | Value |
| --- | --- |
| Step | 07 of 42, wave W1 |
| Area | db, main |
| Risk | high |
| Depends on | {{S01}}, {{S03}} |
| Blocks | {{S08}}, {{S10}}, {{S16}}, {{S19}}, {{S20}}, {{S21}}, {{S22}}, {{S24}} |
| Estimate | large, two to four days |

## 1. Outcome

Run state lives in the database. Two new tables, `runs` and `run_events`, a `RunState` machine owned by the main process, and a subscription that replays from a cursor. A window reload, a crash, or a second window sees the same truth, and the status badge stops lying.

## 2. Why it matters

Today run progress is renderer state. Close the window and the run's record of itself is gone; open a second window and it shows nothing. The triage accepted only the stuck-session half of the reliability item, row 50 of `.dump/app/decisions/2026-09-12-jules-feature-triage.md`, and this step is exactly that half: the state machine that makes "running", "waiting for approval" and "finished" mean the same thing everywhere. Everything unattended later in the roadmap, steps {{S16}} to {{S24}}, depends on a run being a record rather than a component.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Streaming state is held in a renderer store, so it cannot outlive the process that made it | `src/renderer/features/agents/stores/streaming-status-store.ts` | E1, read before editing |
| The queue is polled by a React component with a hard 7 second delay and a 2 second safety interval | `src/renderer/features/agents/components/queue-processor.tsx:17` `QUEUE_PROCESS_DELAY = 7000`, `:23` `QUEUE_SAFETY_CHECK_INTERVAL = 2000` | E1, this session |
| `chats` carries run-adjacent columns but no run table exists | `src/main/lib/db/schema/index.ts`, 15 migrations in `drizzle/` | E1, this session |
| Harness meta events, including `session_status`, return no chunks, so the UI has nothing to reconcile against | `src/main/lib/runtime/translate.ts`, the case group starting at `:147` | E1, this session |

## 4. Read first, and what already exists

`AGENTS.md` migration rules and `FULL-REVIEW.md` §16. `src/main/lib/db/schema/index.ts` plus the drizzle journal are the pattern to follow, and `chats.get` at `src/main/lib/trpc/routers/chats.ts:407` is the existing read path that gets a run attached. Do not design a new event source; step {{S09}} makes the harness events usable.

## 6. Implementation plan

1. Design record first, in `.dump/app/plans/2026-09-13-run-state.md`: the states, the legal transitions, the owner of each transition, and what a reload replays. No code until that file exists.
2. `runs`: `id`, `subChatId`, `status`, `startedAt`, `endedAt`, `stopReason`, `approvalPending`, `engine`, `provider`, `model`. Nullable or defaulted per the migration rule.
3. `run_events`: append only, `(runId, seq)` unique, `kind`, `payload` as JSON text, `at`. A monotonically increasing sequence per run is what makes a cursor possible.
4. `RunState` in main as one module owning transitions, with every write inside a transaction alongside the event append. Register both tables everywhere the app enumerates tables for wipe and export paths, and read the live schema in the test rather than a copied list.
5. Wire it: run created at send, event on every chunk boundary worth persisting, status settled at completion, error or cancel.
6. Expose `runs.get(runId, afterSeq)` and `runs.subscribe` over tRPC, replaying from the cursor. The renderer store becomes a projection of that feed instead of the source of truth.
7. Recover on startup: any run left `running` with no live owner moves to `interrupted`, with the last event as evidence, not a guess.
8. Regression tests: replay after reload, restart mid-run, double subscribe, out-of-order events, and the interrupt recovery.

## 7. Contracts this changes

| Contract | Before | After |
| --- | --- | --- |
| Run status source | renderer atom | main-owned `runs` row, projected |
| New tRPC | none | `runs.get`, `runs.subscribe`, `runs.list` |
| Persistence | 15 migrations | 16th adds two tables, forward only |

## 8. Boundaries

- Always: new columns nullable or defaulted; schema and backfill in separate migrations; every table registered for wipe and export.
- Ask first: anything that changes what an in-flight turn does, including cancelling a run that has no owner.
- Never: hand-write migration SQL Drizzle can emit, edit a shipped migration, or keep the renderer atom as a second source of truth behind a flag once this works.

## 10. Acceptance criteria

- [ ] Reload mid-run shows the same status, and a cursor replay returns the events you missed.
- [ ] A process kill leaves a `running` row that startup moves to `interrupted`, with a test proving it.
- [ ] Two windows show identical status for the same run within one event.
- [ ] The 7 second poll and the 2 second safety interval are gone or reduced to a wakeup, with the reason recorded.
- [ ] A real `~/.mauscode` database copy upgrades cleanly, and the interrupted case is tested.

## 11. Verification

```sh
npm run db:generate      # then read the emitted SQL
bun x biome check .      # 0 findings
npm run typecheck        # 0 errors
npm run test && npm run test:node
```

## 12. Benchmark record

Event append cost and `chats.get` payload size before and after, in `.dump/app/benchmarks/`.

## 13. Rollback

Drop the two tables in a forward migration, keep the writer dark. The renderer projection stays harmless.

## 14. Out of scope

Immutable activity log with a `createTime` cursor for third-party consumers, deferred in triage row 16; queue backpressure beyond the stuck-session half.

## 15. Handoff notes

The states and transitions in the design record become the contract every unattended step cites. Keep the `runs` vocabulary identical to the runtime plan's `RunState`, so the engine port does not invent a second one.
