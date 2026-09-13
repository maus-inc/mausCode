## 0. Meta

| Field | Value |
| --- | --- |
| Step | 20 of 45, wave W4 |
| Area | main |
| Risk | high |
| Depends on | {{S07}}, {{S09}}, {{S10}}, {{S19}} |
| Blocks | {{S21}}, {{S22}} |
| Estimate | medium |

## 1. Outcome

Two critics. A planner critic reviews an auto-approved plan before execution, only in the unattended case. A code critic reviews the patch before completion, and both stream their reasoning into the activity feed.

## 2. Why it matters

Unattended runs are the whole second half of this roadmap, and today nothing checks an unattended plan before it fans out into sub-chats. Triage rows 2, 3 and 4 accepted all three pieces: planning critic for auto-approved plans, adversarial critic on the code, and transparent critic reasoning in the feed. The plan's constraint is the one that keeps cost sane, so the planner critic runs only where a human did not read the plan.

## 3. Evidence

| Fact | Path or value | Level |
| --- | --- | --- |
| Plan approval is derived from a transcript marker, so the moment to intervene is known | `src/main/lib/trpc/routers/chats.ts:1918-1966` | E1, this session |
| Auto-approval exists today only as a per-MCP-server tool allow-list, not as a plan decision, so this step must define the plan-level concept before gating on it | `src/main/lib/cline-mcp.ts:54`, `src/main/lib/roo-mcp.ts:49`, and `grep -rn "autoApprove" src/main` returning only `*-mcp.ts` and `*-print/mcp-config.ts` hits | E3, this session |
| No critic code exists yet: `grep -rn "critic" src` returns only unrelated uses of the word critical | `src` | E3, this session |
| Structured output is available and has a cost, so default it off except here | `.dump/app/backend-landscape-2026-09-11.md` cross-cutting list: JSON-schema modes add validation retries | recorded |
| Sub-chat fan-out is the surface a plan critic feeds | step 19, which records what the critic must gate | by contract |
| The plan's `runtime.ts:108` plan-mode anchor does not exist on this head | `ls src/main/lib/runtime/` shows `manager.ts`, `translate.ts`, `sessions.ts`, `endpoints.ts`, `credentials.ts`, `mcp-config.ts` | E3, this session, so re-locate the refusal before touching it |

## 4. Read first, and what already exists

`AGENTS.md` on running the shared logic rather than bolting a check onto one caller. `src/main/lib/trpc/routers/agent-utils.ts` already assembles agent definitions from markdown, which is the pattern for a critic's prompt file. There is no critic today: `grep -rn "critic" src` should return nothing, and record what it returns.

## 6. Implementation plan

1. `runStructured`: one helper that asks a model for a schema-validated answer, retries once on a validation failure, and records both attempts as run events. Everything downstream uses it, so no second implementation appears.
2. Define the two schemas in `src/shared/critics/`, a plan critique with per-item verdicts, risks, and a revised plan, and a code critique with per-file findings, a severity, and a patch or a rejection.
3. Planner critic: runs only when the plan was auto-approved and the run is unattended. On a rejection it falls back to a normal approval request rather than proceeding, so it can never approve on the user's behalf.
4. Code critic: reviews the diff before completion. Findings the coder fixes in-loop, bounded rounds, then completion carries the critic's verdict whether or not it agreed.
5. Bounded rounds as a constant in `src/shared/critics/config.ts`, with the default from the plan, and the counter persisted on the run so a restart cannot reset it.
6. Stream both critics' reasoning as their own activity entries so a reader can see why a plan changed, which is triage row 4's actual ask.
7. Tests: a critic rejecting a scripted plan, the auto-approved gate holding when a human approved, round cap enforced across a restart, and a schema failure producing a visible error rather than silence.

## 8. Boundaries

- Always: the critic may only refuse, never authorise. Refusals and verdicts land in `run_events`.
- Ask first: a critic that can edit files itself, which is a capability change and belongs in the manifest.
- Never: a critic that blocks a human-approved plan, an unbounded loop, or a model call with no timeout.

## 10. Acceptance criteria

- [ ] An unattended run with a bad plan produces a critique and an approval request, not execution.
- [ ] A human-approved plan is never sent to the planner critic, asserted by a call-count test.
- [ ] The code critic's verdict is stored on the completion record whether or not the coder agreed.
- [ ] Round cap enforced across a restart, with the counter read from the run, not memory.
- [ ] One extra model call per run is the recorded cost, measured in step 12's file.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

## 12. Benchmark record

Added tokens and wall time per run with critics on and off, per mode, in `.dump/app/benchmarks/`. This feature's cost has to be a number a user can see before it ships on by default.

## 13. Rollback

Critics are off unless enabled, so revert leaves the run pipeline untouched. Their event kinds stay unread harmlessly.

## 14. Out of scope

Interactive plan brainstorming, which is triage row 5 and belongs with the composer work in {{S25}}. Scheduled unattended runs are {{S21}}.

## 15. Handoff notes

Write the two schemas and the verdict vocabulary into `.dump/app/plans/2026-09-13-critics.md`. {{S21}} and {{S22}} both read a verdict, so the names are a contract.
