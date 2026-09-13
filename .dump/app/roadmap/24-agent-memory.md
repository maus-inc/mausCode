## 0. Meta

| Field | Value |
| --- | --- |
| Step | 24 of 45, wave W10 second half, triage row 31 |
| Area | main, shared, renderer, db |
| Risk | high |
| Depends on | {{S04}} decision 4, {{S07}}, {{S09}}, {{S11}}, {{S23}} |
| Blocks | {{S25}}, {{S26}} |
| Estimate | large |

## 1. Outcome

The agent learns entries, stores them with provenance in one table, recalls them per turn through a provider interface with timeouts, shows a counted indicator, and cannot rewrite or delete what a user recorded when it runs unattended.

## 2. Why it matters

Triage row 31 escalated this from a feature into a deep port: "automatically we will deeply yet performance positive, copy and port hermes-agent memory system and logic". The spike records why that design is the right one: memory there is not a store, it is a lifecycle with seven call moments, hard timeouts, a fail-closed compression hook, and a write gate for unattended runs. Each of those is a bug class prevented, so a simpler "dump notes into the system prompt" version would regress caching, leak stale context into one-word replies, and let a scheduled job rewrite the user's notes.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The seven moments, their contracts and their budgets | `.dump/app/research/2026-09-13-hermes-memory-spike.md` §1, `agent/memory_provider.py`, 175 lines read in full there | recorded |
| Manager rules worth copying: one external provider, capability duck-typing, 5 s drain and 8 s prefetch timeouts, context-bound threads, fail closed on partial data | same spike §2 | recorded |
| The unattended write gate keeps `add` and refuses `replace` and `remove` | same spike §4, `tools/memory_tool.py:132-134` | recorded |
| The prompt-cache-preserving placement, memory in the volatile tail | same spike §3, `context_breakdown.py:125-137` | recorded |
| The split it must respect, and where memory lands | step 23 | by contract |
| The event it checkpoints on | step 09, `compacted` | by contract |
| The store has no repair or maintenance path today | one `src/main/lib/db` module against 21 upstream modules named in spike §5 | recorded, verify by listing our db dir |
| A credential-store owner now exists to copy the policy shape from | `src/main/auth-store.ts`, step 11 | E1, this session |

## 4. Read first, and what already exists

The spike's §7 mapping table is the design brief, including which hook maps to which of our files. `AGENTS.md` requires one owner for shared logic, which is why recall and redaction live in the manager and never in a provider. `src/shared/` has no knowledge module, and `buildAgentsOption` plus the markdown agent files are the nearest existing "the agent knows things from files" pattern, so read it to keep the two consistent.

## 6. Implementation plan

1. `memory_entries`: `id`, `scope` global or project path, `target` memory or user profile, `content`, `source` tool name, `origin` interactive or schedule or flush, `runId`, `sessionId`, `createdAt`, `lastUsedAt`, `useCount`, `supersededBy`. Provenance columns are required, because "who taught the agent this" has to be answerable. Two hard budgets ride along, and they are the design rather than a nicety: upstream caps its agent-notes file at 2,200 characters and the user profile at 1,375, which is what forces curation. Implement the same pressure here, per scope and target, with an eviction rule written beside the writer that drops the least recently useful entry and records what it dropped and why in `.dump`. An unbounded table is a write-only graveyard that silently inflates every turn.
2. `src/main/lib/knowledge/provider.ts` and `manager.ts`, with the seven moments and the two hard timeouts from the spike, plus `is_available` that never touches the network. One external provider, enforced in the manager, with the reason the spike gives, tool-schema bloat and conflicting backends.
3. Recall path: queue after each finish, consume next turn, capped at 8 seconds, non-blocking, and skipped by the trivial-input predicate from step 23. A failed queue insert is logged and swallowed, never fatal to a turn.
4. Injection: volatile tail only, one wrapper that redacts then formats, so no provider can forget redaction. The manager owns sanitising, as the spike records upstream doing.
5. Write path: `add`, `replace`, `remove` with locate-by-text, and a gate that reduces unattended origins to `add` only. Size rules enforced at write time, with the failure text naming the cap.
6. Compression checkpoint, version 2 and fail-closed: hand normalised evidence to the summariser, and if the handoff is empty, fail the compression rather than proceed with partial memory.
7. Session identity: on `on_session_switch`, distinguish reset from rewind, and map our fork path to reset true and rewind false as the spike's table records.
8. Delegation: a child's completion appends a parent-side observation, so a fan-out teaches the parent without importing the child's transcript.
9. UI: a chip in the composer with the count from the last prefetch only, and one settings view listing entries with scope, source, timestamp, use count, and edit and delete actions. No new panel, and no marketing copy about the agent "learning".
10. Tests per guard, since each is the point: trivial-input table, timeout ceiling, fail-closed compression, unattended gate rejecting a replace, fork path resetting state, redaction in the wrapper, and the store's repair path against a corrupted copy.

## 8. Boundaries

- Always: unattended writes accumulate, never rewrite; provider recall bounded by the 8 s ceiling; provenance on every entry; nothing secret in memory, which step 11 enforces by refusing to store a token there at all.
- Ask first: any provider that persists outside the app home, any automatic promotion of an entry into an instruction file, and any human-reaching action justified by a recalled entry.
- Never: reading a provider's private store without the ratified decision, injecting into the stable prefix, letting a provider write unredacted, or copying a child transcript into a parent as a memory.

## 10. Acceptance criteria

- [ ] A correction the user states is recallable in a later session, visible in the settings list with its source.
- [ ] The chip counts only the most recent prefetch, with a test asserting a stale count cannot render.
- [ ] A scheduled or autopilot run cannot replace or remove an entry, with a failing-on-current-tree test.
- [ ] A run with a wedged provider still finishes within the ceiling, asserted with a fake slow provider.
- [ ] Cacheability holds after injection, using step 23's test.
- [ ] Compression with an empty checkpoint fails visibly.
- [ ] Gates green, and a benchmark file exists proving the cost claim.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
npm run test:node
```

## 12. Benchmark record

Per-turn added latency with the provider absent, present and slow, plus prompt cache hit rate with memory on and off, in `.dump/app/benchmarks/`. This step's acceptance depends on that file existing, because the requirement was performance-positive, not merely pleasant.

## 13. Rollback

Provider absent by default and the table additive, so revert removes the surface while entries stay. Do not delete rows on rollback, because a user may have curated them.

## 14. Out of scope

A memory plugin directory, a learning graph visualisation, and hosted sync, none of which triage accepted. The store split suggested by spike §5 is its own infra step and must not be smuggled in here.

## 15. Handoff notes

Record the shipped lifecycle, the caps and the store ownership outcome in `.dump/app/plans/2026-09-13-memory.md`, with the decision from {{S04}} quoted at the top so the reader knows who chose it.
