## 0. Meta

| Field | Value |
| --- | --- |
| Step | 38 of 42, the fork harvest, `ningzhaoxing` Category C |
| Area | main, renderer |
| Risk | medium |
| Depends on | {{S23}}, {{S31}} |
| Blocks | {{S42}} |
| Estimate | medium |

## 1. Outcome

A skill can be installed from a directory or a repository, listed, enabled per project and removed, and mausCode manages third-party tooling the way it manages MCP servers, from one store.

## 2. Why it matters

`AGENTS.md` now makes `find-skills` mandatory for every agent, which is only useful if a user can add skills at all. Today the skills router is CRUD over files in three known roots: `list`, `listEnabled`, `create`, `update`, `delete` at `src/main/lib/trpc/routers/skills.ts:183-290`, with sources `user | project | plugin` at `:14`, and this repository ships exactly one skill, `.agents/skills/unslop`. `grep -rn "installSkill" src` returns nothing, verified this session, so there is no install path. The harvest catalog rates the fork's contribution as "skills install core + tooling-management", with the care flag to review for licence, hardcoded paths and Chinese-only UI strings.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| CRUD exists, install does not | `src/main/lib/trpc/routers/skills.ts:183`, `:188`, `:193`, `:257`, `:290`; `grep -rn "installSkill" src` empty | E1 and E3, this session |
| The plugins surface already counts skills per plugin | `src/renderer/components/dialogs/settings-tabs/agents-plugins-tab.tsx:185-187` | E1, this session |
| Skills are loaded by the instruction path this step must feed | step 23, and `buildAgentsOption` at `src/main/lib/trpc/routers/agent-utils.ts:257` | E1, this session |
| The fork's review conditions | `.dump/ci/research/fork-network-harvest-catalog.md`, Category C row for `ningzhaoxing` | E1, this session |
| The format we must honour is the skill format this repo already uses | `.agents/skills/unslop/SKILL.md`, and the routing table in `AGENTS.md` | E1 |

## 4. Read first, and what already exists

`AGENTS.md` skill routing, because that table is the registry the installer writes into, and `skills.ts` before adding a procedure, since discovery, enable and disable already exist and must not be duplicated.

## 6. Implementation plan

1. `skills.install` taking a source, a local path or a repository with an optional subdirectory, resolving into a staging directory, validating `SKILL.md` front matter, name and trigger, then moving it into the user root. Never write outside `~/.mauscode/skills/`, and refuse a path that escapes it.
2. Provenance on every installed skill, name, source, resolved commit or path, installed at, and a content hash, so an update can tell a local edit from a stale copy.
3. `skills.update` and `skills.remove`, where remove refuses to delete a skill the user edited unless told to.
4. Per-project enable and disable, which is the "tooling management" half, stored beside the project so a skill can be off in one workspace and on in another.
5. The UI is a section in the existing plugins and skills tab, not a new dialog family. Prototype the list first, with the install flow's two states, and put the layout choices to the human, because this is user-facing content design.
6. Review the fork for the three named hazards, licence headers, absolute paths, and UI strings, and record in the PR what you found and what you deliberately did not take.
7. Tests: install from a fixture directory, a traversal attempt refused, an edited skill not overwritten, enable per project overriding a global disable, and removal leaving the routing table consistent.

## 8. Boundaries

- Always: staging before the move, a hash of what was installed, and nothing executable run during install.
- Ask first: fetching from the network at all, since that is an egress decision that belongs with step 27's policy, and any skill auto-enabled into a project.
- Never: executing a skill's install hook, taking a fork's hardcoded path or Chinese-only strings without review, or writing a skill into another product's directory.

## 10. Acceptance criteria

- [ ] Installing from a local path yields a listed, enabled skill the instruction loader can see in the same session, with a test.
- [ ] A skill with `../../` in its manifest cannot write outside the user skills root, proven by a test.
- [ ] Update reports a local edit rather than overwriting it.
- [ ] Per-project enable and disable change what reaches the model, shown in step 23's "what loaded" surface.
- [ ] The PR names what was reviewed in the fork and what was refused, with the reason.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
```

## 12. Benchmark record

Skill discovery time with zero, one and twenty installed skills, in `.dump/app/benchmarks/`, because the loader now touches this directory every session.

## 13. Rollback

Skills installed by this path live in a directory the old code already scans, so revert only removes the management surface.

## 14. Out of scope

A marketplace, signing, and any skill telemetry, none of which the harvest or triage approved. The vulnerability-research workflow is {{S39}}.

## 15. Handoff notes

Record the manifest fields and the staging rule in `.dump/app/plans/2026-09-13-skills-install.md`, and update `AGENTS.md`'s line that this repository ships one project skill if that stops being true.
