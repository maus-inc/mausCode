## 0. Meta

| Field | Value |
| --- | --- |
| Step | 18 of 42, parity P5 |
| Area | renderer |
| Risk | medium |
| Depends on | {{S04}} decision 2, {{S17}} |
| Blocks | {{S19}}, {{S25}} |
| Estimate | medium |

## 1. Outcome

Split panes hold their own tab groups across a reload, a plan can be rejected as well as approved, and a stream in flight cannot corrupt a fork.

## 2. Why it matters

Three defects users hit hourly. Tab groups are shared across panes, so closing a tab in one pane changes another. `isActive` gates a pane that is merely visible, so plan approval applies to the wrong pane, and there is no reject path at all, which means the only answer to a bad plan is to ignore it. Forking while a stream runs is the classic way a transcript ends up interleaved.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Per-pane tab groups do not exist; the store keys tabs globally | `src/renderer/features/agents/stores/sub-chat-store.ts` | E1, read before editing |
| `MAX_SPLIT_PANES = 4` with `addToSplit` enforcing the cap | `src/renderer/features/agents/stores/sub-chat-store.ts:10`, `:324`, `:336` | recorded, verify line numbers on the current head |
| The fork gate is real and correctly located at the streaming check | `src/renderer/features/agents/main/active-chat.tsx:3222-3224` | recorded |
| Plan approval state is derived from the transcript, `mode="plan"` plus a completed `ExitPlanMode`, and there is no reject counterpart | `src/main/lib/trpc/routers/chats.ts:1918-1966` | E1, this session |
| `sub_chats` stores `messages` as one JSON text blob with no status or order column | `src/main/lib/db/schema/index.ts`, the `subChats` table definition | E1, this session |
| `active-chat.tsx` is the largest file in the app and must not be rewritten here | `wc -l src/renderer/features/agents/main/active-chat.tsx` | E3, this session, 8,527 lines recorded in the plan |

## 4. Read first, and what already exists

`docs/design-system-baseline.md` for pane and tab affordances. `sub-chat-store.ts` owns split membership and normalisation, so tab groups belong beside it, not in a new store. The store's persist shape needs a version field before you add one, and the migration must leave an unversioned payload working.

## 6. Implementation plan

1. Tab groups keyed by pane id. Add the version field to the persisted store, write a migration from the unversioned shape, and keep the payload plain data so a settings export does not carry component state.
2. Reject path: a `rejectPlan` decision on the approval surface that ends the turn with a recorded reason, and it must be visible in `run_events` from step 07 so a critic later can read why a plan died.
3. Focus correctness: replace the visibility predicate with a per-pane focus atom, and make approval, rejection and input routing read the focused pane rather than the first active one.
4. Fork while streaming: the existing gate returns silently today; give it a visible reason, since a key that does nothing is the same bug class as the inert shortcuts in step 06.
5. Tab close freeze: reproduce against the debug server first, `docs/ci-gotchas.md` records how, and if it does not reproduce, record that instead of guessing at a fix.
6. Key every list by a stable id from the store, never by index, per `src/renderer/lib/command-rows.ts`.

## 8. Boundaries

- Always: versioned persisted shape with a migration; stable ids for reorderable rows.
- Ask first: any change to what a plan approval does to permissions, since step 10 owns that floor.
- Never: rewrite `active-chat.tsx` beyond consuming, and never add a second store that mirrors pane state.

## 10. Acceptance criteria

- [ ] Two panes hold independent tab groups across a reload, with a test on the migrated shape.
- [ ] A plan can be approved or rejected, and the rejection names the pane it came from.
- [ ] A fork attempted mid-stream says why in one line instead of returning.
- [ ] The close-freeze case is either fixed with a reproduction, or recorded as not reproducing.
- [ ] No new Biome findings, and `active-chat.tsx` grows by less than 50 lines.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
```

Manual: split to four panes, close a tab in one, reload, and confirm the other three are untouched.

## 13. Rollback

Store migration is one-way, so keep the reader tolerant of both shapes for one release and revert everything else.

## 14. Out of scope

The composer and diff work in {{S25}}. Fan-out from a plan is {{S19}}, which needs these panes to be correct first.

## 15. Handoff notes

Record the pane focus model in `.dump/app/plans/2026-09-13-pane-model.md`; {{S19}} and {{S25}} both route through it.
