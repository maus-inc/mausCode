## 0. Meta

| Field | Value |
| --- | --- |
| Step | 17 of 35, parity P3 and P4 ordering |
| Area | renderer, main |
| Risk | medium |
| Depends on | {{S04}} decision 2, {{S07}}, {{S08}} |
| Blocks | {{S18}}, {{S19}}, {{S25}} |
| Estimate | medium |

## 1. Outcome

Creating a sub-chat feels immediate and never doubles, panes and sub-chats can be ordered and that order is stored, and the details sidebar stops re-parsing a JSON blob per read.

## 2. Why it matters

A new sub-chat awaits a round trip before the pane appears, and the backend silently no-ops when asked to update a sub-chat that does not exist yet, which is how a lost message hides. `chats.get` returns the whole row including message history, and file statistics are re-parsed from a JSON blob on every read. The ordering claim in the parity plan is half true and worth stating exactly: projects already have `sort_order` and a reorder procedure, sub-chats have neither.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| `chats.get` returns the full chat row while `list` selects a narrowed column set, so the fix is copying an existing pattern | `src/main/lib/trpc/routers/chats.ts:407` against `:329` | recorded at `1a37e0b`, re-verify before editing |
| The silent no-op: a fire-and-forget block reading `existing?.messages \|\| "[]"` with no error path | `src/main/lib/trpc/routers/claude.ts:999-1006` | recorded, and the file named in the older plan does not exist |
| `getFileStats` re-parses a JSON blob per call | `chats.ts:1763` | recorded |
| Sub-chat sidebar awaits at `:1097-1135` | `src/renderer/features/sidebar/agents-sidebar.tsx` | recorded, and this file is capped at plus 300 lines |
| Projects have ordering, sub-chats do not | `src/main/lib/db/schema/index.ts:25`, `src/main/lib/trpc/routers/projects.ts:138` | E1, this session |
| Split cap constant to respect | `src/renderer/features/agents/stores/sub-chat-store.ts:10` `MAX_SPLIT_PANES = 4` | recorded |

## 4. Read first, and what already exists

`projects.reorder` at `src/main/lib/trpc/routers/projects.ts:138` is the procedure to mirror, including its rule that the array index becomes `sort_order`. `sub-chat-store.ts` already owns pane membership and normalisation, so ordering belongs there, not in the sidebar. `docs/design-system-baseline.md` governs the affordance. The plan's non-negotiable forbids rewriting `agents-sidebar.tsx`, so consume, do not restructure.

## 6. Implementation plan

1. Optimistic create at the three call sites: insert a placeholder row in the store keyed by a client id, send, then reconcile by replacing the client id with the server id. Roll back on error and say what failed.
2. Guard against double submit for the same pending create, and auto-delete an empty sub-chat that was never sent to, so a stray click does not litter the rail.
3. Backend: make the update path raise instead of no-op when the sub-chat is missing, and let the create accept a client id so an optimistic row can be settled against a real one.
4. Add `sub_chats.sortOrder`, nullable with a default of 0, in one generated migration, plus `reorderSubChats` mirroring the projects procedure. Backfill existing rows by current creation order in a separate migration, per the expand and contract rule.
5. `chats.get`: select the narrowed column set the way `list` already does, and cache `fileCount`, `additions` and `deletions` as columns updated where the stats are computed, so the sidebar reads numbers rather than parsing a blob.
6. Drag to split and drag to reorder, using the native HTML5 path the ratified decision names. Pinned panes stay pinned through a reorder, which is the case a naive index sort breaks.
7. Tests: create reconciliation including the failure rollback, reorder persistence across a reload, and a `chats.get` payload assertion that pins the narrowed shape.

## 8. Boundaries

- Always: new columns nullable or defaulted, and schema and backfill in separate migrations.
- Ask first: changing what `chats.get` returns, since every consumer reads it. Ship the new procedure or field alongside and move consumers.
- Never: edit `agents-sidebar.tsx` beyond consuming, add a dependency for drag and drop, or key a reorderable row by array index.

## 10. Acceptance criteria

- [ ] A new sub-chat appears before the server responds, and a failed create leaves nothing behind.
- [ ] Two rapid clicks create one sub-chat, proven by a test against a mock peer.
- [ ] Order survives a reload and a window resize, and a pinned pane keeps its position.
- [ ] `chats.get` no longer returns the message blob for the surfaces that do not need it, with the payload size recorded.
- [ ] A missing sub-chat on update raises, with a test that fails on the current no-op.

## 11. Verification

```sh
npm run db:generate && git diff drizzle/
npm run test && npm run typecheck && bun x biome check .
```

## 12. Benchmark record

Sub-chat create latency, perceived, measured at the click-to-empty-pane interval, and `chats.get` payload bytes before and after, in `.dump/app/benchmarks/`.

## 13. Rollback

Optimistic create is local to the store, so revert is clean. The column stays, unread.

## 14. Out of scope

Tab groups and approve or reject flows, which are {{S18}}. Fan-out from a plan, which is {{S19}}. The `queue` reorder is step 08's surface.

## 15. Handoff notes

Record the client id reconciliation protocol in `.dump/app/plans/2026-09-13-subchat-optimistic.md`, because {{S19}} creates many sub-chats at once and needs the same rule.
