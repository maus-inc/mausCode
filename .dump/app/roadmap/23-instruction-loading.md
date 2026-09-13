## 0. Meta

| Field | Value |
| --- | --- |
| Step | 23 of 42, wave W10 first half, triage row 32 |
| Area | main, shared |
| Risk | high |
| Depends on | {{S01}}, {{S09}}, {{S12}} |
| Blocks | {{S24}} |
| Estimate | medium |

## 1. Outcome

Instruction files are loaded once per session, split into a stable prefix and a volatile tail, counted in the context budget, and never silently truncated. A user can see which instruction files reached a turn.

## 2. Why it matters

The escalation in triage row 32 asked for hermes-agent's context-loading logic, deep, automatic and performance-positive. The mechanism that makes it performance-positive is placement, not cleverness: hermes splits the prompt into a stable part that stays cacheable and a volatile part, and keeps injected context out of the prefix. This repo concatenates everything once, so per-turn context invalidates the prompt cache and long instruction files get cut with no notice. It also means the instruction truth in step 01 is only half the fix: a document the model never sees cannot bind anyone.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Today everything is concatenated once, so there is no stable and volatile split | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §7, naming `claude.ts` as the current concatenation site | recorded, locate the exact call before editing |
| Memory cost is its own budget category upstream, with its own glyph and count | hermes `agent/context_breakdown.py:25`, `_memory_blocks` at `:64-74`, split at `:125-137` | recorded from the spike |
| Truncation is silent and enforced by prompt text, which the spike rejects in favour of a write-time rule | spike §6, the 60-character description rule and "anything past char 60 is silently cut" | recorded |
| One trivial-input predicate exists upstream to skip recall per turn | spike §1, `TRIVIAL_PROMPT_RE`, with the exact non-matching cases `k8s`, `yolo`, `note` | recorded |
| The slash-command path re-derives context today | `src/renderer/features/agents/main/active-chat.tsx:4003` | recorded, re-verify the line |
| Harness events can now carry a compaction signal, which this needs for its checkpoint | step 09 maps `compacted` | by contract |

## 4. Read first, and what already exists

`AGENTS.md`, since it is the file whose reachability this step is about. `src/shared/` has no context-assembly module, which is why this belongs in main: the renderer must not re-read files. `docs/backend-porting-recipe.md` §7 governs the capability claim that instruction loading changes.

## 6. Implementation plan

1. `src/main/lib/context/` with one loader that resolves instruction sources in a fixed priority, project `AGENTS.md`, then `CLAUDE.md`, then the user's home file, and reports which it read.
2. Split the assembled prompt into `stable` and `volatile` explicitly, and return both. The stable part holds the system prompt and the skill or instruction index, the volatile part holds per-turn injections. Cacheability is the deliverable, so measure it.
3. Budget: give instructions and recalled context their own categories with token counts, and refuse to load past a cap with a visible notice rather than truncating. Enforcement at write time, per the spike's rule, since a prompt-side promise is a hope.
4. Add the trivial-input predicate as one pure shared function in `src/shared/`, with the upstream non-matching cases as tests, so `k8s` still reaches the model and `hi!` does not.
5. Stop re-deriving context on the slash-command path: the loader result is cached per session and invalidated by the session-switch events.
6. Checkpointing: on `compacted`, hand the loader's resolved sources to the summariser so instructions survive compression, and fail closed if the handoff is empty.
7. Tests: priority order, one read per session, a stale-cache invalidation on a resumed or forked session, cap enforcement producing a notice not a cut, and the trivial-input table.

## 8. Boundaries

- Always: read-only on the user's instruction files, and a visible list of what loaded.
- Ask first: anything that changes what the model is told about its own permissions, which is step 10's surface.
- Never: write to a user's `AGENTS.md` or `CLAUDE.md`, silently drop a file over the cap, or move file reading into the renderer.

## 10. Acceptance criteria

- [ ] A turn shows which instruction files reached it, in a details surface, with token counts per category.
- [ ] The stable prefix is byte-identical across turns in the same session while the volatile tail changes, proven by a test.
- [ ] A 200 KB instruction file produces a visible refusal or a documented split, never a silent cut.
- [ ] `k8s`, `yolo` and `note` do not skip loading, and `hi!`, `thanks :)`, `done???` do, from the shared predicate's tests.
- [ ] No file read of `AGENTS.md` or `CLAUDE.md` from renderer code, checked with a grep named in the PR.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
grep -rn "AGENTS.md" src/renderer | wc -l   # expected: 0
```

## 12. Benchmark record

Prompt cache hit rate and per-turn tokens before and after the split, plus wall time to first token, in `.dump/app/benchmarks/`. "Performance-positive" is the accepted requirement, so this file is the acceptance proof, not a formality.

## 13. Rollback

The loader is one call site swap, so revert returns concatenation. Keep the tests, they describe a requirement the next attempt will share.

## 14. Out of scope

The memory store, its table and its writes, which are {{S24}}. Skill authoring and the marketplace shape were not accepted in triage.

## 15. Handoff notes

Write the priority list, the caps and the cacheability rule into `.dump/app/plans/2026-09-13-context-loading.md`. {{S24}} reads that file for the split it must respect.
