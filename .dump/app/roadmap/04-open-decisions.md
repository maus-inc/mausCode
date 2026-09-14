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
| SDK line | `package.json` pins `@anthropic-ai/claude-agent-sdk` `0.2.45`; the inherited release note names `0.2.63`; the plan recommends `0.3.270` | `.dump/app/plans/release-parity-v0.0.75-0.0.84-plan.md` §5.1 |
| Drag and drop | no `@dnd-kit` in dependencies, verified this session; split machinery and `MAX_SPLIT_PANES = 4` already exist | `package.json`, `src/renderer/features/agents/stores/sub-chat-store.ts:10` |
| Codex default | two constants disagree: `gpt-5.5` against `gpt-5.5/high` | `src/main/lib/trpc/routers/codex.ts:146`, `src/renderer/features/agents/lib/acp-chat-transport.ts:41`, verified this session |
| Memory owner | the vendored engine ships its own memory graph, and `src/shared/contracts` has 24,860 lines with zero importers outside itself, verified this session | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §7, `.dump/app/plans/2026-09-12-jules-port-plan.md` F1 |

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

- [ ] Four dated entries in `.dump/global/decisions.md`, each naming the rejected option too.
- [ ] `.dump/global/questions.md` items 1 to 4 removed or marked answered.
- [ ] A comment on issues {{S12}}, {{S17}}, {{S18}}, {{S24}} saying they are unblocked and by which answer.

## 11. Verification

```sh
grep -c "2026-09" .dump/global/decisions.md
gh issue view {{S12}} --json comments,labels
```

## 13. Rollback

An answer can be reversed. The reversal is a new dated entry, not an edit.

## 14. Out of scope

Any code. This step closes when the answers exist.

## 15. Handoff notes

If the human is unreachable, the blocked steps stay blocked and the report says so plainly rather than picking an option.
