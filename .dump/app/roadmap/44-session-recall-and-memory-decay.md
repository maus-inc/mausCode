## 0. Meta

| Field | Value |
| --- | --- |
| Step | 44 of 45, the hermes learning loop, recall half |
| Area | main, db |
| Risk | medium |
| Depends on | {{S07}}, {{S24}}, {{S43}} |
| Blocks | nothing |
| Estimate | medium |

## 1. Outcome

Past sessions are searchable by content rather than by scrolling, the agent recalls them through a bounded index with summarisation applied only to what a turn retrieves, and every remembered fact carries confidence and a last-reinforced stamp so stale knowledge fades instead of accumulating.

## 2. Why it matters

Step 24 gives the agent a memory of facts. Facts without history are a sticky note. The upstream design keeps the two apart on purpose, persistent facts in memory files, what happened in a searchable session index, SQLite with an FTS5 table upstream, and a consolidation row shaped like `id, fact, confidence, source_session, created_at, last_reinforced`. Our tree stores every message inside one JSON text column per sub-chat, verified this session in the `subChats` definition, so history is unsearchable except by loading whole rows, and there is no decay, so any future memory layer would grow monotonically and quietly cost more every turn.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Messages are one JSON blob per sub-chat, no per-message table | the `subChats` definition in `src/main/lib/db/schema/index.ts`, `messages: text("messages").notNull().default("[]")` | E1, this session |
| No FTS or search index exists | `grep -rn "fts\|VIRTUAL TABLE" src/main` returns nothing, run it and paste the result | E3 |
| Memory entries have no confidence or decay fields | step 24's table, `useCount` and `lastUsedAt` only | by contract |
| Recall must stay off the stable prefix | step 23's cacheability rule, and §3 of the loop brief | by contract |
| Upstream runs full-text search then LLM summarisation on what it retrieves | `.dump/app/research/2026-09-13-self-improvement-loop.md` §4 | recorded |

## 4. Read first, and what already exists

`.dump/app/research/2026-09-13-self-improvement-loop.md` §4 for the shape, and step 24's `memory_entries` for the columns this step extends. `src/renderer/features/agents/search/chat-search-bar.tsx` already searches within one chat, so the affordance exists and this step widens its scope rather than inventing a screen.

## 6. Implementation plan

1. A mirror index, additive: `search_documents` with `subChatId`, `role`, `seq`, plain text, and an FTS5 virtual table over it, written in the same transaction that persists an assistant or user message. Keep the JSON column authoritative and the index rebuildable, with `db:sync-memory` style maintenance to rebuild it after a crash.
2. `search.sessions` as a tRPC procedure, phrase and bm25 ranked, scoped by project, with a row cap and a per-hit snippet rather than a full message body.
3. Bounded recall into a turn: retrieve top-k, then summarise only those hits under a token budget, and place the result in the volatile tail. Never insert retrieved history into the stable prefix, the step 23 test proves that rule was honoured.
4. Decay: add `confidence`, `reinforcedCount` and `lastReinforcedAt` to `memory_entries`, one migration, and a promotion rule that raises an entry recalled and confirmed, and a demotion rule that drops an entry never reinforced after a window out of the prompt without deleting it. A user-pinned entry never decays.
5. The UI: search results grouped by session with a date, a jump-to-message link, and a "remember this" action that writes an entry with provenance. Prototype it, research how two other local-first tools present cross-session search, and bring the layout options to the human.
6. Tests: index and blob never disagree on a fixture run, a rebuild after a simulated corruption, retrieval bounded to the budget, a pinned entry surviving decay, a demoted entry absent from the prompt but present in the list, and no personal data reaching the index from a provider payload that was refused.

## 8. Boundaries

- Always: the blob is the truth and the index is derived, everything the index stores is explainable from a row, and recall is bounded per turn.
- Ask first: any summarisation of retrieved history that could restate user content to a provider beyond the current turn, and any decay rule that could hide a fact the user relies on.
- Never: a second authoritative store, a search that loads every message, deleting an entry to implement decay, or indexing a secret, which step 11's redaction enforces first.

## 10. Acceptance criteria

- [ ] A phrase search across sessions returns the sub-chat and the message, under a second on a fixture with a thousand turns.
- [ ] A turn that triggers recall pays the token budget and not more, measured.
- [ ] An entry never reinforced in the configured window stops appearing and is still listed, with a test.
- [ ] Rebuilding the index from the blobs produces identical results, which is the recovery path proven.
- [ ] No token or key appears in the index, proven by a grep on the database file after a scripted run.

## 11. Verification

```sh
npm run db:generate && git diff drizzle/    # read the SQL
npm run test && npm run typecheck && bun x biome check .
```

## 12. Benchmark record

Index size per thousand messages, search latency at one and ten thousand, and prompt tokens with recall on and off, in `.dump/app/benchmarks/`.

## 13. Rollback

The index is derived, so dropping it loses nothing and the decay columns read as neutral defaults.

## 14. Out of scope

Vector or embedding search, which needs a dependency and an embedding provider and is not approved anywhere, the Honcho-style user model, held at item 17 in `.dump/global/questions.md`, and cross-device sync.

## 15. Handoff notes

Write the budget numbers and the decay window into `.dump/app/plans/2026-09-13-recall.md`, and note the index rebuild command there, because {{S43}}'s review pass reads this recall path when it decides whether a skill already exists.
