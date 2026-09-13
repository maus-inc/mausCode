## 0. Meta

| Field | Value |
| --- | --- |
| Step | 09 of 35, wave W1 tail plus parity P2 remainder |
| Area | main, runtime |
| Risk | high |
| Depends on | {{S07}} |
| Blocks | {{S16}}, {{S24}}, {{S26}} |
| Estimate | medium |

## 1. Outcome

The runtime event mapper carries the harness events the app needs into either a chat chunk or a run event, and the ones that stay internal are listed with a reason. The Claude stream types stop being `any` at the boundary.

## 2. Why it matters

`src/main/lib/runtime/translate.ts` has a case group, starting around `:147` and verified this session, where session and meta events deliberately produce no chunks. That is correct for P1 and wrong for everything after it: a status badge, a background progress line, a compaction notice and a wake request all read like renderer bugs when the event was dropped upstream. The parity plan's P2 also records that `ClaudeStreamMessage` and `ClaudeContentBlock` were never added to `src/main/lib/claude/transform.ts`, so one file translates the whole provider stream with loose types.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| A block of harness events returns no chat chunks, including `message_accepted`, `session_status`, `connection_phase`, `session_renamed` | `src/main/lib/runtime/translate.ts:145-168` | E1, this session |
| 34 `case "` arms exist in the mapper, so the count of dropped events must be re-measured, not copied from the plan's "22" | same file | E3, this session |
| The typed stream shape named in the plan does not exist | `grep -n "ClaudeStreamMessage" src/main/lib/claude/transform.ts` returns nothing | E3, this session |
| `compacted` is required by the memory step's fail-closed pre-compress hook | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §7 mapping row | recorded |

## 4. Read first, and what already exists

`AGENTS.md` on not faking state in the renderer, `docs/backend-porting-recipe.md` §4 on the closed chunk dialect, and `translate.test.ts`, which already tests this file. `run_events` from step 07 is the destination for events that are not chat content, which removes the false choice between inventing a chunk kind and dropping the event.

## 6. Implementation plan

1. Recount the mapper's internal arms and write the table into the PR: event, current behaviour, destination, and the consumer that asked for it. An event with no named consumer stays unmapped, and the table says so.
2. Map `compacted`, `session_status`, `background_progress` and `wake_requested` onto run events, with `compacted` as the one the memory step needs to gate compression on.
3. Extend `RunState` transitions from these events rather than from renderer timers.
4. Type the Claude boundary: add the stream message and content block unions to `src/main/lib/claude/transform.ts`, replace the remaining loose types there, and keep the translation total with an exhaustiveness check.
5. Add a test per mapped event asserting the persisted record, plus a test asserting an unmapped event is logged once rather than silently dropped.

## 8. Boundaries

- Always: extend the switch and its test in one change; never fake the state in the renderer.
- Ask first: adding a chunk kind, because that is the closed dialect and every provider must then answer for it.
- Never: cast an event payload to `any` to satisfy a new union, and never widen a provider's capability claim because an event arrived.

## 10. Acceptance criteria

- [ ] Every harness event in the mapper is either mapped with a named consumer, or listed as deliberately internal with the reason.
- [ ] `compacted` reaches `run_events` and a test proves a pre-compression hook can see it.
- [ ] `transform.ts` has no `any` and typecheck is clean with `noImplicitAny` behaviour unchanged.
- [ ] No new Biome findings, and the runtime `node --test` suite passes.

## 11. Verification

```sh
npm run test:node      # the runtime suites
npm run typecheck && bun x biome check .
```

## 13. Rollback

Mapper changes are additive. Revert the commit; the run tables tolerate an absent event kind.

## 14. Out of scope

The renderer affordances those events drive, owned by {{S16}} and {{S24}}. The adaptive thinking and effort flags, owned by {{S12}}.

## 15. Handoff notes

Put the event table in `.dump/app/research/2026-09-13-event-mapping.md`. Steps {{S16}}, {{S24}} and {{S26}} each cite a row from it, so write the row for them.
