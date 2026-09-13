## 0. Meta

| Field | Value |
| --- | --- |
| Step | 36 of 45, the fork harvest, Category A remainder |
| Area | renderer, main |
| Risk | medium |
| Depends on | {{S17}}, {{S25}} |
| Blocks | {{S37}} |
| Estimate | medium |

## 1. Outcome

The two unchecked rows of the approved harvest are closed: the usage footer renders the quota the router already computes, and the sidebar does the three quality-of-life things the fork had, restore the previously opened chat, a file refresh button, and manual reorder.

## 2. Why it matters

`.dump/ci/research/fork-network-harvest-catalog.md` marks Category A as user-approved, "everything except kanban, the mind-map builder and their deletions", and lists every row as transplanted except two: `Sidebar QoL` and `Details-sidebar / misc polish`. The measurement I took this session shows why the ledger is nearly right and where it is not: twelve chat transports exist, and `auto-rename.ts`, `use-changed-files-tracking.ts`, `sub-chat-selector.tsx`, `sub-chat-status-card.tsx`, `mcp-servers-indicator.tsx`, `agent-preview.tsx` and `agent-thinking-tool.tsx` all exist, so the payload landed. `usage-widget.tsx` does not exist by that name, only `src/renderer/features/details-sidebar/widget-settings-popup.tsx`, and the catalog itself defers the footer UI to a later phase, so the number is real and the surface is not.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Category A rows and the two unchecked ones | `.dump/ci/research/fork-network-harvest-catalog.md`, Category A ledger | E1, this session |
| Usage router exists with the read path | `src/main/lib/trpc/routers/claude-usage.ts` | E1, this session |
| No `usage-widget.tsx`; a settings popup exists in the same feature area | `src/renderer/features/details-sidebar/widget-settings-popup.tsx`, and a `git ls-files` scan for `usage-widget` returning nothing | E3, this session |
| The fork's own exclusion list is a constraint on this step | same catalog, "EXCLUDED by user: kanban, mind-map, feature removals" | E1 |
| Chats carry `archivedAt`, sub-chats do not | `src/main/lib/db/schema/index.ts:48`, and the `subChats` definition read this session | E1 |
| Projects already reorder; chats and sub-chats do not | `src/main/lib/trpc/routers/projects.ts:138` | E1, this session |

## 4. Read first, and what already exists

`docs/design-system-baseline.md`, then step 17's ordering work, which this step extends rather than duplicates. Read `src/renderer/features/details-sidebar/widget-settings-popup.tsx` before adding a widget, because the pattern for a sidebar widget with settings already exists.

## 6. Implementation plan

1. Usage footer: render quota percentage, an orange state at 80 percent, and the reset-time label, from the existing router, in the status surface the design baseline prescribes. No polling faster than one fetch per window focus.
2. Restore previously opened chat on launch, from the last-updated chat in the project, and make it a setting because an unexpected restore is as annoying as no restore.
3. A file refresh button on the changed-files list, calling the existing status read rather than a new one.
4. Manual reorder for chats in the sidebar, reusing the `sort_order` convention from step 17, and keep pinned items pinned.
5. Details-sidebar polish limited to what the fork diff actually shows, each item one commit, and every item that is already better here is recorded as skipped with the reason.
6. Update the catalog's checkboxes and action log in the same PR, per the catalog's rule that the ledger stays live.

## 8. Boundaries

- Always: never take a deletion from a fork, keep attribution comments where the code came from a fork, and update the harvest ledger in the same change.
- Ask first: the layout and density of the usage footer and the reorder affordance, which are design calls with a prototype and two or three options.
- Never: a blind `git cherry-pick` from a fork, a migration copied from a fork, or kanban and the mind-map builder resurfacing under another name.

## 10. Acceptance criteria

- [ ] The footer shows the same numbers the router returns, with a test on the formatting of the 80 percent threshold.
- [ ] Reopening the app returns to the last chat, and a setting turns that off.
- [ ] Manual reorder persists across a reload and a window resize.
- [ ] The catalog shows both rows checked, with the file-level notes the ledger asks for.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
```

## 13. Rollback

Per item, one commit each. The column added by step 17 is shared, so revert the writer, not the column.

## 14. Out of scope

The sidebar lineage decision, which is {{S37}}. Emoji picker, archive and drag-reorder for sub-chats also belong there, not here.

## 15. Handoff notes

Record what the fork had that we now do better in `.dump/ci/research/2026-09-13-harvest-closeout.md`, since {{S42}} closes the ledger with that list.
