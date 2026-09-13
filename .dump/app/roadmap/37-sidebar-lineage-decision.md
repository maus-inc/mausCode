## 0. Meta

| Field | Value |
| --- | --- |
| Step | 37 of 42, the fork harvest, the lineage decision the catalog demands |
| Area | renderer, db |
| Risk | high, it decides which sidebar history we keep |
| Depends on | {{S17}}, {{S18}}, {{S36}} |
| Blocks | {{S42}} |
| Estimate | medium |

## 1. Outcome

One sidebar lineage is chosen and written down, and from the winning line we ship drag reorder of sub-chats, sub-chat archive, and the project emoji picker.

## 2. Why it matters

Care flag 1 in `.dump/ci/research/fork-network-harvest-catalog.md` is explicit: two sidebar lineages conflict, erenbertr's sub-chat rework against sylvaindiv's dnd reorder plus archive, and the instruction is to choose one rather than merge both. Our tree already contains erenbertr's side, verified this session: `sub-chat-selector.tsx`, `sub-chat-status-card.tsx`, `sub-chat-store.ts` and `use-changed-files-tracking.ts` exist, and sylvaindiv's own row also carried database migrations we must not copy. Without the decision, whoever implements drag reorder merges two incompatible orderings and the result is a rail that reorders itself.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The conflict and the instruction to pick one lineage | `.dump/ci/research/fork-network-harvest-catalog.md` care flag 1, Category C row for `sylvaindiv` | E1, this session |
| erenbertr's side is already in the tree | `src/renderer/features/agents/ui/sub-chat-selector.tsx`, `sub-chat-status-card.tsx`, `stores/sub-chat-store.ts` | E1, this session |
| Sub-chats have no archive column, while chats do | the `subChats` definition in `src/main/lib/db/schema/index.ts` lists `name`, `chatId`, `sessionId`, `streamId`, `mode`, `provider`, `messages`, timestamps and no `archivedAt`; chats carry it at `:48` | E1, this session |
| Ordering precedent to reuse, not reinvent | `projects.sortOrder` at `db/schema/index.ts:25`, reorder at `routers/projects.ts:138` | E1, this session |
| sylvaindiv's row also claims new modes and a dev-server router we already have | `src/main/lib/trpc/routers/dev-server.ts` exists, and the five modes are ratified in `AGENTS.md` | E1, this session |
| No emoji picker anywhere | `git ls-files` scan for emoji returns nothing | E3, this session |

## 4. Read first, and what already exists

Step 17 owns the `sortOrder` column and the reorder procedure for sub-chats, which is exactly the mechanism sylvaindiv reimplemented differently. Read `sub-chat-store.ts` normalisation before adding archive, and `docs/design-system-baseline.md` for the row treatment of a dismissed item.

## 6. Implementation plan

1. Write the decision first, in `.dump/app/decisions/2026-09-13-sidebar-lineage.md`: erenbertr's line wins, sylvaindiv contributes three named behaviours, and no migration of theirs is taken. The reasons are the tree state above.
2. Reorder: build on step 17's `sort_order`, drag and drop through the native path decided in step 04, with pinned sub-chats excluded from reordering and a test proving a pinned row keeps its place.
3. Archive: `sub_chats.archivedAt`, nullable, one migration, an archived section that is collapsed by default, and restore. Unarchive returns a row to its previous position, not the end.
4. Emoji picker: per-project and per-session accent, reusing the `accentColor` column that already exists on chats at `db/schema/index.ts:60`, so this is a picker and a renderer, not a new schema.
5. Delete whatever the losing lineage would have added, so the merge is not re-attempted, and say in the ledger why.
6. Ask the human with a prototype before implementing the archived section's placement, since that is layout, and again for the picker's entry point.

## 8. Boundaries

- Always: one lineage recorded in writing, new columns nullable, and the fork ledger updated in the same PR.
- Ask first: any change to what the rail shows by default, and the archive semantics for a sub-chat with a live run.
- Never: a migration file copied from a fork, both lineages reconciled by hand inside one component, or an emoji field that becomes a second source of colour truth.

## 10. Acceptance criteria

- [ ] A decision file exists naming the chosen lineage and the three adopted behaviours, with the rejected ones listed.
- [ ] Drag reorder persists across reload and resize, and pinned rows do not move.
- [ ] Archive, restore and the live-run case each have a test, and an archived sub-chat cannot be silently deleted by the cleanup in `sub-chat-runtime-cleanup.ts`.
- [ ] Colour and emoji come from one column, and the sidebar and the tab both read it.
- [ ] The catalog's Category C row for sylvaindiv is checked with the lineage note attached.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
npm run db:generate && git diff drizzle/     # read the SQL
```

## 13. Rollback

Archive is a nullable column the old code ignores, so revert is clean. Revert the reorder and picker independently.

## 14. Out of scope

The details-sidebar polish, which {{S36}} owns, and any redesign of the rail's information architecture, which is not in the harvest and not approved here.

## 15. Handoff notes

Also record the emoji and archive affordances in `.dump/app/second-brain.md` surfaces list, since {{S25}} and {{S41}} both touch the rail and will otherwise duplicate the picker.
