# Spike: hermes-agent's memory system — the logic worth porting, and where it lands in mausCode

**Date:** 2026-09-13 · **Status:** research, no code changed · **Feeds:** plan wave W10 (memory + `AGENTS.md`), and the "deep port, automatic, performance-positive" instruction that governs it

Source read: `/tmp/hermes-agent`, HEAD `de2d6a1` ("fix(config): a fresh process recovers the last good config.yaml instead of running on defaults"). Read paths are inside that clone. This repo is not a JS project — it is a Python agent — so nothing here is a file-level port. What transfers is the **control flow**: who is called, when, with what budget, and what is refused.

## The one-sentence summary

Memory in hermes is not a store, it is a **lifecycle**: a provider object gets called at seven well-defined moments per turn/session, is given a hard timeout, is kept out of the cacheable part of the prompt, is forbidden from destructive writes when it runs unattended, and is surfaced to the user as a counted indicator. mausCode currently has none of those seven moments.

## 1. The interface (`agent/memory_provider.py`, 175 lines, read in full)

An abstract base class, documented as "plugins ship in `plugins/memory/<name>/`, activated via `memory.provider` (**ONE** external provider at a time)" — and the reason given for the limit is a cost argument, not a purity one: "tool-schema bloat, conflicting backends".

Core lifecycle, in the order it fires:

| Member | Contract, as written in the file |
| --- | --- |
| `name` | short identifier (`builtin`, `honcho`, `hindsight`) |
| `is_available()` | "Configured, credentialed and ready? Gates activation; **check config/deps only, no network**" |
| `initialize(session_id, **kwargs)` | once at agent startup; kwargs always include `hermes_home` ("profile-scoped storage; never hardcode `~/.hermes`") and `platform`; may include `agent_context` = `"primary" \| "subagent" \| "cron" \| "flush"` — **"skip writes for non-primary contexts"** |
| `unavailable_reason()` | user-facing hint for the warning shown when activation fails, because `initialize()` never runs then |
| `system_prompt_block()` | **STATIC** text only, `""` to skip; "Recalled context goes through `prefetch()`, not here" |
| `prefetch(query, session_id)` | recall for the *upcoming* turn; "Must be fast — recall in the background and return cached results" |
| `queue_prefetch(query, session_id)` | "Queue a background recall after each turn; `prefetch()` consumes it next turn" |
| `recall_status()` | `RecallStatus(provider_label, count, glyph="🧠")` — "What the **most recent** prefetch injected… never a stale prior count"; `count == 0` means content with no discrete count and renders generically |
| `sync_turn(user, assistant, session_id, messages, turn_author)` | "Persist a completed turn (**non-blocking**)"; `turn_author` = `{"id","name","is_bot"}`, sent "only to signatures that accept it", because "a shared session carries several participants, so a provider keying durable state on identity must read it per turn" |
| `get_tool_schemas()` / `handle_tool_call()` | tools; handler "must return a JSON string" |
| `shutdown()` | flush queues, close connections |

Optional hooks that carry most of the design value:

* `on_turn_start(turn_number, message, **kwargs)` — kwargs "may include `remaining_tokens`, `model`, `platform`, `tool_count`, `author_id`, `author_name`, `author_is_bot`".
* `identity_signature()` — "Identity-mapping values that must **bust a cached gateway agent** when they change… The gateway calls this on an uninitialized instance on every inbound message, so keep it cheap and read-only."
* `on_session_end(messages)` — "End-of-session extraction; fires **only at real session boundaries, never per-turn**."
* `on_session_switch(new_session_id, *, parent_session_id, reset, rewound)` — fires when the id is reassigned mid-process without teardown (`/resume`, `/branch`, `/reset`, `/new`, compression); `reset` is True only for a genuinely new conversation ("flush buffers"); `rewound` = "same id but the transcript was truncated" (`:657` names `/undo` as the example).
* `on_pre_compress(messages)` — "Extract insights from `messages` about to be compressed, fed into the summary prompt." Versioned: `PRE_COMPRESS_CHECKPOINT_API_VERSION = 2`, where **v1 = best-effort with the raw message list; v2 = opt-in fail-closed checkpoint (normalized evidence handoff + strict-mode failure propagation)**. Providers that durably checkpoint set 2.
* `on_delegation(task, result, child_session_id)` — "**PARENT-side** observation of a completed delegation (the subagent has no provider session)."
* `on_memory_write(action, target, content, metadata)` — mirror a built-in write so external stores stay consistent; `metadata` carries "provenance such as `write_origin`, `session_id`, `tool_name`".
* `get_config_schema()` / `save_config()` — setup fields for `hermes memory setup`: `key, description, secret` ("goes to .env"), `required, default, choices, type, minimum/maximum/step, url, env_var`. "Plugins MUST either override this or use only env vars".
* `backup_paths()` — state outside the home dir that `hermes backup` must include, and it "MUST work without `initialize()` or network."

The trivial-input gate is a module-level constant here rather than buried in a caller: `TRIVIAL_PROMPT_RE` (`:40-48`) matches bare acknowledgements (`yes|no|ok|sure|thanks|continue|go ahead|proceed|got it|cool|lgtm|k`…) followed only by whitespace/punctuation — "so `k8s`/`yolo`/`note` do NOT match while `hi!`/`thanks :)`/`done???` do" — and `is_trivial_prompt()` (`:49-54`) also returns True for empty input and **anything starting with `/`**. The stated payoff: "skipping recall saves a round-trip and keeps stale context from derailing one-word replies."

## 2. The manager (`agent/memory_manager.py`, 842 lines; head read + targeted greps)

* **Fan-out with one external provider** (`:1-5` docstring): builtin always allowed, at most one external.
* **Duck-typed capability detection instead of version checks.** `_signature_params` (`:37-42`) tolerates uninspectable callables; `_accepts_require_checkpoint` (`:49-60`) exists so "bare-shape v2 providers… would raise TypeError on the keyword, which the host would **re-raise as a checkpoint failure despite a successful write**". The manager therefore asks the function, not the class.
* **Threads inherit the caller's context.** `_ctx_bound` (`:62-66`) wraps a callable in `contextvars.copy_context().run` because "profile isolation is a ContextVar-scoped `HERMES_HOME` override, and an unbound worker would silently use the default profile" — i.e. a background memory worker in a multi-profile process would otherwise write to the wrong home.
* **Hard timeouts:** `_SYNC_DRAIN_TIMEOUT_S = 5.0` at shutdown, `_EXTERNAL_PREFETCH_TIMEOUT_S = 8.0` for recall (`:31-32`), and workers are daemon threads "so a wedged provider never blocks interpreter exit".
* **Fail-closed on partial data:** `:236` "leaking partial memory context is worse than a truncated answer" —
  and the two functions that make that safe to expose are manager-side, not provider-side: `sanitize_context` (`:177`)
  and `build_memory_context_block` (`:272`). Redaction and the injection wrapper belong in our manager too, so no
  provider can forget them.
* **Non-fatal on queue failure:** `queue_prefetch` errors are logged and swallowed (`:476`); prefetch runs in a worker whose result lands in a `result_box` (`:414-420`).
* **Shutdown accounting:** `:832` logs "N memory write(s) and M queued prefetch(es); K active task(s) remain detached" — the leak is named, not hidden.
* **Tool-schema normalisation** `normalize_tool_schema` (`:70-84`): providers may return either the bare or the wrapped OpenAI form; double-wrapping "yields a nameless `function` and strict providers (DeepSeek) reject the **ENTIRE** request". One small function preventing a whole-class outage.
* **Gating matches the tool surface** `memory_provider_tools_exposed` (`:109-116`): the same predicate decides whether tools are injected and whether the provider's `system_prompt_block()` may advertise them — "so a provider's `system_prompt_block()` never advertises tools absent from the tool surface."

## 3. Prompt placement and budget (`agent/turn_context.py`, `agent/context_breakdown.py`)

* `turn_context.py:985` resolves recall once per turn: `ext_prefetch_cache = _memory_turn_start_and_prefetch(agent, original_user_message, turn_author)`. So the turn pays at most one recall, taken from the cache the previous turn queued.
* `context_breakdown.py:25` gives memory **its own budget category and its own UI colour**: `"memory": ("Memory", "var(--context-usage-memory)", "▧")`.
* `_memory_blocks` (`:64-74`) pulls both the provider block and the user-profile block from `store.format_for_system_prompt("memory")`, gated on `agent._memory_enabled`.
* `:125-137` is the important one: the prompt is split into **`stable`** (system + skill index) and **`volatile`** (memory + user blocks), and the memory cost is counted separately (`_chars_to_tokens(_join(memory_block, user_block))`). Keeping memory out of the stable prefix is what preserves upstream prompt caching while still injecting per-project facts — the "performance-positive" requirement, satisfied by placement rather than by cleverness.

## 4. Writes and the unattended gate (`tools/memory_tool.py`)

Two targets — `memory` and `user profile` (`:102` labels them for display) — and three actions: `add`, `replace`, `remove` (the latter two take `old_text` to locate the entry, `:172`). `_background_delete_gate(action, operations, …)` (`:132-134`) is the security-relevant piece: *"Fail-closed operation gate for unattended background-review forks (#105921): `add` stays available (it is all any review prompt asks for), while `replace`/`remove`…"* are refused. Unattended code may accumulate knowledge; it may not rewrite or delete what the user recorded.

## 5. Durable store shape (`hermes_state_*.py`, 21 modules)

`common, compression, dbfile, errors, fts, gateway, guard, holders, maintenance, messages, portability, readpool, registry, repair, schema, search, sessions, telegram, titles, usage, wal` — one concern per module. Three of them exist purely because a user's SQLite file is a liability if you mishandle it: `maintenance`, `repair`, `portability`; and `readpool` exists so readers never block the writer. Compare ours: a single `src/main/lib/db` over Drizzle/better-sqlite3 with no repair path at all. This is the model for *how to split our own store*, not for the file format.

## 6. Learning, and why `/learn` is not a memory feature

`agent/learn_prompt.py` (197 lines, head read): `/learn` builds "**the ONE prompt** that turns whatever the user described (code dir, doc URL, 'what we just did', pasted notes) into a reusable **skill**"; "No distillation engine, no model-tool footprint, so it works identically on local, Docker, and remote backends; every surface calls `build_learn_prompt` as a normal turn." The file is mostly house rules the host refuses to enforce after the fact: a description "**<=60 characters**, ends with a period… If the description contains a colon, wrap the whole value in double quotes. This is the most-violated rule and it is NOT cosmetic: the system-prompt skill index truncates the description to 60 chars… anything past char 60 is silently cut and never routes. After you write the description, COUNT the characters"; `author` must always be the literal `Hermes`, "NEVER fill it from the host environment… an environment-derived name is a privacy leak the user never opted into"; `platforms` declared only for OS-bound primitives; a fixed body section order; and "**NEVER invent flags, paths, or APIs** — if you didn't see it in the source, don't write it."

`agent/learning_graph.py` (206 lines, head read) assembles the "**learning made visible**" graph for the desktop: nodes are non-base learned/profile skills (agent-created or used) **plus `MEMORY.md` / `USER.md` chunks as first-class nodes**; skill edges come from declared `related_skills`; "**memory→skill links are derived from lexical overlap**"; usage comes from `skills/.usage.json` with a timestamp preference order (`last_activity_at, last_used_at, last_viewed_at, last_patched_at, created_at`), and `.archive/.hub/node_modules/.git` are skipped.

The transferable idea for us is small and strong: **make what the agent knows inspectable** — one view listing learned entries with source, timestamp, and use count, and links from an entry to the code area it applies to — and **enforce the size rules at write time** because the prompt index truncates silently.

## 7. Mapping onto mausCode (W10 rewrite, concrete)

| hermes | mausCode landing | notes |
| --- | --- | --- |
| `MemoryProvider` ABC + `MemoryManager` fan-out | `src/main/lib/knowledge/{provider.ts,manager.ts,providers/builtin.ts}` | TypeScript interfaces, no plugin dir yet; keep "one external provider" as an enforced invariant in the manager so a future plugin cannot silently double-inject |
| `initialize(…, hermes_home, agent_context)` | resolve `~/.mauscode/` once in main, pass `agentContext: "primary" \| "child" \| "schedule" \| "flush"` | our recipe already forbids hardcoding home paths |
| `system_prompt_block()` static-only + `prefetch()` per turn | split our context assembly into `stable` / `volatile`; memory goes in `volatile` | this is what keeps prompt caching intact; today everything is concatenated once in `claude.ts` |
| `queue_prefetch` → consumed next turn | after each `finish`, run recall for the *next* turn in a detached task with an 8s cap | zero added latency on the critical path — the user-visible promise of "performance-positive" |
| `is_trivial_prompt` | shared predicate in `src/shared/knowledge/gate.ts` | also skip `/`-commands; our slash-command path (`active-chat.tsx:4003`) currently always re-derives context |
| `recall_status` + glyph | a chip in the composer with `count` of entries injected this turn, from the last prefetch only | matches our existing `WidgetId` surface; no new panel |
| `on_pre_compress` v2 fail-closed checkpoint | hook the harness `compacted` event (`translate.ts:147-167` discards it today) | one of the strongest reasons to keep W1's event passthrough in scope: without `compacted` there is no pre-compression checkpoint |
| `on_session_switch(reset, rewound)` | our fork/`rewind`/resume paths — `chats.forkSubChat` (`chats.ts:913`) is a real `rewound:false, reset:true` case | today nothing tells the knowledge layer a session changed identity |
| `on_delegation` (parent-side) | threadmaxx child completion → parent records the outcome | exactly our `sub_chat_links` addition in W3 |
| `on_memory_write` provenance | `write_origin, session_id, tool_name` columns on `memory_entries` (W10's table) | makes "who taught the agent this" answerable |
| `_background_delete_gate` | **adopt as-is**: scheduled/autopilot runs may `add`, never `replace`/`remove` | pairs with our existing "unattended runs require an `EvidenceBundle`" invariant |
| `TRIVIAL_PROMPT_RE`, timeouts, `normalize_tool_schema`-style guards | small, testable pure functions | each one is a bug class prevented, not a feature |
| `hermes_state_*` split | `src/main/lib/db/`: `schema.ts, maintenance.ts, repair.ts, readpool.ts` | deferred to W10's second half; do **not** copy their file layout wholesale |
| skills `.usage.json` + graph | **not now** | we have no skill layer; the inspectable-list UI ships without the graph edges |

**Boundary with the vendored JCode engine.** `runtime/jcode/` (v0.84.0, `ce4e789`) already ships a memory store + graph (`crates/…/memory.rs`, `MEMORY_ARCHITECTURE.md`) reachable through the CLI, and our `harness/mcp` + `maus.*` surface can read it. Two honest options, and W10 must pick one before it starts:

* **A — app owns the store** (table + provider as above), engine gets memory *disabled* in the capability manifest. One source of truth for the UI, no double injection, costs us portability if we later want the same memory inside raw `jcode` sessions.
* **B — engine owns the store**, app becomes a thin reader of `jcode memory`, and only adds the provider lifecycle (gates, timeouts, placement, indicator). Less code for us, but every injection decision then depends on CLI output formats, and "one provider max" cannot be enforced.

Recommendation: **A**, because the seven lifecycle hooks and the injection placement are where the value is, and they have to live where the prompt is assembled — which is our main process, per the porting recipe's §0 ("never touch the renderer for backend work", and the harness is the only thing that sees the prompt). Revisit only if the engine grows an equivalent lifecycle, which `MEMORY_ARCHITECTURE.md` does not currently describe.

## 8. Deliberately not ported

The plugin discovery dir, the gateway/telegram/profile plumbing (`hermes_state_gateway/telegram/registry`), `agent_context="cron"` scheduling semantics (ours is W9), the MCP-side spill helpers (`tools/hook_output_spill` — different problem: our chunks are already typed), and skill authorship rules beyond the size-cap discipline noted above. None of those is memory logic; they are hermes' distribution machinery.

## 9. Two risks this spike exposes

1. **Injection into a cached prefix breaks caching silently.** If W10 lands memory in the same string we already send as system context, prompt-cache hit rate drops on every project with history, and no test will catch it. Guard: an assertion in `session.ts`-level tests that the stable prefix for a fixed turn does not change between turns when memory changes (hermes gets this from the `stable`/`volatile` split; we need the test because we're inventing the split).
2. **Unbounded growth with no repair path.** hermes carries `maintenance`/`repair`/`portability` modules precisely because a corrupted store is a support load. A `memory_entries` table with no size bound and no `PRAGMA integrity_check`-style recovery is a bad trade; W10 must ship the cap (per-project entry limit + oldest-learned eviction, surfaced in the same UI) or not ship.
