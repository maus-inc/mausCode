## 0. Meta

| Field | Value |
| --- | --- |
| Step | 19 of 42, wave W3, the escalation of triage row 23 |
| Area | main, renderer |
| Risk | high |
| Depends on | {{S07}}, {{S08}}, {{S10}}, {{S17}}, {{S18}} |
| Blocks | {{S20}}, {{S21}}, {{S22}} |
| Estimate | large |

## 1. Outcome

An agent can open each item of a plan in its own sub-chat, and the chat that created them can prompt those children, watch them and report back, on three selectable modes: fan out, supervise, and a dedicated orchestrator.

## 2. Why it matters

The user rejected a CLI `--parallel` flag and asked for this instead, in the custom answer recorded at triage row 23: "tell the agent to open each item in a curated plan in a new chat so you can perfectly continue /chat those subchats ... but also the chat that created the subchats can also prompt them, monitor them to report back manage them etc, when or if asked." Parallel work is the product's whole premise, and today a sub-chat is a tab, not a child with a parent that can read it.

## 3. Evidence

| Fact | Value | Path |
| --- | --- | --- |
| Sub-chats exist as tabs with a store and no parent link: the table has `chatId`, `mode`, `provider`, `sessionId`, `streamId`, `messages`, and no parentage or order column | `src/main/lib/db/schema/index.ts`, the `subChats` definition | E1, this session |
| No orchestration surface exists in main: `grep -rn "orchestration" src/main/lib/trpc/routers` returns nothing | `src/main/lib/trpc/routers/` | E3, this session |
| Provider subagents are already assembled from markdown mentions, so the pattern to copy exists | `buildAgentsOption` at `src/main/lib/trpc/routers/agent-utils.ts:257`, called from `claude.ts:1147` | E1, this session |
| Run records with events and a cursor now exist | step 07 | by contract |
| Optimistic create gives the client id reconciliation this needs | step 17 | by contract |
| Child completion must reach the parent without duplicating transcripts | the hermes spike records a parent-side `on_delegation` hook for exactly this | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §1, §7 |
| A summary contract is needed, not a transcript copy | tldr limited to 200 characters, recorded in the plan's W3 | `.dump/app/plans/2026-09-12-jules-port-plan.md` |

## 4. Read first, and what already exists

`AGENTS.md` on one owner for shared logic. `buildAgentsOption` already reads markdown agent definitions and the SDK supports subagents, but the plan's answer is that in-app orchestration must not depend on provider-specific subagent behaviour, so build on runs and sub-chats, which every engine has.

## 6. Implementation plan

1. Add `sub_chat_links`: parent id, child id, origin, created at, status. A child knows who spawned it and why, which is what makes supervision possible without polling.
2. `orchestration.fanOut(planId, items[], mode)`: creates N sub-chats through the optimistic path, seeds each with its item plus the shared context, and returns the created ids. A mode of `fan-out` stops there.
3. `supervise`: the parent may send to a child, read its last event, and request a tldr. `orchestrator`: a dedicated child agent owns the loop, and the parent reads only its reports. Mode is chosen per run, recorded on the run, so a resumption is honest about what it was.
4. Child completion appends a summary event to the parent, capped at 200 characters, with the child's run id, and never the transcript. Duplicating a child's transcript into a parent is a context and cost bug, and the memory spike names it as the reason the hook is parent-side.
5. Depth and breadth caps: bounded spawn depth, capped concurrent children per parent, and the caps are constants in `src/shared`, not magic numbers in three files.
6. UI: the rail shows a child with its parent indented and its status from the run, not from a component timer. Reuse the sidebar's existing row, consume only.
7. Tests: fan out of three items, one child failing while others finish, depth cap refusal, tldr truncation, and the parent's report surviving a reload.

## 7. Contracts this changes

| Contract | Before | After |
| --- | --- | --- |
| Persistence | sub-chats flat | `sub_chat_links` records parentage |
| tRPC | none | `orchestration.fanOut`, `.promptChild`, `.childStatus`, `.report` |
| Run events | per run | parent receives a summary event kind |

## 8. Boundaries

- Always: children inherit the workspace permission policy and never broaden it, and every child is a real run with an evidence bundle when it claims done.
- Ask first: any auto-approval of a child's pending permission request, which is the exact place this feature could become dangerous.
- Never: a transcript copied into a parent's context, an unbounded fan-out, a provider-specific subagent dependency, or a child that can spawn without a recorded parent.

## 10. Acceptance criteria

- [ ] A plan item list becomes N sub-chats in one action, each independently continuable with `/chat`.
- [ ] The parent receives one summary per child, at or under 200 characters, with a link to the child run.
- [ ] A child cannot gain a permission its parent lacked, proven by a test against step 10's evaluator.
- [ ] Depth and concurrency caps are enforced and observable, with a denial message naming the cap.
- [ ] Killing the parent leaves children running, and the rail says so rather than lying.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
node scripts/ci/typecheck-ratchet.mjs
```

## 12. Benchmark record

Peak resident memory and total tokens for a three-child fan-out against one sequential run, in `.dump/app/benchmarks/`. This feature's cost is the claim that matters.

## 13. Rollback

The table is additive and unread by older code. Revert the procedures; leave the rail rendering the flat list.

## 14. Out of scope

The critic that checks the plan before it fans out, which is {{S20}}. Scheduling a fan-out is {{S21}}.

## 15. Handoff notes

Record the three modes and the caps in `.dump/app/plans/2026-09-13-orchestration.md`, and note there what {{S20}} must gate on.
