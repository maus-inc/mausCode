## 0. Meta

| Field | Value |
| --- | --- |
| Step | 43 of 45, the hermes learning loop |
| Area | main, renderer, skills |
| Risk | high, the agent writes its own instructions |
| Depends on | {{S23}}, {{S24}}, {{S38}} |
| Blocks | {{S44}} |
| Estimate | large |

## 1. Outcome

The agent distils reusable skills from its own finished work, loads them by progressive disclosure instead of pasting them into every prompt, and patches a stale skill as a proposal the user accepts.

## 2. Why it matters

`.dump/app/research/2026-09-13-self-improvement-loop.md` is the brief and states the wording this step implements. The mechanism upstream is a background review pass that reads each finished session and writes or patches a skill through one tool, biased toward action, with the trigger rule recorded as a stable-prompt instruction after a task of five or more tool calls, a fixed non-obvious error, a recovery, or a user correction. What makes it affordable is disclosure, names and descriptions in the prompt, bodies on trigger, support files on read. Our tree has skills as readable files, `src/main/lib/trpc/routers/skills.ts` at 183, 188, 193, 257 and 290 with sources `user | project | plugin`, and no writer, no lifecycle, no review pass, verified this session, so today the agent's hardest-won procedures are lost when a session ends and a fresh one re-derives them.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Skills are readable, not writable | the five procedures above, and `grep -rn "installSkill" src` returning nothing | E3, this session |
| The format and its hard limits | `name` 1 to 64 characters, kebab-case, matching the directory name, `description` up to 1,024 characters stating what and when | recorded in §3 of the brief |
| Disclosure costs | about 100 tokens per skill for metadata, body under 5,000 tokens on trigger, resources free until read | recorded in §3 of the brief |
| The documented failure mode of a skill library is a vague description | §3 of the brief, the skill-smell finding | recorded |
| Upstream prefers `patch` over rewrite, and its tool has four operations | §1 and §2 of the brief, `skill_manage` with `create`, `edit`, `patch`, `write_file` | recorded |
| Our instruction loader is where the metadata list lands | step 23's stable and volatile split | by contract |
| The permission floor is the only thing keeping a skill body from becoming authority | step 10 | by contract |

## 4. Read first, and what already exists

`.dump/app/research/2026-09-13-self-improvement-loop.md` in full, `AGENTS.md` skill routing including the refusal rule for a skill that asks to widen an approval or skip a gate, and `src/main/lib/trpc/routers/agent-utils.ts` which assembles the prompt-side agent definitions today.

## 6. Implementation plan

1. Validation first, in `src/shared/skills/`: parse `SKILL.md` front matter, enforce the two field rules, enforce the directory-name match, and report the skill-smell cases the standard warns about, an empty or generic description, a body over budget, a trigger phrase missing. One module, reused by `create`, `update`, `patch`, install, and by the writer in this step.
2. Writer surface: extend the skills router with the four upstream operations, `create`, `edit`, `patch` and `write_file`, all of them writing under `~/.mauscode/skills/<name>/` only, with a path-traversal guard. `patch` is preferred by the API shape, not just by advice, so `edit` requires an explicit user action.
3. The review pass: on run completion, queue one low-priority distillation task per session, and it may write a skill proposal, not a skill. Bounded to a per-run budget so it cannot loop, and it reuses the structured-output path from step 20.
4. Proposal UX: a list under the run, each with the trigger text, the body, the diff if it patches an existing skill, and accept or refuse. Accepting writes it, refusing records the reason in `.dump` so the same proposal is not repeated. This is user-facing design, so prototype the surface in HTML, research how two other tools present generated skills, and put two or three layout options to the human before building.
5. Disclosure loading: step 23's stable prefix carries the metadata list only, a `skill.read` loads a body when the turn matches, and support files load on demand. The prompt-cache test from step 23 must stay green, which is the proof that forty skills cost forty lines.
6. Patch on use: when a loaded skill turns out stale or wrong mid-task, the agent records a patch proposal against it, with the evidence, and the same accept path applies.
7. Refuse execution: a skill's `scripts/` file is never run at install, at write, or at load. Running it is a normal tool call through the permission floor.
8. Tests: validation rejects a 65-character name and an empty description, the writer refuses a path outside the skills root, an unattended run cannot accept its own proposal, a `patch` does not clobber a user edit, and the prompt cost of N skills grows linearly at metadata only.

## 8. Boundaries

- Always: the agent proposes and the human accepts, provenance on every generated skill including the run id and the trigger text, and the skills directory as the only write target.
- Ask first: any change that lets a skill body affect permissions, mode or tool availability, and any auto-accept of a generated skill, including behind a setting, until the human agrees to it.
- Never: writing `AGENTS.md`, `CLAUDE.md`, `FULL-REVIEW.md`, the issue templates, `biome.json`, a CI baseline, a gate or a workflow, and never a skill that instructs the agent to bypass step 10, because that is the escape hatch this boundary exists to close.

## 10. Acceptance criteria

- [ ] A five-tool-call task with a correction in it produces one skill proposal naming the correction in its description.
- [ ] The accepted skill appears in `skills.list` with source `agent`, the run id, and a validated description.
- [ ] Loading it costs one metadata line per session until it is triggered, measured, not asserted.
- [ ] A proposal that would edit a user-authored skill is refused and shows the reason.
- [ ] No skill, generated or installed, can change a permission, and a test proves the floor still denies it.
- [ ] Gate evidence recorded in `.dump`, including the prompt-cost numbers.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
npm run test:node
```

## 12. Benchmark record

Tokens in the stable prefix at 0, 10 and 50 skills, and per-turn added latency from the review pass, in `.dump/app/benchmarks/`.

## 13. Rollback

Disable the review pass and the proposals stop, existing skills stay and remain loadable. The writer procedures stay, since `create` and `update` predate this step.

## 14. Out of scope

Installing generated skills from a shared registry, deferred behind `find-skills` policy, the self-evolution prompt research noted in the brief, and the user model, which is {{S44}} and an open question.

## 15. Handoff notes

Record the accepted proposal, the trigger text and the validation rule set in `.dump/app/plans/2026-09-13-skill-loop.md`, and update `AGENTS.md` skill routing if a generated skill becomes a source the loader reads, so the routing table stays true.
