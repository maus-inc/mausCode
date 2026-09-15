# Release parity: 1Code v0.0.75 → v0.0.84 — recreated plan, verified against this branch

**Recreated:** 2026-09-13 by Arena agent mode, on `arena/01a097c4-mauscode` @ `1a37e0b`.
**Why it exists:** the file this document replaces (`.dump/app/plans/release-parity-v0.0.75-0.0.84-plan.md`) was written by the previous session and is not present in this checkout — the session was cut off before it could be committed. The user re-supplied its content, so this is a **recreation, not a copy**: the phase structure and every item are kept as they were given, and each item now carries a verdict measured in *this* tree, because the old verdicts were taken against a different branch state.

Two ground rules inherited from that session and unchanged here:

1. **Plain language.** Item text says what a user will notice, then what has to change.
2. **Nothing is marked done because a release note said so.** "Fixed", "still open", and "cannot be verified from this sandbox" are three different verdicts and get used as such.

---

## 0. What could and could not be re-verified here

Verified by reading files in `/home/user/mausCode` on 2026-09-13 (all line numbers re-measured):

| Old claim | Measured state on this branch |
| --- | --- |
| P0-1 `streamdown` no longer exports `Components`, breaking the type build | **Already fixed.** `src/renderer/components/chat-markdown-renderer.tsx:12-15` carries a comment explaining the missing export and derives `type Components = NonNullable<ComponentProps<typeof Streamdown>["components"]>`; the type is used at `:263`, `:314`, `:562`. |
| P0-2 hermes resume-failure test read a field off a JSON-RPC error incorrectly | **Already fixed** — it is the tip commit of this branch (`1a37e0b` "Fix resume-failure test: read message off JSON-RPC error object"), and `src/main/lib/hermes/acp-chat.test.ts` uses `extractHermesError(error).message`. |
| P0-3 typecheck ratchet baseline vs `docs/backend-porting-recipe.md` §9 ("zero errors") disagree | **Resolved in practice, undocumented.** `.github/ci-baselines/typecheck.txt` now contains **a single newline — an empty baseline**, i.e. the ratchet currently permits zero errors, so the recipe's "baseline is 0" is true today. What is still open: writing the policy down, and deciding what happens when someone needs a temporary entry. |
| A `ts:check` / `tsgo` script is dead weight | `package.json:31` defines `"ts:check": "tsgo --noEmit"` alongside `:39 "typecheck": "tsc --noEmit"`. Whether `tsgo` is installed and invoked by CI **cannot be checked here** (no `node_modules`); still open as a cleanup item. |
| Biome gate: "2 errors + 148 warnings" | **Closed 2026-09-13: 0 findings, and every rule that was `"warn"` is now `"error"`** (`npx @biomejs/biome@2.5.13 check . --max-diagnostics=none`, exit 0). Breakdown at the start of the campaign: 55 `noExplicitAny`, 31 `noArrayIndexKey`, 14 `useIterableCallbackReturn`, 14 `noControlCharactersInRegex`, 3 `noUnusedImports`, 1 `noDescendingSpecificity` (+ ~18 in rules outside that grep). `biome.json` had 22 rules pinned to `"warn"`, which is why a green run used to coexist with 135 findings; those severities are now `"error"`, so exit 0 means a clean tree — see §6. |
| `@anthropic-ai/claude-agent-sdk` pinned at `0.2.45` | **Confirmed** `package.json:49`. Codex binary pin `0.137.0` — **confirmed** `package.json:23-24`. `@pierre/diffs` `1.0.10` — **confirmed** `package.json:60`. `streamdown ^2.0.1` — `package.json:125`. |
| PostHog unified key `phc_wM7gbr…` | **Confirmed** at `src/main/lib/analytics.ts:15`, as the fallback of `MAIN_VITE_POSTHOG_KEY`. |
| Two Codex default-model constants can drift | **Confirmed, and they already differ**: `src/main/lib/trpc/routers/codex.ts:146` `DEFAULT_CODEX_MODEL = "gpt-5.5"` vs `src/renderer/features/agents/lib/acp-chat-transport.ts:41` `DEFAULT_CODEX_MODEL = "gpt-5.5/high"`. Note the second one lives in the **renderer**, not in main. |
| Changelog link builds a double `#` | **Confirmed live bug.** `src/renderer/lib/hooks/use-just-updated.ts:53-54` puts `#v<version>` into `version`, then interpolates `` `${RELEASES_URL}${version ? `#${version}` : ""}` `` → `…releases##v0.0.84`. |
| `tool-Agent` / `TaskOutput` / `MultiEdit` are unregistered | **Confirmed**: `grep -c "tool-Agent\|TaskOutput\|MultiEdit" src/renderer/features/agents/ui/agent-tool-registry.tsx` → **0**. The registry does cover `Task, Grep, Glob, Read, Edit, Write, Bash, WebFetch, WebSearch, TodoWrite, TaskCreate/Update/Get/List, PlanWrite, ExitPlanMode, NotebookEdit, BashOutput, tool-cloning, tool-planning` (`agent-tool-registry.tsx:156-528`). |
| Only two PR columns exist | **Confirmed**: `src/main/lib/db/schema/index.ts:58-59` has exactly `prUrl` and `prNumber`. |
| Branch switching and branch creation are stubs | **Confirmed**: `src/renderer/features/changes/components/diff-sidebar-header/diff-sidebar-header.tsx:476` comment `branch switching will be added later`; `.../changes-panel-header/changes-panel-header.tsx:157` `// TODO: Implement create branch dialog` inside a live `DropdownMenuItem` `onClick`. |
| Selection popover lacks Copy | **Confirmed**: `src/renderer/features/agents/ui/text-selection-popover.tsx` offers `Add to context` (`:125`) and `Reply` (`:136`) only. |

**Not verifiable from this sandbox, ever:** `tsc`, `vitest`, `electron` build, packaging, and CI status — there is no `node_modules` here and installing it is out of scope (this repo uses bun and a lockfile the sandbox must not rewrite). Every item below whose verdict depends on those keeps the old verdict and is marked *(reported, not re-verified)*.

Two claims in the old plan are now known to be **wrong**, and are corrected in place:

* "The PR-badge plumbing (`git-activity.ts` → `updatePrInfo`) exists but nothing writes `prUrl`/`prNumber`." — It does write: `src/renderer/features/agents/utils/git-activity.ts:86` `extractPrInfo` (dispatched `:134-137`) → `src/renderer/features/agents/main/active-chat.tsx:2949` `trpcClient.chats.updatePrInfo.mutate(...)`, the procedure's only caller. The real defect is that the write is derived from a **regex scrape of Bash tool output**, so an agent that runs `gh pr create` through any other path leaves the row stale.
* "PR status is polled by three pollers against one cache." — There is **no `usePRStatus` hook** in this tree. What exists: a 10 s module cache (`src/main/lib/git/github/github.ts:16-17`), one active 30 s poll (`active-chat.tsx:5366-5370`), and a second 30 s poll inside `pr-status-bar.tsx:25-27` whose component is **defined but never imported**. A 30 s client poll against a 10 s server cache means the cache never serves a second reader.

---

## P0 — Make the gates honest (2 of 4 already done here)

| # | Item | Verdict on this branch |
| --- | --- | --- |
| P0-1 | Restore a green typecheck: stop importing `Components` from `streamdown` | **Done** (see §0). Keep the `NonNullable<ComponentProps<…>>` derivation; add the upstream-issue reference to the existing comment when it's touched again. |
| P0-2 | Fix the hermes resume-failure test to read the JSON-RPC error message | **Done** — tip commit. *(reported green; tests not re-run here)* |
| P0-3 | Decide the typecheck policy and write it down | **Half done.** Empty baseline = zero-error gate already in force; the recipe's §9 text and `scripts/ci/typecheck-ratchet.mjs` still need one agreed sentence about what an added baseline entry means and who may add it. |
| P0-4 | Refresh `docs/current-system-map.md` (it still says "zero test files") and either wire `ts:check`/`tsgo` into CI or delete it | **Open.** |

Still open from P0's intent: a `ci` script that runs exactly the three gates in a fixed order, so "the gate is green" is one command rather than three guesses.

## P1 — Dependencies and defaults

| # | Item | Verdict |
| --- | --- | --- |
| P1-1 | `@anthropic-ai/claude-agent-sdk` `0.2.45` → the 0.3 line (release notes said `0.2.63`; the old plan recommended `0.3.270`) | **Decided 2026-09-13 — `0.3.270`**, recorded in `.dump/global/decisions.md`. Step 12 lands it behind its own 0.2 to 0.3 spike. See §5.1. |
| P1-2 | CLI parity pin `2.1.45` → `2.1.270` (notes said `2.1.63`) | **Decided 2026-09-13 — `2.1.270`.** Ships through `scripts/download-*` in the same commit as P1-1, because the two pins are one product's wire format. |
| P1-3 | Codex binary `0.137.0` → `rust-v0.154.0` | **Open — pinned at `0.137.0`** (`package.json:23-24`). No step-04 decision names its target; step 12's file says the Codex pin follows, so whoever lands step 12 reads the changelog and states the target there. |
| P1-4 | PostHog: confirm the unified key reaches every build | **Key present once**, as a fallback literal in `src/main/lib/analytics.ts:15`; the check that no stale per-platform key survives elsewhere still needs a grep in `.env*` and CI vars *(not runnable here)*. |
| P1-5 | One Codex model catalog; `gpt-5.5` vs the note's `gpt-5.4` | **Decided 2026-09-13, and worse than described.** Two constants still disagree, `src/main/lib/trpc/routers/codex.ts:146` `"gpt-5.5"` against `src/renderer/features/agents/lib/acp-chat-transport.ts:41` `"gpt-5.5/high"`, both verified at `f5506b9`. The ratified fix is neither literal: main reads the catalog from the pinned Codex CLI at runtime, with a cache, a static fallback when the CLI cannot answer, and a loud refusal when neither source answers. Step 05 becomes that resolver. See §5.3. |
| P1-6 | Changelog anchor double-`#` | **Open — bug confirmed live** (`use-just-updated.ts:53-54`). |

## P2 — Adopt what SDK 0.3 actually gives us

Adaptive `thinking`, `effort`, `promptSuggestions`, session control requests, the 32 hook events, and registering the three missing tools (`tool-Agent`, `TaskOutput`, `MultiEdit` — **all three confirmed absent**). Two notes carried forward, both still true:

* `MultiEdit` is not in the registry, so a batch edit renders as nothing at all; `tool-Agent` is the reason a sub-agent's own work is invisible; `TaskOutput` is why background Bash output has no home. These are three small entries in `agent-tool-registry.tsx`, but the SDK bump in P1-1 gates them.
* `ClaudeStreamMessage`/`ClaudeContentBlock` — the typed stream shape the old plan proposed — are **absent** from `src/main/lib/claude/transform.ts` (measured; that design was never applied on this branch). Only 1 `any` remains in that file, so the typing work is smaller than the old plan implies but still unwritten.

## P3 — Sub-chat creation feels instant

Optimistic create with rollback at three call sites (sidebar awaits at `:1097-1135`), a double-click guard, a backend helper so the engine is never asked to update a sub-chat that does not exist yet (the silent no-op at `claude.ts:995-1050`), auto-delete of empty sub-chats, cached `fileCount`/`additions`/`deletions` columns, and a slimmer `chats.get`.

Measured anchors on this branch: `chats.get` is `src/main/lib/trpc/routers/chats.ts:407` and returns the full chat row (its `list` sibling at `:329` already selects a narrowed column set, so the fix is a copy of a pattern that exists); `getFileStats` is `:1763` (still re-parses a JSON blob per call — the reason for the cached columns); `create` `:427`, `createSubChat` `:884`, `forkSubChat` `:913`, `updateSubChatMessages` `:1052`. The "silent no-op" the old plan attributed to `src/main/lib/claude/claude.ts` is at **`src/main/lib/trpc/routers/claude.ts:999-1006`** (the file named in the old plan does not exist): the fire-and-forget `(async () => { … })()` reads `JSON.parse(existing?.messages || "[]")` and `existing?.sessionId || null`, so a prompt aimed at a missing sub-chat id proceeds without an error path — which is why an optimistic create that fails leaves the backend writing into nothing.

## P4 — Panes, ordering, and the shortcut layer

`sub_chats.sortOrder` + a `reorderSubChats` procedure (**absent today**: `chats.ts` defines no `reorder*` procedure), drag-to-split including pinned panes, `queue` reordering, tooltip cleanup — and, newly measured, the real reason several shortcuts feel broken:

> `src/renderer/features/agents/lib/agents-hotkeys-manager.ts` maps **29** shortcut ids onto action ids, while `src/renderer/features/agents/lib/agents-actions.ts` registers **11** actions (`:225-235`). **19 of the 29 point at an action that does not exist**, and dispatch ends in `if (!action) return` (`agents-hotkeys-manager.ts`, `handleHotkeysAction`), so the key does nothing and says nothing.

The inert ids: `toggle-details, undo-archive, search-workspaces, archive-workspace, quick-switch-workspaces, new-agent-split → create-new-agent-split, search-chats, archive-agent, quick-switch-agents, prev-agent, next-agent, focus-input, toggle-focus, stop-generation, switch-model, toggle-terminal, open-diff, create-pr, voice-input`. The public `SHORTCUTS` table in `src/renderer/lib/utils/platform.ts:73-100` advertises `cmd+t`, `cmd+[`, `cmd+]`, `cmd+e`, `⌥⌃Tab` for several of them — which is exactly the "⌘⇧T and ⌘[ / ⌘] are inert" report, now explained: they are bound, mapped, and dropped. `create-pr` and `open-diff` being in that list also means P6's PR work has a keyboard entry point waiting for it.

Split panes are capped at 4: `src/renderer/features/agents/stores/sub-chat-store.ts:10` `MAX_SPLIT_PANES = 4`, `addToSplit` at `:324` with the cap enforced at `:336` and normalisation at `:188`/`:397`.

## P5 — Multi-pane correctness

Per-pane tab groups with a versioned `localStorage` migration; approve/reject for plans (the old finding stands as the scoping constraint: `isActive` gates a pane that is *visible*, and **there is no reject path** to begin with); the tab-close freeze, which still needs reproducing against the debug server on `:7799` *(not runnable here)*; forking while a stream is in flight — measured here: `src/renderer/features/agents/main/active-chat.tsx:3222` `handleForkFromMessage` opens with `if (isStreaming || isForkingRef.current) return` (`:3224`), so the gate the old plan named at `:3222` is real and correctly located, and the same component gates on `useStreamingStatusStore.getState().isStreaming(subChatId)` at `:323` and `:1990`; rename toast, already clean.

## P6 — Diffs, branches, and PR surface

`@pierre/diffs` spike (the old verdict "keep the `1.0.10` pin unless `@shikijs/themes` `ayu-light` resolves" still applies — unverifiable without install); two-column commit diff; a shared `BranchSwitcher` with carry-or-stash (both stubs confirmed, §0); PR comments via `gh pr view --json comments,reviews` + GraphQL threads into a new `details-sidebar` widget (`WidgetId = info|todo|plan|terminal|diff|mcp`); editable PR title via `gh pr edit`; a PR-cache invalidator mirroring `invalidateGitStateCaches`; pull-&-push on non-fast-forward.

Additions this pass, because the read path is better than the old plan credited:

* `fetchGitHubPRStatus` (`src/main/lib/git/github/github.ts:24`) already does the right *shape*: repo URL → current branch → parallel `branchExistsOnRemote` + `getPRForBranch`, where the latter is a single `gh pr view <branch> --json number,title,url,state,isDraft,mergedAt,additions,deletions,reviewDecision,statusCheckRollup,mergeable` (`:91-105`), parsed against `GHPRResponseSchema`. `GitHubStatus.pr` (`src/main/lib/git/github/types.ts:61-74`) already carries `state`, `reviewDecision`, `checksStatus` and `checks[]`.
* So the gaps are: **no persistence** (only `prUrl`/`prNumber` are stored, `db/schema/index.ts:58-59`, so a restart loses state, and an externally-merged PR keeps a session open forever), **no failure-aware caching** (flat 10 s TTL at `github.ts:16-17`, which is why a 429 makes the sidebar lie for a full tick — t3code uses 60 s on success and 20 s → 15 min exponential backoff on failure; see `.dump/app/research/2026-09-13-t3code-pr-state-spike.md` §3), **no check de-duplication** (re-runs appear twice; their 55-line Effect-free `dedupeChecks` is a verbatim candidate), **no `baseComparison`** (`up-to-date | behind | unknown`, already typed in our own `src/shared/contracts/pullRequest.ts:124`), and **one dead consumer** (`pr-status-bar.tsx` is never imported).

## P7 — Small things users file issues about

Search-popover statistics, sidebar mode switch, badge/branch correctness, an env-strip regression test, the slash-command `projectPath` that is dropped at `active-chat.tsx:4003` and `new-chat-form.tsx:1380`, and the missing **Copy** action in `text-selection-popover.tsx` (confirmed: `Add to context` + `Reply` only).

## P8 — Tests, CI globs, release mechanics

Unchanged: unit tests for the new store procedures and the diff/PR paths, CI path filters so docs-only changes don't build Electron, and the release notes/checksum work. Everything here is *(reported, not re-verified)* — no test runner in this sandbox.

---

## 5. The three decisions, answered 2026-09-13

**Status: closed. Do not re-open these here.** The human answered all three on 2026-09-13 and the answers live in `.dump/global/decisions.md`; roadmap step 04 is the record form. The recommendations below are kept as reasoning, and each one now states which half the human took and which half was refused, so a later reader does not find a live recommendation to reverse a ratified decision.

### 5.1 SDK `0.3.270` (ratified) vs the note's literal `0.2.63` (refused) and the `0.2.45` pin (refused)

The pin today is `0.2.45` (`package.json:49`). Staying on 0.2.x means P2 is mostly unimplementable: `promptSuggestions`, the 32 hook events and session control requests are 0.3 surfaces, and `tool-Agent` output shapes changed. **Ratified: `0.3.270`, with Claude CLI `2.1.270`.** The deviation from the inherited release note is a recorded choice rather than an accident, and it carries one extra task this section already named: `docs/backend-porting-recipe.md` §4's closed chunk dialect must be re-checked against 0.3's stream events in the same commit, since a widened dialect breaks the mock peers every backend ships. Roadmap step 12 is the land, and its 0.2 to 0.3 spike gates it.

### 5.2 Drag-and-drop: native HTML5 (refused) vs `@dnd-kit` (ratified)

**This section's own recommendation was refused.** It argued native on the grounds that zero new dependencies beats a new mental model of focus, at the cost of hand-written split-target hit-testing. **The human chose `@dnd-kit`** as an explicit exception to the no-new-dependency rule, because steps 17, 18 and 37 all need the same interaction and three hand-rolled drag implementations is the outcome the exception avoids. The three packages land in step 12, the only step allowed to touch `package.json` and `bun.lock`, with exact pins, and step 30 records the bundle delta they cost. Revisit only if the dependency's weight in the renderer budget turns out to be unaffordable, which step 30 measures rather than this file arguing.

### 5.3 Codex default: `gpt-5.5` (refused) vs the note's `gpt-5.4` (refused) vs a runtime read (ratified)

Already recorded as a deviation in the old plan; the new fact is that the renderer hardcodes `"gpt-5.5/high"` at `src/renderer/features/agents/lib/acp-chat-transport.ts:41` while main holds `"gpt-5.5"` at `src/main/lib/trpc/routers/codex.ts:146`, so "one catalog" is required regardless of which model wins. **Ratified: neither literal.** The model catalog is read from the pinned Codex CLI at runtime, with a cache, a static fallback when the CLI cannot answer, and a loud refusal when neither source answers. Step 05 changes shape accordingly, from a constant swap into a resolver, and the resolver is what ends the divergence between those two files. Picking either literal stays rejected, because a hardcoded id goes stale on the next CLI release and that is the bug this row exists to kill.

### 5.4 New from the P0-3 work

The empty baseline means the ratchet is *already* a zero-error gate. Write that in `docs/backend-porting-recipe.md` §9 (it currently asserts the same thing but attributes it to a different mechanism) and in `CONTRIBUTING.md`, and delete the option of quietly adding a line to `typecheck.txt` without a linked issue.

---

## 6. How this program ends

The lint policy from the previous session is binding: **fix all findings, tests included, no exemptions, no advisory gate, and do not re-ask.** Measured today that means driving 135 warnings to 0 with `noExplicitAny` (55) and `noArrayIndexKey` (31) as the bulk, `useIterableCallbackReturn`/`noControlCharactersInRegex` (14 + 14) as mechanical work, and `noUnusedImports` (3) trivial. This is finished: the count went 135 → 0 (`6f4d818`→`9734578`) with no suppression added, and every
`"warn"` severity in `biome.json` is now `"error"` (`c71c270`), including the stale per-file
`useSemanticElements` downgrade on `agents-sidebar.tsx`, which was deleted because that file no
longer needs it. Three consequences for the rest of this program:

- `biome check` exiting 0 now *means* a clean tree, so CI's `lint-changed.mjs` step is a real gate
  for every wave — no wave may land a new finding, and the file-level gate can no longer be
  satisfied by leaving old debt in place.
- The print-adapter and runtime-client tests are typed against the protocols they exercise
  (`*PrintChunk`, `MockRequest = ApiRequest & { id }`, `requestOf()`), which is what lets P2's SDK
  0.3 message-shape changes be caught by `tsc` instead of surfacing as `undefined` in a transcript.
- `packages/runtime-client/tsconfig.test.json` is a new gate (`npm run typecheck` = src + tests):
  those tests were previously only type-stripped by `node --test` and never checked. Writing it
  exposed three real defects, so the same move is worth doing for any other package whose tests sit
  outside every tsconfig (check `packages/*` in P8).


Order of work, taking the union of this program and the port plan (`.dump/app/plans/2026-09-12-jules-port-plan.md` §11):

1. **P0-4 + P1-6 + P1-5** — one commit each, no install needed to write them, all three are already verified as broken here.
2. **P4's inert-shortcut cleanup** — either implement or unregister; leaving 19 mapped ids that `return` silently is the kind of thing users read as "the app ignores me".
3. **P1-1/2/3 + P2** together, behind a mock-peer pass, because the SDK bump and the tool registry are one story.
4. **P3, P5** (sub-chat/pane correctness) — the part users hit hourly.
5. **P6** with the t3code spike applied, then **P7**.
6. **P8** last, as the gate on everything above.

The lint campaign runs **inside** every step (each commit lands at zero new findings, not at the end), which is how the previous session intended it and the only ordering that survives a rebase.
