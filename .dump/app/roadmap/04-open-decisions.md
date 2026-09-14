## 0. Meta

| Field | Value |
| --- | --- |
| Step | 04 of 45, the four open decisions in §11.3. **ANSWERED 2026-09-13**, see §15 and §4a of the roadmap plan |
| Area | decision |
| Risk | high, because four steps are waiting on it |
| Depends on | {{S01}} |
| Blocks | {{S05}}, {{S12}}, {{S17}}, {{S18}}, {{S24}} |
| Estimate | small. Answers, not code |

## 1. Outcome

Answered on 2026-09-13 and recorded in `.dump/global/decisions.md`, the four this step owed, plus the sign-in scope from step 45. The answers, and what they unblock:

- Claude Agent SDK `0.3.270` with Claude CLI `2.1.270`, not the release note's `0.2.63`. Unblocks steps 12, and after it 13, 19, 20, 23, 24 and 35. The breaking-ish step is gated by the spike inside step 12.
- Drag and drop: `@dnd-kit`, an approved exception to the no-new-dependency rule. Unblocks 17, 18 and 37, and it changes 12, because the dependency step is the only one allowed to touch `package.json` and `bun.lock`.
- Codex default: read the model catalog from the pinned CLI at runtime with a static fallback and a loud refusal when neither is available. Unblocks 05, which grows from a constant swap into a resolver.
- Memory: hybrid, the runtime may propose and mausCode stores behind one accept surface. Unblocks 24, and it links 24 to 43 through a shared proposal queue.

The step closes by verifying the record, not by asking again. If a later answer overrides one of these, the override is a new dated entry and the affected steps get a comment.

## 2. Why it matters

These four cannot be settled by reading code. Each is a taste, a risk appetite, or a promise to users: which upstream SDK line we ship on, whether we accept a dependency for drag and drop, which model string is the product default, and who owns agent memory. Guessing costs a rewrite of a step that takes a day or more.

## 3. Evidence

The measurements that bear on each answer, all already on the record:

| Decision | Measured fact | Path |
| --- | --- | --- |
| SDK line | `package.json:49` pins `@anthropic-ai/claude-agent-sdk` `0.2.45`; the inherited release note names `0.2.63`; the plan recommends `0.3.270` | `.dump/app/plans/release-parity-v0.0.75-0.0.84-plan.md` §5.1 |
| Drag and drop | no `@dnd-kit` in dependencies, re-verified 2026-09-14 at `f5506b9` by `grep -o 'dnd-kit' package.json bun.lock` returning nothing; split machinery and `MAX_SPLIT_PANES = 4` already exist | `package.json`, `src/renderer/features/agents/stores/sub-chat-store.ts:10` |
| Codex default | two constants disagree, re-verified 2026-09-14: `gpt-5.5` against `gpt-5.5/high` | `src/main/lib/trpc/routers/codex.ts:146`, `src/renderer/features/agents/lib/acp-chat-transport.ts:41` |
| Memory owner | the vendored engine ships its own memory graph, and `src/shared/contracts` holds 24,860 lines with zero importers outside itself, re-verified 2026-09-14 two ways | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §7, `.dump/app/plans/2026-09-12-jules-port-plan.md` F1 |

Verification detail for the last row, because two `.dump` files disagreed on it. At `f5506b9` on 2026-09-14, `wc -l src/shared/contracts/*.ts | tail -1` and a per-file sum of `grep -c ''` both give 24,860, split as 44 source files at 19,395 lines plus 23 test files at 5,465 lines, with no file missing a trailing newline. The 24,860 this step's evidence carried is therefore correct, and the 24,927 that `.dump/app/plans/contracts-adoption.md` §1 records is one line per counted file too high. `.dump/global/decisions.md` carries the correction.

## 4. Read first, and what already exists

The recommendation for all four is already argued in §5 of the parity plan, and the memory mapping is in §7 of the hermes spike. `AGENTS.md` says to ask one question at a time, sorted by blast radius, with two or three options and a recommendation. That is what this step is.

## 6. Implementation plan

1. Ask the four questions, one each, with the measured fact above and the recommendation. Done, batched with the sign-in scope on 2026-09-13, so this step is now verification.
2. Record each answer in `.dump/global/decisions.md`, dated, and cross it out of `questions.md`.
3. Update the two plan files so the decision is not re-opened, and add the answer line to each blocked issue as a comment.

## 8. Boundaries

- Always: record the deviation from the inherited release note as an explicit choice, not silence.
- Ask first: an answer that adds a dependency or changes a capability surface.
- Never: implement the recommended option because the human has not answered yet.

## 10. Acceptance criteria

- [x] Four dated entries in `.dump/global/decisions.md`, each naming the rejected option too. Entries dated 2026-09-13 for the SDK line, drag and drop, the Codex default and memory ownership. The SDK row names the release note's `0.2.63` and the current `0.2.45` pin; the drag row names native HTML5 handlers and the no-new-dependency posture behind them; the Codex row names the single hardcoded id that the auto-generated plan on #7 proposed; the memory row names both the app-owns-the-store option and the engine-owns-the-store option from the hermes spike's §7.
- [x] `.dump/global/questions.md` items 1 to 4 removed or marked answered. All four sit in the batch 1 block with a one-line answer each, and their numbers stay in the file so a citation by item number cannot rot.
- [ ] A comment on issues {{S12}}, {{S17}}, {{S18}} and {{S24}}, which resolve to #14, #19, #20 and #26, saying they are unblocked and by which answer. **Blocked by a permission wall, verified three ways on 2026-09-14.** `gh issue comment`, `POST /repos/maus-inc/mausCode/issues/20/comments` and `PATCH /repos/maus-inc/mausCode/issues/20` all return 403 `Resource not accessible by integration`, the same failure the planning session recorded in `.dump/app/plans/2026-09-14-issue-drift-notices.md`. The text and the commands are handed off in §15.

The three criteria were re-checked on 2026-09-14 at `f5506b9`, not taken from the earlier session's summary.

## 11. Verification

```sh
grep -c "2026-09" .dump/global/decisions.md
gh issue view {{S12}} --json comments,labels
```

Run on 2026-09-14, with the observed result rather than the expected one.

| Command | Result |
| --- | --- |
| `grep -c "2026-09" .dump/global/decisions.md` | 43, all four step-04 answers included |
| `grep -c "Rejected:" .dump/global/decisions.md` | 4, one per step-04 row |
| `gh issue view 14 --json comments,labels` | one comment, from `coderabbitai`, label `roadmap`. No step-04 comment, and posting one returns 403; §15 owns it |
| `gh issue view 20 --json comments,labels` | same shape, `coderabbitai` only, label `roadmap` |
| `grep -c "2026-09" .dump/global/questions.md` | 6, the batch 1 to batch 4 headings. Items 1 to 4 read answered |
| `grep -c "dnd-kit" package.json bun.lock` | 0 in both files |
| `grep -n "DEFAULT_CODEX_MODEL" src/main/lib/trpc/routers/codex.ts src/renderer/features/agents/lib/acp-chat-transport.ts` | `gpt-5.5` at `codex.ts:146` and `gpt-5.5/high` at `acp-chat-transport.ts:41` |

Gate report for this change, six Markdown files under `.dump/` and nothing else. Every row is what ran here, not what CI will run.

| Gate | Result |
| --- | --- |
| `npx --yes @biomejs/biome@2.5.13 check .` | Passed. 861 files checked, exit 0, 0 findings, the same count the step 03 record holds. Biome ignores `.md`, so this proves the tree is unchanged rather than that the new prose is formatted |
| `LINT_BASE=f5506b9ba1d4e2072c2b51eef7fa6b45ae0cf3e0 node scripts/ci/lint-changed.mjs` | Passed, exit 0, `no lintable files changed; skipping`. This is what the PR's `quality` job will do, because the changed set is six `.md` paths and the wrapper's pattern excludes them |
| `node scripts/ci/typecheck-ratchet.mjs` | **Not run, reported as not run.** The first attempt printed a pass and the pass is false. Without `node_modules`, `npx tsc` fetches the deprecated `tsc` stub, which exits 1 with a banner; `runTsc` accepts any exit-1 output as diagnostics, matches nothing against its error pattern, and reports `0 errors <= 0 baseline` without compiling. Repro is `rm -rf node_modules && node scripts/ci/typecheck-ratchet.mjs`. Step 02 owns that gate and this is a finding for it, not a fix in this step |
| `npm run typecheck`, `npm run test`, `npm run test:node`, `npm run test:contracts` | Not run. They need `node_modules`, this sandbox has none, and `AGENTS.md` forbids an install in a step that is not the dependency step. The PR's `quality` job is the reference run for all four |
| `bun run build`, `bun run package:mac` | Not run, same reason, plus the sandbox limits the step 03 record measured: no display, and the release-asset, electronjs.org and nodejs.org hosts are blocked |

## 13. Rollback

An answer can be reversed. The reversal is a new dated entry, not an edit.

## 14. Out of scope

Any code. This step closes when the answers exist.

## 15. Handoff notes

Criteria 1 and 2 are met and re-checked. Criterion 3 is the handoff, because the answers are ratified but the
integration that runs this step cannot write to an issue. Nothing downstream is blocked by that: steps 05, 12, 17,
18 and 24 already carry the consequences in their own files, so the comments exist to let an issue reader see the
answered state without opening `.dump`.

### Which comment closes which issue

| Issue | Step | The comment text |
| --- | --- | --- |
| #14 | 12 | `.dump/app/plans/2026-09-14-issue-drift-notices.md`, block `### #14 · step 12` |
| #19 | 17 | the same file, block `### #19 · step 17` |
| #20 | 18 | not a drift notice, because its body is current, so the text is below |
| #26 | 24 | the same file, block `### #26 · step 24` |

Run that file's §1 loop to post all thirteen notices, which covers the three above. Posting is a human action
because it needs write access this integration does not have. Post the fourth on its own with:

```sh
gh issue comment 20 --repo maus-inc/mausCode --body-file /tmp/step04-comment-20.md
```

### The #20 comment text

```markdown
**Step 04 dependency answered, 2026-09-14.**

Roadmap step 04 answered the drag-and-drop question on 2026-09-13, and this step is one of the four it unblocks.
The answer is `@dnd-kit`: hand-rolled native HTML5 drag is out, and `@dnd-kit/core`, `@dnd-kit/sortable` and
`@dnd-kit/utilities` arrive in step 12 (#14) with exact pins, as an approved exception to the no-new-dependency
rule. This step consumes that one `DndContext`, mounted at the agents layout root, rather than growing its own drag
implementation, and step 30 records the bundle delta it carries.

This body already names the dependency, so there is no body drift to correct here. The half of it still open is
step 17 (#19), because this step consumes the pane and ordering behaviour that step lands. The truth is
`.dump/app/roadmap/18-multi-pane-correctness.md`.

For any issue in this range: `.dump/app/roadmap/NN-<slug>.md` is the source of truth, `#NN+2` is its issue, and an
unresolved `{{SNN}}` token resolves the same way.
```

### What this session deliberately did not do

- It did not post any comment. `gh issue comment`, `POST /repos/maus-inc/mausCode/issues/20/comments` and `PATCH`
  on the same issue all return 403 `Resource not accessible by integration`, probed 2026-09-14.
- It did not close #6. The drift pack's block for this issue says closing it is the human's call, this session
  cannot close an issue, and the answers stay readable with the issue open, so it is left as the audit trail.
- It did not ask the four questions again. They were answered by the human on 2026-09-13, and re-asking is the
  re-litigation `.dump` exists to prevent.

If the human is unreachable, the blocked steps stay blocked and the report says so plainly rather than picking an
option.
