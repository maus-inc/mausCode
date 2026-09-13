## 0. Meta

| Field | Value |
| --- | --- |
| Step | 25 of 35, wave W11, plus parity P7 |
| Area | renderer |
| Risk | medium |
| Depends on | {{S13}}, {{S17}}, {{S18}}, {{S22}}, {{S24}} |
| Blocks | {{S34}} |
| Estimate | medium |

## 1. Outcome

The surfaces a user touches every hour get one pass each: the diff viewer gains stacked context and renders images, the code panel width persists per window, a pinned file list becomes a real allow-list, selection gains Copy, sample prompts come from the user's own history, and a task can be started from a dialog without leaving context.

## 2. Why it matters

Triage rows 33, 35, 37, 38, 43, 45 and 49 all landed here, and three of them carried the same custom answer: "when you do deep review you will see what we have and what we can increase plus improve". The P7 list adds the small things users file issues about, including the missing Copy action, which is verified: `src/renderer/features/agents/ui/text-selection-popover.tsx` offers `Add to context` at `:125` and `Reply` at `:136` and nothing else.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The diff surface is one component with a mode switcher beside it, not a missing feature | `src/renderer/features/agents/ui/agent-diff-view.tsx`, `src/renderer/features/changes/components/diff-sidebar-header/diff-view-mode-switcher.tsx` | E1, this session |
| `@pierre/diffs` is pinned exact at 1.0.10, and the reason is recorded | `package.json:60`, `.dump/app/decisions/pin-pierre-diffs-2026-09-11.md` | E1, this session |
| Per-pane width machinery already exists, so panel width is a persist call, not a new store | `src/renderer/features/agents/stores/sub-chat-store.ts:30` `splitRatios`, setter at `:47` | E1, this session |
| No task dialog exists | `grep -rn "NewTaskDialog" src` returns nothing | E3, this session |
| PR state is now readable and the widget surface takes a new section | steps 13 and 15, `WidgetId` list recorded in the parity plan P6 | by contract |
| Sample prompts must be generated, not static, and must refresh | triage row 35 verbatim in `.dump/app/decisions/2026-09-12-jules-feature-triage.md` | recorded |

## 4. Read first, and what already exists

`docs/design-system-baseline.md` before any of this, that pass is a non-negotiable in the plan, and its motion and copy sections govern the polish item. `react-keys.ts` and `command-rows.ts` are the required patterns for list identity. The existing mode switcher is where stacked lands; do not add a second control.

## 6. Implementation plan

1. Diff: add a stacked mode to the existing switcher, keep unified and split, and render images in the viewer for changed binary and asset files. Hold the `1.0.10` pin, and re-check the upstream note in the decision file if the diff library is touched.
2. Code panel width: persist per window through the existing ratio store, and restore it on reopen.
3. File pinning: a picker that both narrows context and produces the run's path allow-list, which is triage row 33's "pin means both". Enforce it in main at the tool boundary, and show the count in the composer so the user can see the scope.
4. Selection: add Copy, and check the clipboard path against the packaged build, since dev-only clipboard permission failures are common in Electron.
5. Sample prompts: derive from the user's own recent sessions plus repository signals, refresh on a schedule, and keep the store schema unchanged so a settings file does not grow.
6. Task dialog: wrap the existing new-chat form, since the form already owns project, mode and model selection. No duplicate form state.
7. Micro polish from row 49: recessive icons on non-urgent state, toned-back hovers, consistent system-message padding, each as one commit with before and after screenshots.
8. Search-popover statistics and the sidebar mode switch from P7 ride along, since they are the same surfaces.
9. Playwright screenshot verification stays out. If a reader asks, the deferred entry is triage row 39 and it re-enters when the runtime ships side-pane images.

## 8. Boundaries

- Always: the design-system pass first, then the change, and a re-look at your own diff against existing choices, as `AGENTS.md` says.
- Ask first: adding a dependency for a viewer or a picker, and anything that changes what the agent may touch, since step 10 owns that.
- Never: rewrite `active-chat.tsx`, add a second state store mirroring pane state, key an editable row by index, or ship a Copy button that only works in dev.

## 10. Acceptance criteria

- [ ] Stacked, split and unified all render the same change, and the choice persists.
- [ ] An image file changed in a run renders in the diff at its real aspect, not as a binary notice.
- [ ] A pinned list of two files cannot be escaped by a tool call outside them, proven in main.
- [ ] Copy works in a packaged build, with the method of checking named.
- [ ] Sample prompts differ between two users with different histories, and one is never marketing copy.
- [ ] The task dialog reaches the same create procedure as the full form, with no duplicate validation.
- [ ] Screenshots attached for every polish item, since a UI claim without one is unverifiable.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

## 12. Benchmark record

Only the pinning picker and prompt generation need numbers: time to open the picker on a large repository, and generation cost, in `.dump/app/benchmarks/`.

## 13. Rollback

Per item, since each is its own commit. The allow-list is the only one needing care: revert the enforcement together with the picker.

## 14. Out of scope

The changeset and PR flow, which are {{S14}}. Memory's chip is {{S24}}. Voice and image input were declined or deferred in triage rows 34 and 54.

## 15. Handoff notes

Note in `.dump/app/research/2026-09-25-review-surfaces.md` what the design-system baseline recorded versus what you actually found, because that document drifts and {{S31}} reads this to know whether to refresh it.
