## 0. Meta

| Field | Value |
| --- | --- |
| Step | 08 of 35, wave W1 second half |
| Area | renderer, main |
| Risk | high |
| Depends on | {{S07}} |
| Blocks | {{S19}}, {{S21}} |
| Estimate | medium |

## 1. Outcome

The message queue is owned by the main process and stored per sub-chat, so queued messages survive a reload, keep their order, and are never dispatched twice. The React component that polls it today is deleted.

## 2. Why it matters

The queue is a component with a 7 second sleep between items and a 2 second timer that exists to catch missed status transitions. Those two numbers are the mechanism's admission that it races: `src/renderer/features/agents/components/queue-processor.tsx:17` and `:23`, verified this session, alongside a 112 line renderer store at `src/renderer/features/agents/stores/message-queue-store.ts`. A reload loses the queue, a closed window stops a run's next message, and two windows can both drain it.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Queue state and drain logic are renderer side | `message-queue-store.ts`, `queue-processor.tsx`, `queue-utils.ts`, `agent-queue-indicator.tsx` | E1, this session |
| Timers, not events, drive correctness | `queue-processor.tsx:187` `setTimeout(checkAllQueues, 0)`, `:247` `setInterval(...)` | E1, this session |
| A run record with an event cursor now exists to hang a queue on | `runs` and `run_events` from step 07 | by contract |
| `sort_order` already exists for projects with a reorder procedure, and does not exist for sub-chats | `src/main/lib/db/schema/index.ts:25` `sortOrder: integer("sort_order").notNull().default(0)`, `src/main/lib/trpc/routers/projects.ts:138`, verified this session | E3 |

## 4. Read first, and what already exists

`projects.reorder` at `src/main/lib/trpc/routers/projects.ts:138` is the existing ordering procedure to copy, including its index-becomes-`sort_order` convention. `AGENTS.md` on finding the shared owner, and the `runs.subscribe` feed from step 07. `queue-utils.ts` already isolates the ordering rules, so move that logic rather than rewriting it, and `agent-queue-indicator.tsx` becomes a projection.

## 6. Implementation plan

1. Add `queue_items` with `id`, `subChatId`, `position`, `status`, `payload`, `createdAt`, `dispatchedAt`. `position` is an integer with gaps, so an insert does not rewrite the table.
2. Move the drain decision into main: on a run transition to idle, dispatch the head item in a transaction that marks it dispatched and creates the run. One owner means no double dispatch by construction, not by a lock you hope holds.
3. Expose `queue.add`, `queue.remove`, `queue.move`, `queue.list`.
4. Replace the store with a subscription projection, delete `queue-processor.tsx`, and delete both timers.
5. Keep the indicator's DOM and styling. This step must not change how a queued message looks, only where its truth lives.
6. Tests: reload with two items pending, two windows adding concurrently, move while draining, and cancel leaving the queue intact.

## 8. Boundaries

- Always: dispatch inside the same transaction that marks it dispatched.
- Ask first: any change to send-on-complete semantics a user can observe.
- Never: keep a timer as a fallback "just in case"; if an event is missed, the event source is wrong, so fix it and say so.

## 10. Acceptance criteria

- [ ] A pending queue survives a reload and a window close, with ordering intact.
- [ ] Two windows cannot dispatch the same item, proven by a test against a mock peer or a second store instance.
- [ ] `grep -rn "QUEUE_PROCESS_DELAY" src` returns nothing.
- [ ] The indicator still renders, and the design-system pass from {{S25}} is not needed to make it correct.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
node scripts/ci/lint-changed.mjs
```

## 13. Rollback

Keep the renderer store one release behind as a dead module, revert the tRPC surface, then delete it in the next release.

## 14. Out of scope

Queue reordering by drag, which needs the pane ordering work in {{S17}}. Pause, resume and delete from the sidebar, deferred in triage row 44 to after this step.

## 15. Handoff notes

Record in the design doc that the safety interval was load bearing for which transitions, because {{S16}} and {{S19}} will re-derive the same question.
