## 0. Meta

| Field | Value |
| --- | --- |
| Step | 33 of 42, the migration thesis, competitive record C7 |
| Area | main, renderer, shared |
| Risk | high, it reads another tool's files and writes ours |
| Depends on | {{S10}}, {{S11}}, {{S14}}, {{S24}}, {{S26}}, {{S27}}, {{S28}} |
| Blocks | {{S34}} |
| Estimate | large |

## 1. Outcome

A user points mausCode at their machine and gets Detect, Preview, Map, Confirm, Import for Claude Code and OpenCode, with a manifest recording every decision and originals untouched.

## 2. Why it matters

The product thesis is migration, and the concrete version of it is that a user arrives with history rather than empty state. The research file for this step spells the flow out in full, including seven documented assumptions, so the design is not invented here. Importing is also the only feature on the roadmap that turns the app's own surfaces into the destination of a foreign setup: instructions, skills, MCP servers, provider routes and sessions, which is why it sits after steps 11, 24, 27 and 28 rather than early.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The engine already parses five transcript formats | `runtime/jcode/crates/jcode-import-core`, directory present with 10 tracked files | E3, this session |
| The flow, the assumptions and the MVP scope are designed | `.dump/app/research/migration-system.md`, including A1 untrusted transcripts, A2 credentials referenced not copied, A3 hooks imported disabled, A4 collisions by namespacing, A5 models to routes, A6 idempotency, A7 no phone-home | E1, read this session |
| One import path already exists and is narrower | `src/main/lib/trpc/routers/sandbox-import.ts`, the 21st-sandbox to local worktree importer | E1, this session, read it before writing a second importer |
| Provider config readers to reuse for detection | `src/main/lib/claude-config.ts`, `src/main/lib/qwen-mcp.ts`, and the per-provider `*-mcp.ts` family from step 28 | E1, this session |
| Instructions and skills have a home to be written into | step 23's loader, `src/main/lib/trpc/routers/skills.ts` | E1 for the router |
| Sessions can be created without a repository, which a scratch import needs | step 26 | by contract |

## 4. Read first, and what already exists

`AGENTS.md` on the shared owner and on not writing a per-provider credential store. `.dump/app/second-brain.md` for the placement rule that detection belongs in the runtime because it needs file access on the node's machine, not the laptop's. Read `sandbox-import.ts` first, because it is the nearest existing shape and the temptation will be to parallel it rather than generalise it.

## 6. Implementation plan

1. `src/main/lib/import/` with four stages as separate modules, each returning data the UI renders, so a preview can never be skipped to reach the write.
2. Detect: enumerate known paths, read headers and manifests rather than whole files where the format allows, and produce a per-tool record with counts, skills, MCP servers, sessions and rules present or absent. No file contents leave the process.
3. Preview: one card per source, listing exactly what mausCode will create, including which MCP entries become registry rows from step 28 and which instructions become project files rather than a user file.
4. Map: field-level resolution for the ambiguous parts, model to route, name collisions namespaced by source, and a flag with no equivalent that lets the import proceed without that item.
5. Confirm: per-item checkboxes defaulting to the safe subset, instructions, skills and MCP names, with credentials and hook execution excluded, and hooks arriving disabled per assumption A3.
6. Import: one transaction per workspace, writing a manifest with source paths, hashes, decisions and timestamp. Copy, never move. Rollback means deleting what the manifest lists, so the manifest is the only place deletions are authorised.
7. Transcript import marks provenance and renders a banner, and never auto-executes an intent found in history, per assumption A1. Feed the engine's parser output through the same untrusted path as provider stdout.
8. Idempotency: a rerun with the same manifest skips completed items, and each item's fingerprint decides that, not the file's mtime.
9. Tests: collision namespacing, a hook arriving disabled, credentials never copied, a rollback deleting only manifest rows, an idempotent rerun, and a traversal attempt through a crafted path in a foreign config being refused.

## 8. Boundaries

- Always: originals untouched, credentials referenced not copied, imported content treated as untrusted input, and every write listed in the manifest before it happens.
- Ask first: importing a hook definition at all, and any auto-migration of legacy 1Code worktrees, which is a separate ratified decision with its own design.
- Never: moving or deleting a source file, writing a key into a provider config, auto-enabling imported hooks, or executing anything found inside an imported transcript.

## 10. Acceptance criteria

- [ ] Detection on a machine with Claude Code and OpenCode installed reports both with counts, and reads no more than headers where the format permits.
- [ ] Preview lists every write before it happens, and an import with nothing checked writes nothing.
- [ ] A name collision produces a namespaced entry rather than an overwrite, with a test.
- [ ] No credential value appears anywhere in mausCode's store after an import; a test greps the database file for the source key.
- [ ] An imported transcript renders with a provenance banner and cannot start a run by itself.
- [ ] Rollback restores the previous state exactly, proven by comparing before and after trees.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual: import a fixture home directory with both tools present, one collision, one hook, and one credential, then read the manifest.

## 12. Benchmark record

Detection wall time on a large home directory, and imported session count per second, in `.dump/app/benchmarks/`.

## 13. Rollback

Manifest-driven. Deleting the rows named there is the rollback, and it is also the tested path.

## 14. Out of scope

The full six-tool matrix, which the research file marks post-MVP, and any hosted or account-based import, since there is no control plane. Cursor and Hermes follow as their own steps if demand appears.

## 15. Handoff notes

Write the shipped stage contract and the manifest schema into `.dump/app/plans/2026-09-13-import-flow.md`, and note which of the seven assumptions held in practice, since {{S34}} reads environment state through the same detector.
