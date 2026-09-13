# Self-improvement loop: auto memory, workflows and skills, ported

**Date:** 2026-09-13, revised the same day after a second research pass. **Status:** design record for roadmap steps 24, 43 and 44. **Sources:** hermes-agent at `de2d6a1` read locally earlier in this session, the upstream skills and memory documentation, and the authoring guides listed in §8. This file replaces the vague framing; `2026-09-13-hermes-memory-spike.md` stays the read log.

## 1. The sentence that defines the port

Not "give the agent memory and skills". The port is this loop:

> The agent keeps four kinds of knowledge in four separate places, so no single context has to hold everything. What has been agreed goes in bounded memory files. How to do a thing goes in a skill. What happened goes in a searchable session store. Who the user is stays out until the human agrees to it. After any session worth learning from, the agent writes or patches a skill before the next turn, and it reads skills back through an index rather than by pasting them into every prompt.

And the trigger, which is what makes it automatic instead of folklore:

> After a task that took five or more tool calls, after fixing a non-obvious error, after recovering from a failure, after the user corrects a method, or after the user says learn this, the agent writes or patches a skill in the same session, with a description that names when to use it.

Upstream splits the two mechanisms and says they stack rather than compete: skills answer *how*, bounded memory answers *what has already been agreed*. Copy that split exactly, because a single growing blob is the failure mode of every "agent memory" feature.

## 2. Auto memory, with the part people omit

| Upstream | Size discipline | mausCode |
| --- | --- | --- |
| `~/.hermes/memories/MEMORY.md`, agent notes on environment, conventions, tool quirks, lessons | 2,200 characters, hard cap | `memory_entries` rows rendered into `~/.mauscode/memory/MEMORY.md`; the cap is the design, so an add that overflows must evict by recency and usefulness, never grow |
| `~/.hermes/memories/USER.md`, the user profile | 1,375 characters, hard cap | `USER.md` in the same directory, editable in the app, and the whole file is optional: if the human has not opted in to a profile, the file is empty and nothing is inferred |
| Both stay in the prompt as a small fact layer | they are in the *context* layer, not the volatile tail | our loader puts them where step 23's budget categories say, counted, with a per-file byte budget shown in the UI |

The consequence people skip: a bounded memory file forces curation, which is why upstream works. An unbounded table is a write-only graveyard that silently inflates every turn. So the eviction rule ships with the writer, not "later", and the record says which entry was dropped and why.

Two more upstream properties worth copying because they are cheap: memory and skills are plain files a user can open in an editor, and the agent may modify or delete its own skills, which is why the accept-before-write gate in §6 matters here more than it does in a CLI.

## 3. Skills, the lifecycle in full

Upstream's tool is `skill_manage`, with six actions, and the ordering of them is the lesson:

| Action | Parameters | Notes for us |
| --- | --- | --- |
| `create` | name, content, optional category | new skill; validated before write |
| `patch` | name, old string, new string | **preferred** for updates, because a small edit cannot break a working skill wholesale |
| `edit` | name, full content | reserved for a real restructure, and it needs a user action, not an agent decision |
| `delete` | name | never automatic for an agent-created skill; ask |
| `write_file` | name, path, content | supporting files under `references/`, `templates/`, `scripts/`, `assets/` |
| `remove_file` | name, path | same guard as delete |

Body shape that survives partial loading, since a model may only ever read the first screen: **When to use** (triggers in plain language), **Quick reference** (commands, paths, environment), **Procedure** (ordered steps not to improvise away), **Pitfalls** (known failure modes), **Verification** (what green looks like). Narrative and long option tables go to `references/` with stable headings so one section can be pulled instead of the file.

Format constraints we inherit from the agentskills.io standard: `name` 1 to 64 characters, lowercase alphanumerics and hyphens, equal to the directory name; `description` 1 to 1,024 characters that state both what the skill does and when to use it. Only those two fields are required; everything else is optional structure.

The single most common defect, and the reason our validator checks it: **a vague description means the skill is never loaded**. The model sees only the name and the one-liner, so if that line does not match how a person phrases a request, the body is never opened, and the author concludes the feature is broken.

## 4. Auto reading, which is the half usually left out

Two mechanisms, both needed.

**Index-driven loading, three levels:**

```text
Level 0  skills_list()          → names, descriptions, category        about 3k tokens for the whole catalog
Level 1  skill_view(name)       → one full SKILL.md plus metadata       paid only when the task matches
Level 2  skill_view(name, path) → one reference file inside that skill   paid only when the body says so
```

Level 0 is assembled once per session and lives in the *stable* prompt layer, which is what keeps the prefix cacheable while the library grows. That is the whole trick: hundreds of skills cost an index line each, not a document each. Our step 43 accepts or refuses on exactly this: token cost per session must grow linearly with index entries and stay flat in body tokens.

**Read a source into a skill.** Upstream calls it `/learn`: point the agent at material and it becomes a knowledge-base skill whose reference files cost nothing until a question needs them, and re-running it on the same topic folds the new material into the existing skill instead of creating a near-duplicate. Two properties we must copy or our skill library becomes a pile of near-duplicates within a month: dedupe by topic on re-run, and cost proportionality, so the answer pays for the slice it needed rather than the whole source.

**Skills are commands.** Every installed skill is automatically a slash command, up to five leading `/skill` tokens chain in one message and the remaining text is the instruction, and parsing stops at the first token that is not an installed skill so a file path is never swallowed. A skill that is only readable is a document; a skill that is invocable is a workflow. Our composer already has a slash-command surface, so this is registration, not invention.

**Bundles are the workflow primitive.** A bundle is a tiny YAML file in `~/.hermes/skill-bundles/<slug>.yaml` with `name`, `description`, a required non-empty `skills` list and an optional standing `instruction`. Running `/backend-dev refactor the auth middleware` loads three skills in one user message and attaches the rest as the instruction. Three rules transfer intact: a bundle takes precedence when its slug collides with a skill, because the user opted into the bundle by naming it; a missing member is skipped with a note rather than fatal; and a bundle is an alias, not an installer, so the member skills must already be present. That last one is why bundles go in after install, not before.

## 5. What this looks like in mausCode

| Mechanism | Where it lands |
| --- | --- |
| Skill index in the stable prompt layer, loaded on demand | `src/main/lib/context/` from step 23, plus `skill.read` in main |
| One slash command per skill, chaining, path-safe parsing | the composer's existing slash-command registry, fed from the skill index |
| `skill_manage` with six actions, patch preferred | `src/main/lib/trpc/routers/skills.ts`, which today has list, create, update and delete and no writer that the agent may call |
| Validation of name, description quality and body shape | `src/shared/skills/`, shared by create, patch, install and the review pass, because two validators is a defect |
| Learn from a source, deduped by topic | one procedure, `skills.learn`, writing into `references/` and folding into an existing skill when the topic matches |
| Bundles | `~/.mauscode/skill-bundles/<slug>.yaml`, same four fields, registered as one command |
| Bounded memory | `memory_entries` plus rendered `MEMORY.md` and `USER.md`, with the eviction rule beside the writer |
| Session search | `search_documents` plus an FTS5 table over message text, step 44 |
| Scheduled routines and runs | our `schedules` and `schedule_runs` from step 21; upstream keeps `cron/jobs.json` and `cron/output/`, and the shape we need is the run record, not a new clock |

## 6. Safety, which is what makes it shippable in an app with an agent in it

- Upstream ships an `inline_shell` flag that lets a skill body run shell snippets on the host at load time, and its own documentation calls that flag a trust boundary for the entire skill source rather than a convenience toggle. mausCode has no equivalent. A skill body never executes at load, at install, at write or at index time, and there is no flag to enable one. Anything a skill wants run is a normal tool call through the permission floor from step 10.
- Secrets referenced, never embedded. Upstream routes a skill's required keys to the profile env file and keeps non-secret settings in config; we route both through the credential owner from step 11, and a skill's front matter holding a literal token fails validation rather than being redacted on the way past.
- External and legacy directories are read-only. Upstream gives the local directory precedence over external ones and silently skips paths that do not exist; we adopt both behaviours, and mausCode writes only inside `~/.mauscode/`.
- Nothing about an auto-created skill is auto-trusted. A generated skill is a proposal with its provenance and trigger text, listed in the UI, and accept is a user action. Auto-created means auto-proposed.
- The agent may not touch what binds it: `AGENTS.md`, `CLAUDE.md`, `FULL-REVIEW.md`, the issue templates, `biome.json`, `.github/ci-baselines/`, any workflow, and any gate. A loop that can rewrite its own rules is not a loop, it is an escape hatch.
- Installing from a registry stays a human decision through `find-skills`, with the quality bar in `AGENTS.md`. Skills.sh is a zero-curation, install-ranked directory with a documented history of a bypassed malicious-skill detector, so an install-count ranking is popularity, not review. A generated or fetched skill is treated with more suspicion than one we wrote by hand.
- Unattended origins may add memory and skills, and may not replace, delete or accept. Same asymmetry upstream uses, and the only honest one for a run nobody is watching.

## 7. What is deliberately not ported

Honcho dialectic user modelling, which needs its own consent conversation and sits at item 17 in `.dump/global/questions.md`; `hermes-agent-self-evolution`, DSPy and GEPA prompt optimisation, which changes prompts by search rather than by evidence and cannot be reviewed in a PR; the Skills Hub's `--force` install path, since our install discipline is the `find-skills` gate; and per-profile multi-agent personas, which are a product decision of their own.

## 8. Sources

- `/tmp/hermes-agent` at `de2d6a1`, read earlier this session: `agent/memory_provider.py`, `agent/prompt_builder.py`, `agent/context_breakdown.py`, `agent/skills_registry.py`, `tools/memory_tool.py`, and the skill tool surface. Line-level notes are in `2026-09-13-hermes-memory-spike.md`.
- Upstream docs: the Skills System page for the disclosure table, `skill_manage` action list, bundle YAML schema and precedence rules, external skill directories and `skills.create_dir`; the "Working with Skills" guide for `skills_list`, `skill_view`, slash-command chaining, plugin-namespace opt-in loading, config injection on load, and the `references/`, `templates/`, `scripts/` layout.
- The memory-system write-ups in the same family for the 2,200 and 1,375 character caps, the `state.db` FTS5 session store, `cron/jobs.json` and `cron/output/`, and the skills-answer-how memory-answer-what distinction.
- Authoring guides for the body outline that survives partial loading, the `${HERMES_SKILL_DIR}` and `${HERMES_SESSION_ID}` substitutions, the `inline_shell` trust boundary, the secrets-versus-config split, and the troubleshooting list for a skill that never appears in the index.
- `.dump/app/research/2026-09-13-find-skills-run.md`, written the same day, for the registry's curation and security posture.
