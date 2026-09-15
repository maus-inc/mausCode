# Hotkey audit: shortcut registry, action registry, and live key handlers

Date: 2026-09-15. Step: issue #8 (roadmap 06, parity P4). Evidence levels: E1 = read in this tree this session, E4 = gate run this session.

## Conclusions

1. The P4 premise "19 keys are bound, mapped, and dropped" was half right. 19 of the 29 `SHORTCUT_TO_ACTION_MAP` entries pointed at actions that did not exist (E1, counted), but 15 of those 19 keys still fired through component-local keydown handlers that ignore custom bindings. Deleting them would have removed working keys from the settings table. The corrected verdicts are in the table below.
2. The dead map was dead for dispatch: the manager's generic loop iterated `AGENT_ACTIONS` `hotkey` fields, not the map. Only 10 map entries resolved to the 11 registered actions (E1).
3. Ownership is now explicit and test-enforced. `agents-actions.ts` owns `SHORTCUT_TO_ACTION_MAP` (ids the hotkeys manager dispatches), `SHORTCUT_DEDICATED_HANDLERS` (map ids with dedicated listener rules), `SHORTCUT_INPUT_SAFE` (map ids that fire inside inputs), and `COMPONENT_OWNED_SHORTCUTS` (ids dispatched by a component or hook, with the owner path). `agents-actions.test.ts` fails when a registry id has no dispatcher, when a mapped id has no registered action, when a mapped id has no default key, or when two mapped ids share a default key (E4, 14 tests).
4. Rebinding now works for the ids the manager dispatches, for `focus-input`, `toggle-focus`, `search-chats`, and `stop-generation`, because dispatch goes through `getResolvedHotkey` via `matchesShortcutAction` in `src/renderer/lib/hotkeys/match-hotkey.ts`. The other component-owned ids keep hardcoded keys; rebinding them is still a no-op, which is recorded per id below and stays a known limitation until their owners move behind the registry.
5. `src/renderer/lib/utils/platform.ts` `SHORTCUTS` and its accessors were dead code with zero consumers (E1, grepped). Deleted instead of regenerated. The step's "advertised table" now lives only in the settings keyboard tab, driven by the registry.
6. The registry lost `undo-archive` and `create-pr`: no code anywhere dispatched or handled them (E1). `create-pr` returns with the PR entry point step plus a test.

## Verdict per registry id (27 after deletion)

Manager-dispatched (15), custom bindings apply:

| id | action | change |
| --- | --- | --- |
| show-shortcuts | open-shortcuts | pre-existing, dedicated listener |
| open-settings | open-settings | pre-existing, dedicated listener |
| toggle-sidebar | toggle-sidebar | pre-existing, dedicated listener |
| new-workspace | create-new-agent | pre-existing; default Cmd+N stays menu-owned, a rebound key fires renderer-side, "C" alt read from the registry and retired on rebind |
| open-kanban | open-kanban | pre-existing; beta-gated dedicated listener now the only path |
| new-agent | create-new-agent | new dispatch path; Cmd+T moved out of active-chat |
| search-in-chat | toggle-chat-search | pre-existing, dedicated listener |
| prev-agent | prev-agent | new action over injected sub-chat tab slice; active-chat Cmd+[ handler deleted |
| next-agent | next-agent | new action; active-chat Cmd+] handler deleted |
| open-diff | open-diff | new action toggling `diffSidebarOpenAtomFamily`; active-chat Cmd+D handler deleted |
| toggle-terminal | toggle-terminal | new action toggling `terminalSidebarOpenAtomFamily`; active-chat Cmd+J handler deleted |
| switch-model | switch-model | new action dispatching the `switch-model` window event; chat-input-area consumes |
| file-search | file-search | pre-existing, dedicated listener |
| open-in-editor | open-in-editor | pre-existing |
| open-file-in-editor | open-file-in-editor | pre-existing |

Component-owned (12), key works, owner recorded:

| id | owner | rebinding |
| --- | --- | --- |
| search-workspaces | agents-sidebar.tsx Cmd+K | hardcoded, no-op |
| archive-workspace | agents-sidebar.tsx Cmd+E | hardcoded, no-op |
| quick-switch-workspaces | agents-content.tsx hold-to-switch | controlled by the Ctrl+Tab target preference |
| quick-switch-agents | agents-content.tsx hold-to-switch | controlled by the Ctrl+Tab target preference |
| new-agent-split | active-chat.tsx Cmd+Shift+T | hardcoded, no-op |
| archive-agent | active-chat.tsx Cmd+W | hardcoded, no-op; see finding 8 |
| search-chats | sub-chat-selector.tsx "/" | custom binding applies as of this step |
| focus-input | use-focus-input-on-enter.ts | custom binding applies as of this step |
| toggle-focus | use-toggle-focus-on-cmd-esc.ts | custom binding applies as of this step; Ctrl+Esc added as altKeys to keep the old Windows/Linux behaviour |
| stop-generation | active-chat.tsx Esc | custom binding applies as of this step; Ctrl+C alt retired when a custom binding exists |
| voice-input | chat-input-area.tsx | already binding-aware before this step |
| toggle-details | details-sidebar.tsx Cmd+Shift+\ | hardcoded, no-op |

Deleted (2): `undo-archive`, `create-pr`. Users with saved localStorage bindings for these ids keep them in `CustomHotkeysConfig.bindings`; they are inert strings, no migration needed.

## Findings recorded along the way

7. The generic loop previously dispatched `open-kanban` with the Kanban flag off, because `AGENT_ACTIONS` drove the loop and only the dedicated block checked `betaKanbanEnabled` (E1). Map-driven dispatch removed the ungated path.
8. `archive-agent` advertises Cmd+W but the main process menu registered `CmdOrCtrl+W` as Close Window (`src/main/index.ts`), so on desktop the menu won and the renderer close-tab handler rarely fired. Resolved 2026-09-15: the human picked "menu yields" from the options, and the Close Window menu item lost its accelerator, keeping the item clickable. Cmd+W now reaches the renderer's close-tab handler on desktop; Cmd+Q still quits and the red traffic light still closes the window. Note the renderer deliberately refuses to close the last open tab via the hotkey, so Cmd+W with a single tab does nothing by design.
9. active-chat's deleted Cmd+[ / Cmd+] effect attached one listener per mounted ChatView with no `isActive` guard, so keep-alive tabs dispatched the navigation more than once per press (idempotent, but wrong). The manager dispatches once per window.
10. Web-only key variants (`Opt+Cmd+T`, `Opt+Cmd+[`, `Opt+Cmd+]`) died with the deleted component handlers; the manager matches the registry defaults. The product is the Electron app; `MAIN_VITE_API_URL` unset stays fully local, and the old web variants were only documented in the now-deleted platform.ts table.
11. `matchesHotkey` gained an `esc`/`escape` alias plus `[` / `]` code matching; without them registry strings like `esc` and `cmd+[` never matched real events (E1, traced).

## Review round on PR #56 (bot findings, disposition)

12. Kilo Code Review warned that a rebound `new-workspace` was silently ignored: the dedicated block only matched the "C" alt key and the primary key stayed with the menu accelerator. Fixed: the renderer now honours a rebound `new-workspace` key; the default Cmd+N stays menu-owned so the renderer never double-fires it against the menu IPC.
13. CodeAnt flagged that recorded Space and arrow bindings never matched. Valid: the recorder stores `"Space"` and `"↑"`-style symbols (`use-hotkey-recorder.ts` KEY_MAP), which the matcher never compared. Fixed with space and arrow aliases in `match-hotkey.ts`, locked by `match-hotkey.test.ts`.
14. CodeAnt flagged that `dispatchShortcut` always preventDefaulted, ignoring the manager's `preventDefault: false` option. Fixed for consistency; no caller passes false today, so no behaviour change.
15. CodeAnt flagged that the `cmd` modifier only matches `metaKey`, so renderer-side Cmd defaults never respond to Ctrl on Windows and Linux. Recorded, not fixed: this is the matcher's original semantics (extracted verbatim), and redefining `cmd` on non-mac platforms would change every binding's meaning. Electron menu accelerators (`CmdOrCtrl`) carry the primary keys on Windows and Linux.
16. SonarCloud S3776 flagged `matchesHotkey` at cognitive complexity 33 against the 15 cap, and S7755 asked for `.at(-1)`. Both valid, both fixed: the per-key alias `if` chain became the `KEY_ALIASES` lookup table, so adding an alias is a table row, and the complexity dropped below the cap. The matcher tests lock every alias, so the refactor is semantically identical.

## CodeRabbit round on PR #56

17. CodeRabbit caught a real regression this step introduced: the primary stop block matched Ctrl+C through the registry altKeys, so with pending questions on screen Ctrl+C skipped the questions instead of stopping, and the copy-with-selection guard in the dedicated Ctrl+C branch was bypassed. Fixed: the uncustomized Ctrl+C combo is excluded from the primary block and keeps its dedicated branch; a user-customized binding that names Ctrl+C still takes the primary path, because the user chose it.
18. `getResolvedHotkey` and `isCustomHotkey` treated an explicit `null` binding as a custom value, dead-ending the shortcut, while `CustomHotkeysConfig` documents null as a reset to default. The settings tab resets by deleting keys today, so the bug was latent, not live. Fixed to treat null as unset, with tests.
19. The search-history popover tooltip hard-coded a `/` hint; it now renders `useResolvedHotkeyDisplay("search-chats")` passed down as a prop, so the hint follows rebindings like the other tooltips.
20. CodeRabbit's docstring-coverage warning (46% against an 80% default) is declined: the repo's written rule is no comments on new code except non-obvious constraints, so comment padding to satisfy a bot threshold would violate the tree's own standard.

21. SonarCloud S6767 "searchHotkey PropType is defined but prop is never used" on sub-chat-selector.tsx is a false positive, disputed without a code change. The prop is destructured and rendered in the same file. The analyzer cannot bind destructured parameters of an inner function through `memo(forwardRef(...))`: the same rule has been open since 2026-01 on all seven sibling props of this component, each demonstrably used. The PR comment carries the line references.

## CodeAnt round 2 on PR #56 (commit 2607658 re-review)

22. Valid: the chat-history hotkey effect ran per mounted keep-alive chat, so the binding opened the popover in every mounted chat. The unguarded per-instance listener predates the step, but fixed in 6bf16af: the handler is gated to the chat matching `selectedAgentChatIdAtom`.
23. Valid: removing the menu's Close Window accelerator left Windows and Linux with no close-tab key, because the renderer only matched metaKey. Fixed in 6bf16af: Ctrl+W closes the tab on those platforms, skipped while the terminal has focus where Ctrl+W is the shell's WERASE key.
24. Skipped as a documented limitation: after rebinding new-workspace, the menu's Cmd+N still works through IPC while the new key works renderer-side. Both fire the same action; releasing the old key needs dynamic main-process menu accelerators, a separate roadmap item (finding 12).
25. Rejected: prev/next do not follow a stale order. The tab strip renders `openSubChats.map(...)` in store order, which is exactly what the actions walk; the updated_at sort feeds only the history popover.
26. Skipped as pre-existing parity: switch-model firing with no mounted chat input is a silent no-op, identical to the pre-PR Cmd+/ handler and the open-in-editor pattern. A global model-dropdown atom is a chat-input-area refactor outside this step.

## Kilo and CodeRabbit round 3 on PR #56 (commit bf0ccc6 re-review)

27. Valid: the new Windows/Linux Ctrl+W close-tab branch had no macOS gate, so desktop macOS lost Ctrl+W delete-word inside text fields. Fixed in 946305f with `!isMacOS()`; the terminal WERASE guard is unchanged.
28. Valid: the close-tab effect hardcoded Cmd+W, Ctrl+W and Opt+Cmd+W, so a custom Close tab (`archive-agent`) binding never took effect and the retired keys kept closing tabs — the same dead-key class this step set out to remove, sitting in its own dispatcher. Fixed in 012839a: the primary desktop key resolves through the registry (`matchesShortcutAction` on `archive-agent`), the Ctrl+W and Opt+Cmd+W fallbacks stay armed only while the binding is uncustomized, every Ctrl-keyed match keeps the terminal guard, and a matcher test pins default resolution plus custom retirement.

## Gates run for this record (E4, 2026-09-15, head 012839a)

`npx @biomejs/biome@2.5.13 check .` (0 findings / 869 files), `npm run typecheck` (0 errors), `npm run test` (665 passed), `npm run test:node` (27 passed), `npm run test:contracts` (382 passed), `npm run lint` (964 files clean), `npm run ratchet:typecheck` (0 <= 0), lint-ratchet equivalent `biome check --reporter=json` (0 errors 0 warnings <= 0), `npm --prefix packages/runtime-client run typecheck` + `test` (pass), `npm run build:runtime-client` (pass), `npm run ratchet:audit` not run locally (needs bun; CI supply-chain job green). CI on 012839a: 18 checks pass, 1 skipping (DeepSource external), Sourcery approved.
