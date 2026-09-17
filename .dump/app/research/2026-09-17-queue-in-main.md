# Queue in main: research record

Roadmap step 08, issue #10. Research for the code research gate, run
2026-09-17. The design contract is
`.dump/app/plans/2026-09-17-queue-in-main.md`; this file records what was read,
searched and tried to break, so the next session does not re-derive it.

## What the change rests on, and where the answer came from

| Behaviour the diff relies on | Sources | What it settled |
| --- | --- | --- |
| A conditional `UPDATE ... WHERE status = 'pending'` with an affected-rows check is the whole claim, and one statement is atomic on its own | chrishksang/crispercode-framework#5, the "claim queue jobs without a transaction" thread, read 2026-09-17; `dev.to/sathish_daggula` SQLite queue article, read 2026-09-17; the store test at `src/main/lib/queue/queue-state.test.ts` (E3) | No `SELECT ... FOR UPDATE` and no lock object. Two callers race on the same statement, one sees a row, the loser sees null. Both sources also name the failure this avoids: a claim that re-reads after the update can return a status the database already changed. |
| Gapped integer positions, midpoint on move, renumber only when the gap is gone | `hollos.dev` fractional indexing explainer, `deepwiki.com/rocicorp/fractional-indexing`, and the Trello 16,384 step note in the hollos post, all read 2026-09-17; `github.com/rajrishi-06/Action/issues/3` on midpoint exhaustion | Integer gaps with `POSITION_STEP = 1024` leak far less precision than floats, so no float convergence problem. The renumber path is triggered by a gap smaller than 2 after rounding, not by a count. |
| Main owns a local job queue; the renderer holds UI state and talks over IPC | Medium "Building an Electron App Offline-First" blueprint, read 2026-09-17; `github.com/Tatiwel/electron-multi-window` (main as the mediator between windows), read 2026-09-17 | Main owns the rows; the window that already holds a `Chat` performs the send. The step file's own §1 decision is the same call, because a turn cannot be displayed in a window that did not start it (`reconnectToStream` returns null). |
| The chat's own status turns `submitted` synchronously inside `sendMessage`, before any await | `node_modules/ai/dist/index.js:14631` (`this.setStatus({ status: "submitted" })` runs before the first await in the try block), `node_modules/ai/dist/index.d.ts:3760` (`type ChatStatus`) and `:3762` (`get status()`), read 2026-09-17 | The dispatch gate can use `chat.status`, which cannot lag a direct send. The app-wide status store is written from a React effect on the `status` value, so it lags by one render, which is the window a queued send could have slipped through. |

## Edge cases walked, and what covers each

| Case | Behaviour | Covered by |
| --- | --- | --- |
| Empty queue | `claim` returns null, the window sends nothing, no state written | `wakeQueue` and `claim` tests |
| Two windows ask at once | One row leaves, loser gets null | `queue-state.test.ts` "hands the head item to exactly one of two windows asking"; the same test against a second store on the same file |
| Reload with two items pending | Rows are read in `position` order, ties by `createdAt` then `id` | `queue-state.test.ts` "keeps two pending items in order across a reload" |
| Reload with a claimed row | Startup recovery returns `sending` to `pending` with `dispatchedAt` cleared | "returns a claimed but unsent item to pending on recovery" |
| Move while a turn drains | The moved row lands where the visible index says; the row in flight keeps its place in the total order | "moves an item while another is draining, and dispatches the moved head next" |
| Cancel a turn | The queue rows are untouched; the paused state is what a stop writes, and only an explicit send clears it | "leaves the queue intact when a run is cancelled", "blocks dispatch until an explicit send resumes the queue" |
| Send fails before the turn starts | Row goes back with `requeue`, pane is marked `error`, no automatic retry | `queue-projection.test.ts` "hands the item back when the send never starts" |
| Feed subscription opens | Listener registered before the replay read, replay emitted first, anything buffered during it flushed after | `queue.test.ts` subscribe tests |
| Feed subscription fails during replay | Listener removed, error rethrown, caller's reconnect retries in 2 s | `routers/queue.ts` `subscribe` and the projection's `onError` |
| A direct send starts while an item is queued | Dispatch refuses because `chat.status` is no longer `ready` | `queue-projection.test.ts` "never asks while the window's own send is in flight" |
| Payload past a cap | zod rejects at the router boundary | `queue.test.ts` bounded-shape test, `queue-state.test.ts` "rejects a payload outside the bounded shape" |
| Attachment-only send with no text | The builder emits a text part only when text or mentions exist | `queue-parts.test.ts` |
| Chat history paste | `chatHistory:` prefix is kept, matching a direct send | `queue-parts.test.ts` |

## Attempts to break the change, and what they caught

1. **Dispatch racing a direct send.** The first version resumed a paused queue
   before the user's send reached the chat. The app-wide status store is written
   by a React effect, so it can still say `ready` for a render after
   `sendMessage` was called, and the wake could have claimed an item and sent it
   in parallel with the user's own message. Fixed by gating the dispatch on
   `chat.status === "ready"` as well as the store, and by moving each direct
   send's `resumeQueue` call to sit beside the send itself.
2. **Send now resuming before claiming.** The first version called
   `setPaused(false)` and then claimed the chosen row. The resume produces a
   feed change, and the wake it causes could have claimed the head of the queue
   first, so the user's pick would arrive second and both would send. Fixed by
   claiming the chosen row first and resuming after the send starts.
3. **A failure loop.** A failed send put the row back and left the status
   `ready`, so the feed change from the requeue immediately claimed the same row
   again. Fixed by marking the pane `error` before the requeue lands. The old
   component retried on `error` and could loop; this change stops after one
   attempt and leaves the row for an explicit send, which is called out in the
   PR as a deliberate behaviour change.
4. **Move semantics under a drain.** Excluding `sending` rows from the anchor
   domain put a moved row ahead of the row in flight. Fixed by picking the
   anchor among visible rows and inserting among all rows.
5. **Claim under two connections.** The store test now opens a second SQLite
   connection on the same file with the same migrations and races both claims.
   One row leaves. This is the strongest form of the acceptance criterion that a
   unit test can reach here.
6. **Claim with a paused queue.** A paused row blocks dispatch, but Send now
   must still work, so the claim's allowed-set differs by call: `pending` for a
   dispatch, `pending` or `paused` for Send now.

## What was not attempted, and why

- No real two-window run. The sandbox has no Electron display, so the
  two-window proof is the two-connection store test plus the router mock, and
  the manual checklist in the PR names the two-window click-through.
- No measurement of a real send. The manual checklist in the PR covers the
  reload, the stop, and the two-window behaviours on a real build.
