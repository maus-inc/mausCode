# Queue in main: design record

Roadmap step 08, issue #10. This file is the design contract the code follows.
Ownership, states, the claim rule and the wake sources are normative. The store
lives in `src/main/lib/queue/`, the shared payload vocabulary in
`src/shared/queue-item.ts`, the renderer projection in
`src/renderer/features/agents/stores/queue-projection.ts`.

## Outcome

Queued messages are rows in the database, owned by the main process, per
sub-chat and ordered. They survive a reload, keep their order, and two windows
cannot send the same one. `queue-processor.tsx` and its timers are deleted, and
the indicator becomes a projection of the rows.

## Decisions taken with the human (2026-09-17)

1. **Who sends.** Main owns the rows, the order and the hand-off. The chat
   window performs the send, because the prompt and the per-chat settings
   (model, custom endpoint, offline mode, cwd) are assembled in the renderer,
   and a turn cannot be displayed in a window that did not start it
   (`ipc-chat-transport.ts:485`, `reconnectToStream` returns null).
2. **Which engines.** One rule for every provider. A window asks main for the
   next item when its status for that sub-chat turns idle, when the queue
   changes, and on mount. Main refuses while a run is active for that sub-chat,
   which is authoritative for the two engines that write run rows, and is the
   window's own status report for the rest. That is today's behaviour for those
   engines, not a regression.
3. **Stop semantics (changed on purpose).** A manual stop now pauses the queue
   for that sub-chat. Nothing is sent until an explicit send: a direct message,
   a queue add, or Send now in the queue card. Stopping no longer fires the next
   queued message.

## States

`queue_items.status` is one of three values, declared once in
`src/shared/queue-item.ts`.

| status | meaning |
| --- | --- |
| `pending` | eligible to be handed to a window |
| `paused` | the user stopped a turn; not eligible until an explicit send |
| `sending` | claimed by exactly one window, which is sending it now |

`sending` rows are hidden from the indicator, matching the old store's pop
before send. `complete` deletes the row; `requeue` returns it to `pending` with
`dispatchedAt` cleared. Startup recovery returns every `sending` row to
`pending`, because no window can have claimed anything at startup.

## Ordering

`position` is an integer with gaps, `POSITION_STEP = 1024`. An insert takes
`max(position) + POSITION_STEP`, so an insert never rewrites another row. A move
places the item between its new neighbours at the midpoint; when the gap is
exhausted the store renumbers that sub-chat's rows by the step. `move` takes the
target index among the sub-chat's ordered rows, the same index-to-order reading
`projects.reorder` uses (`src/main/lib/trpc/routers/projects.ts:138`). Ties
break on `createdAt` then `id`, so the order is total.

## The claim rule

`claim({ subChatId, itemId? })` is one transaction over the queue row and the
`runs` table:

- Without `itemId` it is a dispatch: the oldest `pending` row for the sub-chat,
  refused while any `running` or `waiting_approval` run exists for that
  sub-chat, and refused while anything for that sub-chat is already `sending`.
- With `itemId` it is Send now: that specific row, no idle gate, because the
  user asked for it and the window stops the current turn first.
- Either way the row is claimed with a conditional update: `status IN
  ('pending')` for a dispatch, `status IN ('pending', 'paused')` for Send now,
  `WHERE id = ?`. The caller receives the row only when that update touched it.
  Two windows racing resolve to one winner; the loser gets null. Order is never
  chosen by a window.

This is the whole dispatch. There is no `dispatched` state waiting for a window,
because the only actor that can send is a window.

## The wake sources

The renderer projection asks main for work on exactly three events, never on a
timer:

1. the queue feed delivers a change (snapshot on subscribe, then live),
2. the sub-chat's streaming status turns `ready`,
3. the projection starts, which is what a reload and a window open do.

A wake is only a question to main, and a window asks only when it could send
that item: it needs an idle status for the sub-chat and a live `Chat` in this
window, and it never asks while it is already sending or a claim is in flight.
Main's answer is the real guard, so a wake the projection misses cannot lose an
item: any later event re-asks, and the row is still there.

A send that fails before the turn starts hands the row back with `requeue` and
marks the sub-chat `error` first, so the feed change the requeue produces cannot
claim the same row again in a loop. There is no timer retry: the row stays in
the queue, and the next explicit send or later wake picks it up.

### Line references in the step file and in the bot plan

Step 08's §2 and §3 cite `queue-processor.tsx:17` as a 7 second sleep and `:23`
as a 2 second interval. The file that was deleted held neither number. At the
base commit it declared `QUEUE_PROCESS_DELAY = 500` and
`QUEUE_SAFETY_CHECK_INTERVAL = 30_000`, and its comment records the earlier
values (7000 and 2000) as history, so the step text was measuring an older
revision of the same file. The acceptance check in §10 is a grep, and the file
is gone, so the check passes regardless of which number was current. The same
step's issue #10 carries a bot-generated plan whose first design choice states
that step 07 does not exist in its checkout; that is false here, where `runs`,
`run_events` and `runs.subscribe` shipped in PR #59, so its premise was not
used. What was reused from it: gapped positions, one shared type module, a
conditional-update claim, deleting the whole processor file, and leaving the
indicator's DOM alone.

### What the deleted safety interval was load bearing for

`QUEUE_SAFETY_CHECK_INTERVAL` (30 s, `queue-processor.tsx:23` before deletion)
covered exactly one class of failure: a wakeup that never reached the component,
because the status projection wrote nothing for a transition it had not observed
(a missed run event, a remount mid-stream, a transport that never fired
`onFinish`). `QUEUE_PROCESS_DELAY` (500 ms) coalesced the several wakeups one
transition produced. Neither carried queue truth; both are gone, and the two
classes they covered are named here for steps 16 and 19, which will re-derive
this question: (a) a run that settles while no window is watching, which step 16
cares about because its loop spans restarts, and (b) a turn whose event source
never reports completion, which step 19 cares about because a supervisor reads a
child's completion. In this design (a) costs nothing, because the row waits and
any later wake dispatches it, and (b) is the run feed's reconciliation problem
in `run-feed-projection.ts`, not the queue's.

## Surfaces

- `src/main/lib/queue/queue-state.ts` and `index.ts`
- `src/main/lib/trpc/routers/queue.ts`: `add`, `remove`, `move`, `clear`,
  `list`, `subscribe`, `claim`, `complete`, `requeue`, `setPaused`
- `src/main/lib/db/schema/index.ts`: the `queue_items` table and its index
- `drizzle/0016_*.sql`: generated by `npm run db:generate`
- `src/shared/queue-item.ts`: the status vocabulary, the payload schema and the
  row shape both processes share
- `src/renderer/features/agents/stores/queue-projection.ts`: the feed, the wake
  logic and the actions
- `src/renderer/features/agents/lib/queue-parts.ts`: the payload-to-parts
  builder, shared by the sender and its tests
- `src/renderer/features/agents/lib/queue-send.ts`: one sender for both the
  automatic dispatch and Send now, plus the scroll signal channel
- `src/renderer/features/agents/components/queue-sync.tsx`: the single mount
  that starts the run feed and the queue projection per window
- `src/renderer/features/agents/mentions/mention-prefixes.ts`: the mention
  prefixes, kept in a light module so the parts builder needs no editor

## Consequences named on purpose

- A closed window means nothing sends until a window is open again. The message
  is not lost; it is a row.
- A window that dies between claim and send leaves a `sending` row, which
  startup recovery returns to `pending`. The window is a few milliseconds wide,
  and it is the only path that can send a message twice.
  - While such a row exists, dispatch for that sub-chat is refused (a claim
    waits for the sub-chat to be idle) and Send now cannot take it either, so
    the sub-chat's queue is stuck until the app restarts. A window that closes
    while the app keeps running (macOS, all windows closed) is the case that
    reaches this without a restart. Steps 16 and 19 own the fix because it
    needs a liveness check or a staleness bound, which is the same interval
    question §15 hands them.
- The other eleven provider routers still write no run row, a gap step 07 filed
  as its own follow-up. Main cannot see their turn as busy; the claiming
  window's status is the guard, as it is today.
- A local send failure leaves the pane marked `error` with the item back in the
  queue; the run feed deliberately does not clear an error that no run row
  explains, so the user sees the failure and can retry with Send now.

## Verification

`bun x biome check . && npm run typecheck && npm run test` plus
`node scripts/ci/lint-changed.mjs`. The store tests in
`src/main/lib/queue/queue-state.test.ts` cover the step's named scenarios
(reload with items pending, two windows adding, two windows claiming, move while
draining, cancel leaving the queue intact); the router test covers the wire
surface; `queue-projection.test.ts` covers the renderer's wake and hand-back
rules; `queue-parts.test.ts` covers the payload expansion.
