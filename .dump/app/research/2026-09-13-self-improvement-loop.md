# Self-improvement loop: auto memory, workflows and skills, ported

**Date:** 2026-09-13. **Status:** design record for roadmap steps 24, 43 and 44. **Sources:** hermes-agent at `de2d6a1` read in `/tmp/hermes-agent` during this session, plus the public documentation and analysis listed at the end, read this session for the mechanism names and the numbers. This file refines the wording in `2026-09-13-hermes-memory-spike.md`; that file stays the read log, this one is the port brief.

## 1. What is actually being ported

Not "the agent remembers things". A closed loop with four separable parts, and the wording below is what a step must satisfy.

| Part | Upstream mechanism | mausCode equivalent |
| --- | --- | --- |
| Persist | Agent-curated facts written to `MEMORY.md` and `USER.md`, with periodic nudges to save durable knowledge | `memory_entries` table plus a rendered `~/.mauscode/memory/MEMORY.md` and `USER.md` view, so the store stays user-inspectable in a text editor |
| Distill | A background review agent reads each finished session and writes or patches a skill through the `skill_manage` tool, biased toward action | A review pass on run completion, queued as a low-priority `run_events`-adjacent task, using our `skills` procedures rather than a raw file writer |
| Reuse | Progressive disclosure, only `name` plus `description` in the prompt, body loaded on trigger via `skill_view` | The instruction loader's stable prefix carries skill metadata only, and one `skill.read` call loads the body when a turn matches |
| Improve | A skill is patched during use when it turns out stale, incomplete or wrong, patch preferred over rewrite | `skills.proposePatch`, which writes a proposal the user can accept, never a silent edit of a working skill |

## 2. The wording that replaces the vague version

Say this, not "add memory and skills":

> The agent keeps four kinds of knowledge in four places, never one context holding everything. Facts about the project and the user go to memory, what happened goes to session search, how to do a thing goes to skills, and who the user is goes to a user model. Memory and skills are files the user can read. Every write carries the run that produced it. Nothing rewrites a skill or a memory entry the user wrote, and an unattended run may only add.

And the trigger rule, which is what makes it automatic rather than opt-in folklore:

> After a task that took five or more tool calls, after fixing a non-obvious error, after recovering from a failure, or after the user corrects a method, the agent writes or patches a skill in the same session, with a description that names when to use it.

That is the substance of hermes's `SKILLS_GUIDANCE` stable-layer rule, and the reason its review loop is described as biased toward action: most sessions should produce at least one small skill update, not a grand summary once a month.

## 3. What makes it cheap, with the numbers

Three disclosure levels, and the cost per level is the design:

| Level | Content | When loaded | Cost |
| --- | --- | --- | --- |
| Metadata | `name`, `description` | Every session, in the stable prefix | about 100 tokens per skill |
| Instructions | the `SKILL.md` body | On trigger only | under 5,000 tokens |
| Resources | `scripts/`, `references/`, `assets/` | When the body says to open them | nothing until read |

The consequence we care about, and the reason this is affordable on a laptop: the per-turn cost of having forty skills is forty lines of metadata, not forty documents, so the stable prefix stays cacheable and the volatile tail stays small. This matches the placement rule already recorded for memory injection, keep the stable prefix byte-stable and put the changing things after it.

Format constraints we inherit by adopting the standard, since a skill that violates them will not load anywhere else: `name` is 1 to 64 characters, lowercase alphanumerics and hyphens, and must equal the directory name, `description` is 1 to 1,024 characters and must say both what the skill does and when to use it. The documented failure mode of real skill libraries is a vague description, reported as a smell in over 99 percent of files in one surveyed set, so our writer validates the description against that rule at write time rather than in review.

## 4. Session recall, which is a separate part

Upstream keeps searchable session history in SQLite with an FTS5 index plus LLM summarization, and a consolidation table that looks like `long_term_memory(id, fact, confidence, source_session, created_at, last_reinforced)`. Two decisions transfer directly:

1. Search over real history rather than a summary of summaries, then summarise only what a turn retrieves. Our `messages` blobs make full-text search awkward, so the recall index lives on a separate table that mirrors message text, and the migration is additive.
2. A confidence and last-reinforced pair on every distilled fact, so an entry that is never recalled or reinforced decays out of the prompt instead of accumulating forever. Without it, "auto memory" becomes a write-only graveyard that grows monotonically and silently degrades every turn.

The user model, Honcho upstream, is not ported. A local-first app that builds a persistent psychological model of its user needs its own consent conversation, which is open decision 17 in `.dump/global/questions.md`, not a background thread.

## 5. Safety, which is the part that makes this shippable

- Skills and memory are files under `~/.mauscode/`, and the app never writes outside it. A skill body that instructs the agent to touch another path is refused by the permission floor, so the floor, step 10, is a hard prerequisite.
- An agent-written skill is quarantined until accepted, listed with its provenance and its trigger text. Auto-created means auto-proposed, never auto-trusted.
- Executable parts of a skill, a `scripts/` file, are not run at install or on write. A skill cannot make the agent run something it would otherwise have to approve.
- Unattended runs may add memory and skills and may not replace or delete either, which is the same asymmetry upstream uses for its unattended writes.
- Self-modification stops at the boundary of what binds the agent. The agent may not edit `AGENTS.md`, `FULL-REVIEW.md`, the issue templates, the Biome config or a CI ratchet. Those files are how the human stays in control, and a loop that can rewrite its own rules is not a loop, it is an escape hatch.
- Nothing here authorises installing a skill from the network. That stays `find-skills` with the human's go-ahead, per `AGENTS.md` skill routing.

## 6. Steps

Step 24 owns the table, the provider interface and the memory half. Step 43 owns the skill lifecycle, the disclosure loading and the review pass. Step 44 owns session recall and the decay columns. Each cites this file, so the mechanism is written once.

## 7. Sources read for this document

- Hermes Agent documentation, `hermes-agent.nousresearch.com`, key features and the memory and skills system pages.
- "Inside Hermes Agent: How Self-Improving Skills Work", fp8.co, for the review loop, `skill_manage` operations, `patch` preference, the `SKILLS_GUIDANCE` rule text and the four-layer split.
- "SKILL.md File Structure Explained", atlan.com, and "Agent Skills: A Portable Format", ylanglabs.com, for the two required fields, their length limits, the kebab-case and directory-name constraint, the three disclosure levels with their token costs, and the skill-smell finding.
- "What Are Agent Skills?", articsledge.com, for the folder anatomy of `scripts/`, `references/` and `assets/`.
- `awesome-hermes-agent` index for `hermes-agent-self-evolution`, DSPy and GEPA prompt optimisation, recorded here as a research lead and explicitly not in scope.
- Local read: `/tmp/hermes-agent` at `de2d6a1`, `agent/memory_provider.py`, `prompt_builder.py`, `context_breakdown.py`, `skills_registry.py` and `tools/memory_tool.py`, whose line-level notes are in `2026-09-13-hermes-memory-spike.md`.
