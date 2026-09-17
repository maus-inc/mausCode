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

### Where this departs from the step text, and why

- **§6.2 asks dispatch to mark the row and create the run in one transaction.**
  The mark is here and is one transaction; the *run row* is not created by it,
  because the engine call belongs to the window (decision 1 above), and a run
  row records a turn that actually started. What replaces the "one owner"
  property the step was buying is the conditional `pending -> sending` update:
  it is the one winner, and the run table is still consulted before a dispatch
  (`ACTIVE_RUN_STATUSES`), so a turn that is live in main blocks the queue even
  when a second window's status store says ready.
- **§13 asks for the old renderer store to be kept one release behind as a dead
  module.** It is deleted instead, and the reason is concrete rather than a
  preference: `message-queue-store.ts` imports `AgentQueueItem` and
  `removeQueueItem` from `queue-utils.ts`, and those exist only to feed
  `queue-processor.tsx`, which §1 and §6.4 delete. An inert module would need
  that whole vocabulary restored beside `src/shared/queue-item.ts` — the same
  duplication Sonar already flagged on this PR once (`e65f71f`) — and it would
  restore nothing on its own, because §8 forbids keeping the safety timer "just
  in case" and the timer is what made the old drain work. The rollback path is
  therefore a revert of this branch: migrations `0016`–`0018` only add a table,
  two columns and an index, so a build from before this step ignores them, and
  the rows it finds later are messages a user typed, which the newer build
  recovers. Recorded here so the choice is explicit and reviewable rather than
  silent.

## States

`queue_items.status` is one of three values, declared once in
`src/shared/queue-item.ts`.

| status | meaning |
| --- | --- |
| `pending` | eligible to be handed to a window |
| `paused` | the row is not eligible until the user acts: either a turn was stopped, or the row was parked (see below) |
| `sending` | claimed by exactly one window, which is sending it now |

Two columns carry what the status alone cannot (`drizzle/0017_*`):

- `claimedBy` is the window that holds the row, from the same stable id that
  namespaces its storage. It is what makes a claim the claiming window's to
  finish, and what lets main hand back what a closed window held.
- `handedAt` is written once, immediately before the payload goes to the
  engine, and only by the owner. Null therefore means "this message never
  left", which is the fact everything below is built on.

`sending` rows are hidden from the indicator, matching the old store's pop
before send. `complete` deletes the row; `requeue` returns it to `pending` with
the claim columns cleared.

The outcome vocabulary the renderer records is four-valued, and the hand-off is
what divides it:

- `sent` — the turn reported itself, or the send call resolved (the engine
  consumed the response to a message it accepted). `complete`.
- `failed` — the turn in flight could not be cleared, or the payload could not
  be built, so nothing was handed over. `requeue`, as before.
- `uncertain` — the send call rejected *after* the hand-off, so the message may
  or may not have reached the engine. `park`: the row stays visible as
  `paused`, out of the automatic path, and `setPaused(false)` does not put it
  back, so only the user can resend it.
- `cancelled` — `markHanded` refused because the claim moved on (cleared, or
  taken over). Nothing was sent and nothing is this window's to record.

**Recovery and takeover.** `recoverSending()` splits by `handedAt`: rows never
handed over go back to `pending`, because nothing left; rows that were handed
over are parked, because the message may already have been sent and resending
is the only way to duplicate it. A claim abandoned while the app runs is
settled by, in order: the window-closed hook in `window-manager.ts` (exact —
main knows which window died), the claim lease `CLAIM_LEASE_MS = 45_000` (a
claim older than the longest wait on the send path is nobody's), and the
same-window rule in `claim` (a handed row of *this* window means the session
that owned it is gone, e.g. a reload; it is parked and the queue moves on).
A parked row does not block dispatch: only a `paused` row with a null
`handedAt` — a pause the user asked for — stops the queue.

## Ordering

`position` is an integer with gaps, `POSITION_STEP = 1024`. An insert takes
`max(position) + POSITION_STEP`, so an insert never rewrites another row. A move
places the item between its new neighbours at the midpoint; when the gap is
exhausted the store renumbers that sub-chat's rows by the step. `move` takes the
target index among the sub-chat's ordered rows, the same index-to-order reading
`projects.reorder` uses (`src/main/lib/trpc/routers/projects.ts:138`). Ties
break on `createdAt` then `id`, so the order is total.

## The claim rule

`claim({ subChatId, itemId?, owner })` is one transaction over the queue row
and the `runs` table:

- First it releases a claim whose lease ran out (see above), which is the only
  way a row comes back from a renderer that died without closing its window.
- Without `itemId` it is a dispatch: the oldest `pending` row for the sub-chat,
  refused while any `running` or `waiting_approval` run exists for that
  sub-chat, and refused while anything for that sub-chat is already `sending`.
- With `itemId` it is Send now: that specific row, no idle gate, because the
  user asked for it and the window stops the current turn first.
- Either way the row is claimed with a conditional update: `status IN
  ('pending')` for a dispatch, `status IN ('pending', 'paused')` for Send now,
  `WHERE id = ?`, and the owner and a null `handedAt` are written with it. The
  caller receives the row only when that update touched it. Two windows racing
  resolve to one winner; the loser gets null. Order is never chosen by a
  window.
- A window that finds a *handed* `sending` row of its own (its previous session
  reloaded) parks that row and continues, and a window that finds any other
  `sending` row is refused. So the one-send-at-a-time rule holds per sub-chat,
  and a message that left is never sent again by the automatic path.

This is the whole dispatch. There is no `dispatched` state waiting for a window,
because the only actor that can send is a window.

## The wake sources

The renderer projection asks main for work on exactly three events, never on a
timer:

1. the queue feed delivers a change (snapshot on subscribe, then live),
2. the sub-chat's streaming status turns `ready`,
3. the projection starts, which is what a reload and a window open do.

A question main never answered — no pane could send it, or the claim call
failed on its way out — is re-asked on a bounded budget: 2 s later, at most
six questions per sequence. That is a bound on the re-asks of a wake, not a
poll: it is scheduled only when a wake went unanswered, it stops as soon as
main answers, and six failures leave the row visible on the card instead of
asking forever.

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

Step 08's §2 and §3 cite `queue-processor.tsx:17` as a 7-second sleep and `:23`
as a 2-second interval. The file that was deleted held neither number. At the
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

### What the deleted safety interval was load-bearing for

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

A third class the interval covered is a wake whose question to main failed on
its way out — a claim call that threw. Nothing changed in main then, so no feed
event is coming to re-ask, and the interval was what eventually retried it. This
step re-asks on a bounded budget instead (2 s, six questions), and a question
that fails six times leaves the row visible on the card rather than asking
forever. One case is deliberately left to a later wake: a claim that *did* reach
main but whose answer was lost leaves a `sending` row the window owns, and it is
only released by the lease inside a later claim — the lease is a staleness
bound, not a poll, which is the same assumption "a wake the projection misses
cannot lose an item" rests on. The bounded interval this step
did adopt is `CLAIM_LEASE_MS`, and it is a staleness bound on a claim, not a
poll: it is read only inside a `claim` that a wake asked for.

## Surfaces

- `src/main/lib/queue/queue-state.ts` and `index.ts`
- `src/main/lib/trpc/routers/queue.ts`: `add`, `remove`, `move`, `clear`,
  `list`, `subscribe`, `claim`, `markHanded`, `park`, `complete`, `requeue`,
  `setPaused`
- `src/main/lib/db/schema/index.ts`: the `queue_items` table, its ordering
  index (`sub_chat_id`, `position`, `created_at`) and the two claim columns
- `drizzle/0016_*.sql`, `drizzle/0017_*.sql` and `drizzle/0018_*.sql`: generated
  by `npm run db:generate`. `0018` replaces the single-column index with the
  ordering index the claim and list queries both read.
- `src/main/windows/window-manager.ts`: the window-closed hook that hands a
  dead window's claims back
- `src/main/lib/db/test-fixtures.ts`: the shared database fixtures the store
  and router tests both use
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
  prefixes, kept in a light module so the parts builder needs no editor. It is
  the agents table, not the mentions system's `features/mentions/types/core.ts`:
  the two overlap on eight prefixes but each carries entries the other does not
  (`chatHistory:` here, `symbol:`/`github:issue:`/`github:pr:` there), so merging
  them would change what a queued token means

## Consequences named on purpose

- The composer's conversions are checked against the payload schema by
  `src/renderer/features/agents/lib/queue-utils.test.ts`, because the two live on
  opposite sides of the process boundary and a field one writes that the other
  refuses costs the user the whole queued message.

- A closed window means nothing sends until a window is open again. The message
  is not lost; it is a row.
- A window that dies between claim and send leaves a `sending` row. It is
  settled without a restart: the window-closed hook releases it exactly, the
  lease releases it after 45 s, and startup recovery splits it. Nothing on that
  path can send a message twice, because only a null `handedAt` returns to
  `pending`, and a null `handedAt` means the payload never left.
  - The remaining window is a *handed* row whose owner vanished: the message is
    in the engine's hands, so it is parked (visible, never resent on its own)
    rather than returned to the queue. The interval in the lease is the same
    question §15 hands to steps 16 and 19 — how long a claim is trusted — and
    the answer here is "longer than the longest send-path wait", not a
    heartbeat.
- The other eleven provider routers still write no run row, a gap step 07 filed
  as its own follow-up. Main cannot see their turn as busy; the claiming
  window's status is the guard, as it is today.
- A local send failure leaves the pane marked `error` with the item back in the
  queue; the run feed deliberately does not clear an error that no run row
  explains, so the user sees the failure and can retry with Send now.
- A queued file keeps its metadata, not its bytes: `queuedFileSchema` is url,
  media type, filename and size, so a queued attachment whose url was a
  `blob:` from the upload hook is not readable after a restart. The deleted
  renderer store had the same shape, so this is not a regression from this
  step; carrying bytes would be a payload-contract change with its own caps.
  Images do carry `base64Data` and survive.
- A second window that holds the same sub-chat on one of the eleven engines
  that write no run row cannot tell the first window's live turn from an idle
  chat, because the status store is the only cross-window signal and nothing
  hydrates it for those engines. Send now from that window is the exposure;
  requiring a hydrated status instead would refuse Send now there, which the
  one-rule-for-all-engines contract of this step does not allow.

## Tightened in review

The round-five review found six rules the design stated but the code did not yet
hold. Each one now has a test that fails without it:

- `requeue` is owner-scoped like `markHanded`, and only applies to a claim that
  was never handed over. Another window's row is not this window's to release,
  and a handed row's message may already be in the engine, so putting it back to
  `pending` is the one write that could send it twice
  (`refuses to requeue a row that another window claimed`, `refuses to requeue a
  row that was already handed over`).
- An explicit queue add resumes only rows the user's stop held back
  (`resumePausedTx` now requires a null `handedAt`, the guard `setPaused(false)`
  and the dispatch gate already used), so queueing a message can no longer flip
  a parked row into the automatic path
  (`keeps a parked row out of the automatic path when the user queues another
  message`).
- The wake-retry count belongs to the sequence, not to the attempt. Dropping it
  as each timer fired restarted the sequence every two seconds, so
  `WAKE_RETRY_LIMIT` bounded nothing; it is now dropped when main answers or the
  queue is gone (`stops re-asking a pane that never showed up, instead of
  polling for it`). The pending timers are tracked and go with the subscription
  (`cancels a pending retry when the sync stops`).
- A send call that never settles does not hold its row `sending` for the life of
  the window. Past `SEND_SETTLE_GRACE_MS` (five minutes) after the turn-start
  wait, the hand-off is parked like any other unconfirmed one
  (`parks the hand-off when the send call never settles after the wait`).
- A clear that failed forgets the "this sub-chat has no rows" mark, so the rows
  main still has are not stranded, and Send now hands its claim back when it
  races a deletion instead of leaving the row `sending`
  (`forgets a clear that failed, so the rows main still has can be sent`, `hands
  the row back when Send now races the sub-chat's deletion`).
- The loading mark a queued send sets is cleared on the path where the send
  resolves without any turn reporting itself, which is the only path nothing
  else clears it (`records the hand-off before the payload leaves and retires
  the row`).

### Round six

Two review findings, each fixed with a test that fails without the fix:

- A clear that failed put the card back, not only the "this sub-chat has no
  rows" mark. Main still has those rows then, so an empty card showed a queue
  the user believed was gone (`puts the card back when the clear does not
  land`).
- A wake that arrives while a retry is already pending spends nothing. The
  pending retry is already the next question for that sub-chat; clearing and
  replacing it let a burst of feed updates spend the whole budget on newer
  timers, so the pane that finally arrived had no retry left (`does not spend a
  retry on wakes that arrive while one is pending`).

Self-triage in the same commit, after the review round:

- The two hooks between the app and the store had no test. Startup recovery
  retries instead of leaving rows claimed and returns instead of blocking the
  app; the window-close release swallows a failure so the window still closes
  and shares one store with recovery (`src/main/lib/queue/index.test.ts`).
- The schema comment on `claimedBy` still described a renderer session token,
  which `ownerFor` does not write: it writes the stable window id, on purpose,
  because a reload keeps that id and so the reloaded window can park its own
  handed row at once instead of waiting out the lease. The comment was
  corrected, and the choice is now stated with its reason.
- Paths whose answer the UI acts on got their own tests: the scroll signal
  fires only for a hand-off and is dropped when the pane unmounts
  (`queue-send.test.ts`); a refused add is reported so the composer keeps the
  draft; a refused pause is reported so the stop button can warn; and the card
  is the payload plus the row's identity, with the row in flight still counted
  (`queue-projection.test.ts`).
- Every action that can fail now says so, because the card is never updated
  optimistically: the X reports a removal that did not land instead of looking
  like a no-op, and a send reports a resume that did not land, since the rows
  the stop held back would otherwise stay paused in silence
  (`queue-projection.test.ts`).
- The router's cap test now pins the boundary — a payload at the cap is
  accepted, one character past it is refused — and its remove/clear test
  asserts which row survived instead of a filler `toBeDefined()`.

### Round nine

The same sweep over everything the step added on the renderer side and at the
boundary: forty mutations across the projection, the sender, the part builder,
the router, the composer's conversions and the status store. Nineteen survivors,
seventeen now pinned, two verdicts stated as *not* holes. The pattern in the
seventeen is the same one every time: a test that computed its expectation with
the same function it was testing, so it held under either behaviour, or a fake
that never produced the situation.

**The projection** (five): a reconnect did not drop cards main no longer has, so
another window's clear would survive in the card
(`drops cards main no longer has when the feed reconnects`); the owner a window
claims under — the window id, since the real client carries none — was never
exercised, and main keys a claim *and* a closed window's release by that id
(`names this window when the client does not, which is what main keys a claim
by`); two quick Send now clicks could both reach main, which hands out one row
per request, so both rows went out for one sub-chat
(`ignores a second Send now while the first is still working`); a claim main
answered did not end its retry sequence, so a later transient failure inherited
a spent budget (`asks again after a later failure once main has answered a
claim`); a wake for a sub-chat with nothing queued started a timer to ask a
question with no work behind it (`does not re-ask for a sub-chat with nothing
queued`).

**The sender** (two): a transport that *throws* on the way in was answered
`failed` — the payload was already handed over, so the caller requeues a row
that was sent, which is the one way to send it twice. It parks now, like a
rejection (`parks the outcome when the send throws after the hand-off`). And the
sidebar's loading mark was never actually set in a test, because the fake
answered no parent chat id (`marks the sub-chat loading before the payload
leaves, for the sidebar`).

**The part builder** (three): the tokens were never asserted as a whole, so
gluing them together (or dropping the space before the text) survived — a direct
send joins them with spaces, and a glued pair is one malformed mention and a
lost selection (`separates the mention tokens and the message the way a direct
send does`); every preview expectation was computed with `createTextPreview`
itself, so sanitizing the delimiters out of a preview was unobservable even
though a `:` ends the preview field and a `]` ends the token
(`strips the delimiters out of a preview, so the engine still reads one
token`); the image part was only checked for its `type`, so the base64 bytes
could be dropped and the engine would receive a queued image it never sees
(`carries the image bytes and the file metadata through to the part`).

**The router** (five): the replay/listener handshake had no test for its whole
point — the listener is registered first so nothing slips between the two
halves, and a change landing during the read is buffered and flushed *after* the
snapshot; flushing it first has the window apply an older snapshot on top of a
newer change (`replays the snapshot before anything that lands while it is
reading`). A feed opened for one sub-chat was never checked to be that
sub-chat's only (`does not feed a window the changes of another sub-chat`). A
failed replay leaked its listener for the life of the process
(`leaves no listener behind when the replay fails`). And the boundary's two
tightened rules from round seven — a move index that cannot be negative, and a
claim that must name its window — were enforced but unasserted, which is how a
schema loosens unnoticed
(`refuses a move to a negative index and a claim with no window`).

**The composer's conversions** (four): the image media-type default is what
keeps an unlabelled upload inside the boundary's schema, and dropping it costs
the whole queued message; the file size, the diff line type and a paste's
`kind` were all carried but never asserted — the last one is not cosmetic,
because a chat-history paste with no `kind` arrives as `@[pasted:...]`
(`carries every composer field the boundary keeps, including the image
default`). And `createTextPreview` was only exercised through a string of
identical characters, which hides the head/tail question, the short-text case
and whitespace collapsing; the last one matters because the preview is
serialized *inside* a one-line `@[...]` token
(`collapses whitespace, keeps the head and leaves a short preview alone`, plus
the token-level `not.toContain("\n")` in the part-builder preview test).

**The status store** (five): `submitted` was not counted as a live turn, so the
sender could let a queue start a second turn on a session that already has one;
`clearStatus` could be a no-op, leaving a finished sub-chat reading as streaming
for the rest of the session; and `waitForStreamingReady` — which the direct-send
path calls on every send that waits — could keep its store listener on both
success and timeout, one listener per message the user sends. All four now
asserted, the listener releases by counting them through a `subscribe` spy.

**Not holes.** The reconnect path has two independent defences — the `stopped`
flag in `connect` and the cleared retry timer in the stop — and removing either
alone is invisible because the other covers it; both were removed together to
prove the new test fails (`does not reopen the feed after the sync has stopped`),
and what the test pins is the behaviour the pair produces. And
`getReadySubChats` in the status store: it has no caller anywhere in the tree,
and had none at the branch point either, so no mutation of it can change
anything the app does. Deleting it is a tidy-up for another step, not a step-08
verdict, and pinning dead code would be worse than leaving it alone.

### Round eight

A systematic sweep: every guard and every announcement in the main store was
removed one at a time, and the suite was re-run to see which removals nothing
noticed. Thirteen mutations, three holes, all three now closed:

- **A user pause was not what stopped a dispatch.** `pause`'s first test held
  *every* row, so the dispatch query found no `pending` row at all and the
  `userPausedTx` guard never had to do anything; removing it changed nothing.
  The guard's real job is the mixed state: Send now claims a held row, the send
  fails before the hand-off, and the row comes back `pending` while its
  siblings are still `paused`. Without the guard the automatic path takes it,
  which is exactly what the user's stop said not to do. `holds a row that came
  back while the user's stop still stands` fails when the guard is removed.
- **Recovery's two halves were each masked by the other's absence.** The two
  existing recovery tests each had only one kind of `sending` row, so a
  never-handed query that also matched handed rows never met a handed row.
  `splits recovery by the hand-off when both kinds of row are waiting` puts both
  in one pass (two sub-chats, one database) and fails when the query loses
  `isNull(handedAt)` — the case where a message that may already be in the
  engine is sent again.
- **The feed's whole surface was pinned for two writes out of eight.** `add`
  and `remove` had announcement tests; `clear`, `move`, `setPaused`, `park`,
  `complete` and `requeue` did not, and every card in every window is fed only
  by that feed. `announces every write, because a card is fed only by the feed`
  covers all of them and fails when any one emit is dropped. It also records the
  one deliberate silence: `markHanded` says nothing, because the row is
  `sending` before and after and a `sending` row is hidden by every card and
  counted the same either way — `handedAt` is read only by this store. That
  expectation is written into the test, because the first version of the test
  assumed an announcement and the store was right.

The verdicts for the other ten mutations: the claim's busy check, its own-handed
park, the run-table gate, the pause gate on resume, `markHanded`'s single
hand-off, `recoverSending`'s split, `add`'s resume, `remove`'s sub-chat scope,
and `add`'s announcement each fail their covering test when removed.

### Round seven

Review findings (CodeRabbit `5240377372` and CodeAnt's second pass), each
verified against the code before acting:

- **Fixed**: `park` and `complete` were the only writes after a claim with no
  owner scope, although `markHanded` and `requeue` both had one. A stale card in
  a second window, or a second window's click, could park a row another window
  was sending, and the sender's own `complete` then failed: a message that had
  already gone out stayed on the card as something the user could send again.
  Both now carry the owner in the where clause
  (`refuses to park or complete a row another window claimed`, `refuses a
  complete from a window that does not hold the claim`).
- **Fixed**: a clear that failed restored the card it captured before the drop,
  even when the feed had spoken in between. That reading is newer than the
  snapshot, so the restore could hide a row that had just arrived. The restore
  now happens only when the projection holds nothing for the sub-chat
  (`keeps what the feed says after a clear that does not land`).
- **Fixed (test)**: the failed-clear test let the send retire the row before the
  clear ran, so it asserted the restore over a queue main no longer had. The
  chat is now streaming, which is the state the rule is about: a pending row and
  a clear that did not land.
- **Guarded**: the renderer's fakes ignored the owner on `park` and `complete`,
  so a projection that stopped naming the claiming window would not have failed
  anything — and in main those writes match the owner, so the row would have
  stayed `sending` with nobody to settle it. Both tests now assert the window
  they name (`parkedBy` / `completedBy`), and each assertion fails when the
  owner is changed to another id.
- **Found by mutation, then pinned**: the claim's conditional `UPDATE` — the
  step's two-window rule — was covered by no test that fails without it. Every
  existing race test exercises the *busy check above* the update (a dispatch
  claim, where the read finds no row for the asker), and the one path that
  reaches the update with a row already `sending` is a claim **by id**: the read
  names the same row the busy check would have refused, so the branch is skipped
  and only the `status IN (pending, paused)` guard stands between a second
  window — a stale card, an impatient second click — and taking a message away
  from the window that is sending it. With the guard removed, that second claim
  returns the row. `refuses another window that asks for a row by id while it is
  being sent` covers the pre-hand-off and post-hand-off cases, and fails when the
  guard is removed.
- **Found by mutation, then strengthened**: the reload test's name promised
  "in order", but two items added in sequence have both position and
  `createdAt` in insertion order, so dropping `order by position` left it green.
  A move now precedes the reload, and the test fails when the order clause loses
  `position`.
- **Skipped, with the reason**: `remove` (the card's own X) and `clear` (the
  sub-chat deletion) stay ownerless, because they are the user's intent, as
  recorded above; and `owner` stays a value the renderer names, because it is a
  liveness label — live window versus one that reloaded or closed — and not an
  authorization principal. Every window runs the same trusted bundle with the
  same capabilities, so moving the id into main's IPC context adds no privilege
  boundary, while a wrong mapping would break the reload parking this step
  depends on.
- **Skipped**: cross-window Send now on the engines that write no run row. That
  is the exposure `## Consequences named on purpose` already names, and the
  step's one-rule-for-all-engines contract forbids per-provider run wiring here.

Self-triage after the review round, before the commit:

- Every action that can fail now says so (above): the X and the resume report
  instead of logging only.
- A claim call that never reached main was logged and dropped. Nothing changes
  in main then, so no later feed event is coming to re-ask, and a sub-chat that
  is already `ready` will not turn ready again — the row sat on the card with
  nothing that would dispatch it until some unrelated event. It is now re-asked
  on the same bounded budget a wake with no pane spends
  (`asks again when the claim never reached main, and sends the row when it
  does`), and the budget still bounds it (`stops asking after a bounded number
  of failing claims, instead of polling`). The counter is therefore dropped when
  main answers, not when the pane is present: a claim failure has a pane, and
  dropping it there would restart the sequence on every retry.
- The residual is named in the handoff below: a claim that did reach main but
  whose answer was lost still needs a later wake, because the lease is only read
  inside a claim a wake asked for.

## Verification

`bun x biome check . && npm run typecheck && npm run test` plus
`node scripts/ci/lint-changed.mjs`. The store tests in
`src/main/lib/queue/queue-state.test.ts` cover the step's named scenarios
(reload with items pending, two windows adding, two windows claiming, move while
draining, cancel leaving the queue intact); the router test covers the wire
surface; `queue-projection.test.ts` covers the renderer's wake and hand-back
rules; `queue-parts.test.ts` covers the payload expansion.
