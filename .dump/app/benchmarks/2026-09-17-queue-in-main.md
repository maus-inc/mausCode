# Queue in main benchmark record

Roadmap step 08, issue #10. Measured 2026-09-17 in the Arena sandbox
(Linux x64, Node v22.22.3), commit base `d108726` of `arena/01a097c4-mauscode`.

## What moved

The queue left the renderer. `message-queue-store.ts` (a zustand store per
window) and `queue-processor.tsx` (a component with a 500 ms debounce and a
30 s safety interval) are deleted. Rows live in `queue_items`, main owns the
order and the hand-off, and a window performs the send for the sub-chat it
already holds.

Removed on the renderer side: two timers, one interval, one 112-line store and
one 277-line component. Added: `queue.subscribe` (one per window) and one
`claim`/`complete` round trip per dispatched item.

## Operation cost

Measured through the same store code path the router uses, in-process, against
an in-memory database with all 16 migrations applied. Each number is the full
round trip for one operation.

| Operation | Mean | p95 | Sample |
| --- | --- | --- | --- |
| add + claim + complete (one dispatched item) | 1.834 ms | 3.484 ms | 300 cycles |
| list (20 rows deep) | 0.295 ms | 0.482 ms | 200 lists |
| `recoverSending()` with no `sending` row | 0.262 ms | - | 1 |

The three statements in a dispatch cycle are an insert, the claim transaction
(one indexed select over the head, one `runs` lookup, one conditional update)
and the delete. A turn takes seconds, so the queue write cost is noise beside
it. Emits fan out one `list` per subscriber; with one window that is the
0.295 ms above.

## Re-measured after the hand-off marker (review round four)

The claim now also releases an abandoned lease and records the hand-off, which
is one more conditional update inside the claim transaction and one more update
before the send. Measured the same way, in the same sandbox, on the tree that
this section was added to:

| Operation | Mean | p95 | Sample | Delta |
| --- | --- | --- | --- | --- |
| add + claim + markHanded + complete | 2.382 ms | 4.396 ms | 300 cycles | +0.548 / +0.912 |
| list (20 rows deep) | 0.351 ms | 0.524 ms | 200 lists | +0.056 / +0.042 |
| `recoverSending()` with no `sending` row | 0.260 ms | - | 1 | -0.002 |

The claim's extra update is a lease check over the same index the claim already
reads (`queue_items_sub_chat_id_idx`), and the marker is a single-row update by
primary key keyed to the claiming window, so the added work is bounded by one
indexed scan over the rows of one sub-chat. A stored queue holds a handful of
rows per sub-chat, and the dispatching window already pays a turn of seconds
after it, so the added half-millisecond is noise beside the operation it
protects: a message sent twice.

## The deleted timers, priced

`QUEUE_PROCESS_DELAY = 500` delayed every dispatch when the run record had
already told the renderer the turn had settled, so a queue of three items
carried 1.5 s of added latency that this change removes.
`QUEUE_SAFETY_CHECK_INTERVAL = 30_000` ran a full `checkAllQueues` scan every
30 s in every window for the life of the process, and was the mechanism's
admission that a wakeup could be missed. Neither exists now; a wake is a
question to main, and main's answer is checked against the rows in the same
transaction that claims one.

## Startup cost

Startup gains one `recoverSending()` call beside `recoverInterruptedRuns()`
when the database opens. On a clean start it is one indexed update over
`queue_items` with zero matching rows, measured at 0.262 ms. The table is
empty for every existing user because migration `0016` creates it.

## Baseline obligation

`CONTRIBUTING.md` asks for a measured delta for changes that move startup,
memory, rendering or file weight. Startup gains the recovery call above, memory
loses the renderer store and its per-window subscriptions, and no renderer asset
weight changed. The row shape is bounded by `src/shared/queue-item.ts`: text
200,000 characters, long text 400,000, base64 attachments 24,000,000 characters
each, at most 48,000,000 characters of inline base64 per item, 20 attachments
per kind. Those are JavaScript string lengths, which are UTF-16 code units, so a
message of non-ASCII text persists as more bytes than the number states; the
numbers bound the shapes, not the on-disk size of any one message. The bound, not a typical size, is what the schema guarantees: 100 text
items can reach 20 MB, while an ordinary queue of short messages stays in the
tens of kilobytes, because a payload carries only what the user typed plus the
mention tokens that expand to it.

## Driver caveat

The numbers come from Node's built-in `node:sqlite` through
`src/main/lib/db/test-sqlite.ts`, because the sandbox has no compiler toolchain
and `npm rebuild better-sqlite3` fails here. CI installs with `--ignore-scripts`
for the same reason. The SQL, the schema and the transaction shape are identical
either way; treat these as order-of-magnitude numbers for the write path, not a
`better-sqlite3` measurement. Step 07's record carries the same caveat.
