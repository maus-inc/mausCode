## 0. Meta

| Field | Value |
| --- | --- |
| Step | 43 of 45, the hermes learning loop |
| Area | main, renderer, skills |
| Risk | high, the agent writes its own instructions |
| Depends on | {{S23}}, {{S24}}, {{S38}} |
| Blocks | {{S44}} |
| Estimate | large |

**Note on this issue's body.** #45 was filed before the loop brief was revised the same day. This file is the authoritative version, per `AGENTS.md`, and it carries the sharpened mechanisms the brief now states: the three disclosure levels, the six `skill_manage` actions, slash-command invocation and chaining, bundles, learn-from-source, and the inline-shell ban.

## 1. Outcome

The agent distils reusable skills from its own finished work and from material the user points it at, loads them through an index instead of pasting them into every prompt, exposes each one as a command, and patches a stale skill as a proposal the user accepts.

## 2. Why it matters

`.dump/app/research/2026-09-13-self-improvement-loop.md` §1 states the port in one sentence and §5 maps it onto our files. Today our tree has skills as readable documents and nothing more: `src/main/lib/trpc/routers/skills.ts` exposes `list`, `listEnabled`, `create`, `update` and `delete` at `:183`, `:188`, `:193`, `:257` and `:290` with sources `user | project | plugin`, `grep -rn "installSkill" src` returns nothing, and `AGENTS.md` states this repository ships two project skills, so the only way a procedure enters the agent's head is a human writing a file. The loop upstream is a review pass that writes or patches a skill after a session worth learning from, an index that costs about 100 tokens per skill rather than a document per skill, and a `patch`-first writer, which is why its library grows without breaking what already works.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Skills are readable, not agent-writable | the five procedures above, plus `installSkill` returning no hits | E1 and E3, this session |
| Two project skills today, one hand-written | `AGENTS.md` skill routing, `.agents/skills/unslop/SKILL.md`, `.agents/skills/find-skills/SKILL.md` | E1, this session |
| Disclosure levels and their costs | `skills_list()` about 3k tokens for a whole catalog, `skill_view(name)` for one body, `skill_view(name, path)` for one file | recorded in §4 of the brief |
| The writer's six actions with `patch` preferred | `skill_manage` table in §3 of the brief | recorded |
| Format limits, and the defect that kills a skill library | `name` 1 to 64 kebab-case matching the directory, `description` up to 1,024 characters, and a vague description meaning the body is never opened | §3 of the brief |
| Skills as commands, chaining, path-safe parsing, bundles as YAML aliases | §4 of the brief | recorded |
| `inline_shell` is a trust boundary upstream | §6 of the brief | recorded, and we refuse the feature outright |
| Bounded memory is what forces curation | `MEMORY.md` at 2,200 characters, `USER.md` at 1,375, §2 of the brief | recorded |
| The instruction loader that will host the index | step 23's stable and volatile split | by contract |
| The floor that keeps a skill body from becoming authority | step 10 | by contract |

## 4. Read first, and what already exists

`.dump/app/research/2026-09-13-self-improvement-loop.md` in full, then `AGENTS.md` skill routing, then the installed skills `skill-creator` for the authoring, eval and description-optimisation loop and `vercel-react-best-practices` plus `vercel-composition-patterns` for the rule-file library shape, then `src/renderer/features/agents/main/agents-slash-command.tsx` and `src/main/lib/trpc/routers/commands.ts`, which are the existing command surface a skill should register into rather than a second one to invent. Read `src/shared/codex-tool-normalizer.ts` only to see the shape of a shared validator used by ten consumers, which is what §6 item 1 is.

## 6. Implementation plan

`find-skills` for this domain has already been run and is recorded in `.dump/app/research/2026-09-13-find-skills-run.md`, four skills installed, `web-design-guidelines` and `webapp-testing` refused with reasons, and nothing covering skill management beyond `skill-creator`, which is installed. Re-run it if that file is more than a month old.

1. One validator in `src/shared/skills/`: parse the front matter, enforce both length rules and the directory-name match, require a description that states what and when in the user's words rather than in abstractions, warn on a body over budget or a missing Procedure or Verification heading, reject a literal token or key in the file, and require the rule-file shape when a body grows past one screen, one rule per file with `title`, `impact` and `tags` front matter, which is how the two Vercel skills stay cheap to load. `create`, `update`, `patch`, install and learn all call it, because two validators is a defect.
2. The writer: `skill.manage` in the skills router with the six upstream actions, `create`, `patch`, `edit`, `delete`, `write_file`, `remove_file`. `patch` takes an old and new string and is the default update path, `edit` requires a user action, `delete` refuses an agent-created skill without one. Every write stays inside `~/.mauscode/skills/`, with the traversal guard and the read-before-write discipline, and a failed write leaves the previous file intact.
3. Provenance columns on the skills table or the sidecar manifest the loader already reads: origin, run id, model, created and updated stamps, and the hash that lets an update tell a user edit from a stale copy.
4. Index loading: step 23's stable prefix carries name, one-line description and category only, `skill.read` loads one body, and `skill.read` with a path loads one file under `references/`, `templates/`, `scripts/` or `assets/`. The cacheability test from step 23 stays green, and a new test proves prompt cost grows linearly in index entries and flat in body tokens as the library grows.
5. Invocation: every installed skill becomes a slash command in the composer's existing command surface, up to five leading skill tokens chain, and parsing stops at the first token that is not an installed skill so a file path is never swallowed. Add the tests for both rules, because that boundary is what makes chaining usable.
6. The review pass: on run completion, queue one distillation task per session, bounded, reusing step 20's structured-output helper, and it emits a proposal, never a write. A session counts as worth learning from when it took five or more tool calls, fixed a non-obvious error, recovered from a failure, or carried a user correction.
7. Learn from a source: `skills.learn` takes a path or URL, writes the material as `references/` files with stable headings, and folds into an existing skill on the same topic instead of creating a near-duplicate. Cost proportionality is the acceptance test, so answering one question must not pay for the whole source.
8. Bundles after install, not before: `~/.mauscode/skill-bundles/<slug>.yaml` with `name`, `description`, a required non-empty `skills` list and an optional standing `instruction`, registered as one command, bundle precedence on a slug collision, missing members skipped with a note, and no installer behaviour, since a bundle is an alias.
9. Proposal UI in the details sidebar: the trigger text, the body, the diff when it patches, and accept or refuse, plus the same accept path for a learn result. This is user-facing design, so prototype the list and the diff view in HTML, research how two other tools present generated skills, and put two or three layout options to the human, per `AGENTS.md`.
10. Patch on use: when a loaded skill turns out stale or wrong mid-task, the agent records a patch proposal with the evidence, and the same accept path applies.
11. Tests: validation rejects a 65-character name, a directory mismatch and a vague description, the writer refuses a path outside the root, an unattended run cannot accept its own proposal, `patch` never clobbers a user edit, the index-cost test above passes, chaining and path-safe parsing behave, and no skill body executes anything at load.

## 8. Boundaries

- Always: the human accepts, never the agent. Provenance on every generated skill. Skills directory as the only write target. Description quality treated as a correctness check, not a style one.
- Ask first: any change that lets a skill body affect permissions, mode, model or tool availability, an auto-accept path including behind a setting, and any network fetch inside learn, which needs step 27's egress policy.
- Never: an inline shell or any other execute-at-load mechanism, even behind a flag. Writing `AGENTS.md`, `CLAUDE.md`, `FULL-REVIEW.md`, the issue templates, `biome.json`, a CI baseline or a workflow. Silent rewrite of a skill a user edited. Installing a skill as a side effect of this step, which is `find-skills` territory. A skill whose only record is a generated file with no reviewer.

## 10. Acceptance criteria

- [ ] A five-tool-call session with a correction in it produces exactly one proposal whose description names the correction, and nothing is written until accepted.
- [ ] The accepted skill appears in the list with origin `agent`, the run id and a validated description, and it is immediately invocable as a slash command.
- [ ] Prompt cost at 0, 10 and 50 skills grows linearly in index entries only, measured and recorded, with the stable prefix byte-identical across turns.
- [ ] `/skill-a /skill-b do the thing` loads two bodies and passes the rest as the instruction, and `/learn /tmp/scan.pdf extract tables` treats the second token as an argument. Proven by tests.
- [ ] A second learn on the same topic folds into the existing skill rather than creating a near-duplicate.
- [ ] No execution occurs at load, install, write or index time, asserted by a test that fails if a `scripts/` file is invoked.
- [ ] A proposal that would patch a user-authored skill shows the diff and cannot be accepted by the run that proposed it.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
npm run test:node
```

## 12. Benchmark record

Stable-prefix tokens at 0, 10 and 50 skills, per-turn added latency from the review pass, and the learn-path token cost of a one-question answer against a large source, in `.dump/app/benchmarks/`.

## 13. Rollback

Disable the review pass and the proposals stop, and installed or hand-written skills keep loading. Keep the validator and the `create` and `update` paths, which predate this step.

## 14. Out of scope

Per-profile agent personas, plugin-namespaced skill opt-in, the Skills Hub `--force` install path, platform-conditional activation, and the prompt-optimisation research the brief records as not ported. Auto-installing third-party skills is not in scope either, see `.dump/app/research/2026-09-13-find-skills-run.md` §5.

## 15. Handoff notes

Write the accepted-proposal flow, the validator's rule list and the index cost numbers into `.dump/app/plans/2026-09-13-skill-loop.md`, update `AGENTS.md` skill routing if the loader begins reading generated skills as a third source, and check the two rows this step settles in `.dump/ci/research/fork-network-harvest-catalog.md` if the harvest's skills row is still open when this lands.
