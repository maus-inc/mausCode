## 0. Meta

| Field | Value |
| --- | --- |
| Step | 04 of 42, the four open decisions in §11.3 |
| Area | decision |
| Risk | high, because four steps are waiting on it |
| Depends on | {{S01}} |
| Blocks | {{S05}}, {{S12}}, {{S17}}, {{S18}}, {{S24}} |
| Estimate | small. Answers, not code |

## 1. Outcome

Four answers recorded in `.dump/global/questions.md` and copied into `decisions.md`. Each answer names the option, the date and the consequence for the steps it unblocks. Steps {{S12}}, {{S17}}, {{S18}} and {{S24}} may not start before their answer exists.

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

1. Put the four questions to the human, one each, with the measured fact above and the recommendation.
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
