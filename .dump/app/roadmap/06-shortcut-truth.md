## 0. Meta

| Field | Value |
| --- | --- |
| Step | 06 of 45, parity P4 shortcut layer |
| Area | renderer |
| Risk | medium |
| Depends on | {{S01}} |
| Blocks | {{S14}}, {{S17}} |
| Estimate | medium |

## 1. Outcome

Every shortcut id the app maps either performs an action or does not exist. The public shortcuts table only advertises keys that do something.

## 2. Why it matters

The hotkey manager maps 29 ids onto action names while the actions module registers 11, verified this session by counting both lists at `src/renderer/features/agents/lib/agents-hotkeys-manager.ts` and `agents-actions.ts:225-235`. Dispatch ends in a silent return when no action matches, so 19 keystrokes do nothing and say nothing. Several of those keys are printed in `src/renderer/lib/utils/platform.ts` as documented shortcuts, which is how "⌘[ and ⌘] are inert" gets reported as a bug forever.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| 29 mapped ids, 11 registered actions | `agents-hotkeys-manager.ts`, `agents-actions.ts:225-235` | E1, counted this session |
| Silent drop on unknown id | `handleHotkeysAction` in `agents-hotkeys-manager.ts` | E1, confirm the line before editing |
| The 19 inert ids are listed by name, including `create-pr`, `open-diff`, `stop-generation`, `switch-model`, `prev-agent`, `next-agent` | `.dump/app/plans/release-parity-v0.0.75-0.0.84-plan.md` P4 | recorded, re-verify the list |
| Split panes are capped at 4, so `prev-agent` and `next-agent` have real semantics to attach to | `src/renderer/features/agents/stores/sub-chat-store.ts:10` `MAX_SPLIT_PANES` | E1, recorded |
| `create-pr` and `open-diff` are wanted entry points for steps 14 and 15 | `git-operations.ts:543` `createPR` mutation exists today and only opens a compare URL | E1, read this session |

## 4. Read first, and what already exists

`docs/design-system-baseline.md` for keyboard and focus conventions. The actions module is the owner: it already exports the 11 registered actions, and the manager already has the dispatch shape. There is no need for a new registry, a new context, or a settings UI here.

## 6. Implementation plan

1. Produce the reconciliation table in the PR first: every mapped id, its action, whether the action exists, and the verdict wire or delete.
2. Wire the ids whose behaviour already exists in the store: pane navigation and focus, `stop-generation`, `switch-model`, `open-diff`, `toggle-terminal`, `search-chats`, `quick-switch-*`. These are consumers of what is already there.
3. Delete the ids with no owner today: `undo-archive`, `archive-workspace`, `create-pr`, `voice-input` and any other that needs a feature this roadmap has not built. Deleting a binding is not a regression when the key does nothing.
4. For `create-pr` and `open-diff`, leave the ids out until steps {{S14}} and {{S15}} land their real behaviour, then add them back in that step with a test.
5. Fix `platform.ts` so the advertised table is generated from the ids that actually dispatch, which removes the class of drift rather than this instance of it.
6. Add a test that fails when a mapped id has no registered action, which is the prevention for the whole bug class.

## 8. Boundaries

- Always: one owner for the action registry, and a test that keeps the two lists honest.
- Ask first: rebinding a key another surface already uses, including `Cmd+T`, which the sidebar harvest already moved.
- Never: mark a shortcut as working in docs because the id exists, and never fix this by adding a no-op action so the lookup succeeds.

## 10. Acceptance criteria

- [ ] Every id in the manager resolves to a registered action, enforced by a test.
- [ ] Every key in the public shortcuts table performs an observable action, and the removed ids are gone from the table.
- [ ] `active-chat.tsx` and `agents-sidebar.tsx` gain no new logic beyond consuming actions.
- [ ] Biome 0 findings, typecheck 0 errors, tests green.

## 11. Verification

```sh
bun x biome check .
npm run typecheck
npm run test
```

## 13. Rollback

Revert. No persisted data changes, except any localStorage keys you introduce, which this step should avoid.

## 14. Out of scope

Drag to split, queue reordering and `sortOrder`, which are {{S17}}; the PR entry point, which is {{S14}}.

## 15. Handoff notes

Record the reconciliation table in `.dump/app/research/2026-09-13-hotkey-audit.md` and mark the P4 row in the parity plan as done for the shortcut half only.
