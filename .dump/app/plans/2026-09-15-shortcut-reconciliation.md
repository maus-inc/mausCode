# Shortcut layer reconciliation plan

Date: 2026-09-15. Step: issue #8, roadmap step 06, parity P4 shortcut layer.

## Goal

Every shortcut id the app maps either performs an action or does not exist. The public shortcuts table only advertises keys that do something.

## Restatement

Outcome: the shortcut registry, the action registry and the real key handlers agree, enforced by a test. Owner: MausAgent, renderer area. Demo: settings keyboard tab lists only live shortcuts; rebinding works for manager-dispatched ids; `bun x biome check .`, `npm run typecheck`, `npm run test` pass.

## Verified facts this session (E1 reads, all paths opened)

The step's inert list is stale for most ids. Re-verified one by one:

- The manager's `SHORTCUT_TO_ACTION_MAP` (29 entries) is dead code for dispatch. The generic loop iterates `AGENT_ACTIONS` `hotkey` fields instead. Only 10 map entries resolve to the 11 registered actions; 19 map entries point at actions that do not exist.
- Live behaviour for most "inert" ids exists as component-local keydown handlers that ignore custom bindings:
  - `active-chat.tsx` 3288: Esc / Ctrl+C / Cmd+Shift+Backspace stop stream; 4749: Cmd+J terminal; 7353: Cmd+Shift+T new tab, Cmd+T new chat form, Opt+Cmd+T web; 7416: Cmd+W close tab (desktop: the main menu's Close Window accelerator wins first); 7467: Cmd+[ / Cmd+] previous/next tab; 7559: Cmd+D diff sidebar; 7579: Cmd+Shift+E restore archived workspace.
  - `chat-input-area.tsx` 1158: Cmd+/ opens model selector (hardcoded, ignores bindings); 1150 + 1265: voice-input already resolves custom bindings.
  - `sub-chat-selector.tsx` 462: "/" opens sub-chat history search.
  - `agents-sidebar.tsx` 2185: Cmd+K focuses workspace search; 2249: Cmd+E archives current workspace.
  - `details-sidebar.tsx` 270: Cmd+Shift+\ toggles details.
  - `use-focus-input-on-enter.ts`: Enter focuses composer; `use-toggle-focus-on-cmd-esc.ts`: Cmd+Esc toggles focus.
  - `agents-content.tsx` 344: Ctrl+Tab / Opt+Ctrl+Tab hold-to-switch quick switchers, target set by `ctrlTabTargetAtom`.
- `src/renderer/lib/utils/platform.ts` `SHORTCUTS` table and its helpers have zero consumers (dead code).
- `agent-diff-view.tsx` 1953 Cmd+Z is "undo last viewed action", unrelated to the `undo-archive` id.
- Main menu (`src/main/index.ts`) owns Cmd+N (IPC to renderer), Cmd+Shift+N, Cmd+W (Close Window), Cmd+,, Cmd+Q, Cmd+Shift+R.
- No references to `undo-archive` or `create-pr` outside registry, types and the dead map.
- vitest runs `src/**/*.test.ts` in node environment; `agents-actions.ts` and `shortcut-registry.ts` are pure modules, so a colocated test can import both.

## Verdict per id (27 registry ids after deletion, 29 before)

Wire (map to a new or existing action, manager dispatches, custom bindings apply):

| id | action | notes |
| --- | --- | --- |
| show-shortcuts | open-shortcuts | existing special block |
| open-settings | open-settings | existing special block |
| toggle-sidebar | toggle-sidebar | existing special block |
| new-workspace | create-new-agent | IPC owns Cmd+N, "C" alt block reads registry altKeys |
| open-kanban | open-kanban | beta-gated special block; fixes today's ungated generic-loop leak |
| search-in-chat | toggle-chat-search | existing special block |
| file-search | file-search | existing special block |
| new-agent | create-new-agent | Cmd+T moves from active-chat local handler to the manager |
| prev-agent | prev-agent | new action over sub-chat store; deletes active-chat Cmd+[ handler |
| next-agent | next-agent | new action; deletes active-chat Cmd+] handler |
| open-diff | open-diff | new action toggling diffSidebarOpenAtomFamily; deletes active-chat Cmd+D handler |
| toggle-terminal | toggle-terminal | new action toggling terminalSidebarOpenAtomFamily; deletes active-chat Cmd+J handler |
| switch-model | switch-model | new action dispatches the open-in-editor-style event; chat-input-area consumes |
| open-in-editor | open-in-editor | existing |
| open-file-in-editor | open-file-in-editor | existing |

Component-owned (live key, handler stays, id recorded with owner so drift fails the test):

| id | owner |
| --- | --- |
| search-workspaces | agents-sidebar.tsx (Cmd+K) |
| archive-workspace | agents-sidebar.tsx (Cmd+E) |
| quick-switch-workspaces | agents-content.tsx (hold-to-switch, dynamic) |
| quick-switch-agents | agents-content.tsx (hold-to-switch, dynamic) |
| new-agent-split | active-chat.tsx (Cmd+Shift+T) |
| archive-agent | active-chat.tsx (Cmd+W close tab; desktop menu owns the key first, finding recorded) |
| search-chats | sub-chat-selector.tsx, made binding-aware this step |
| focus-input | use-focus-input-on-enter.ts, made binding-aware this step |
| toggle-focus | use-toggle-focus-on-cmd-esc.ts, made binding-aware this step |
| stop-generation | active-chat.tsx, made binding-aware this step |
| voice-input | chat-input-area.tsx, already binding-aware |
| toggle-details | details-sidebar.tsx (Cmd+Shift+\) |

Delete (no behaviour anywhere): `undo-archive`, `create-pr`. `create-pr` returns with step 14/15 plus a test.

## Deviations from the step text, and why

- The step predicted 19 dead keys. Reality: 19 dead map entries, but most keys fire through component handlers. Deleting those ids would have removed working keys from the table, so the verdicts above follow the evidence.
- `voice-input` and `archive-workspace` were on the step's delete list but are live and registry-aware; they stay.
- `platform.ts`: the advertised table is dead code with zero consumers, so it is deleted instead of regenerated.

## Tasks

1. `src/renderer/lib/hotkeys/match-hotkey.ts`: extract `matchesHotkey`, add bracket code handling, add `matchesShortcutAction` (primary + altKeys, custom-binding aware).
2. `agents-actions.ts`: own `SHORTCUT_TO_ACTION_MAP`, input-safe set, dedicated-handler set, component-owned table; add 5 actions; drop per-action `hotkey` fields.
3. `agents-hotkeys-manager.ts`: map-driven generic loop with input-safe flag, dispatch through the map, delete dead reverse map and local matcher.
4. Registry + types: delete `undo-archive`, `create-pr`; relabel prev/next tab, close tab.
5. Consumers: active-chat (delete moved handlers, binding-aware stop), chat-input-area (event consumption), sub-chat-selector, both hooks.
6. Delete dead platform.ts shortcut table.
7. `agents-actions.test.ts`: map resolves to actions, full id coverage, no overlap, non-empty defaults, no duplicate defaults.
8. Gates, `.dump` record, parity plan P4 note, PR.

## Done criterion

Acceptance criteria of issue #8 hold and every gate passes.
