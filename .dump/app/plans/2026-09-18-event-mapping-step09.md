# Step 09 build plan: map the harness events that vanish today

Roadmap step 09, issue #11. Base branch `arena/01a097c4-mauscode` (at `fd62662`),
work branch `arena/01a0b390-mauscode`. Depends on step 07 (issue #9, closed, in
the base). The step file is `.dump/app/roadmap/09-event-mapping.md`; this plan
adds what the session measured beyond it.

## Ground truth measured this session

1. `src/main/lib/runtime/translate.ts` `NativeTranslator.translate` has exactly
   22 internal arms returning no chunks: `message_accepted`, `session_status`,
   `connection_phase`, `session_renamed`, `credential_updated`, `model_info`,
   `models`, `runtime_info`, `history`, `attached`, `session_forked`,
   `sessions`, `file_content`, `files`, `text_matches`, `file_status`,
   `side_pane_images`, `wake_requested`, `background_progress`, `hello_ok`,
   `ok`, `pong`. `compacted` is NOT internal: it already maps to the Compact
   indicator chunks (E1, read this session).
2. Unknown `ev` kinds fall through `default` silently. The AGENTS.md failure
   class "a harness event that translate.ts does not map disappears without an
   error" applies to them.
3. The step 07 run store exists as designed: `runs` + `run_events` tables in
   `src/main/lib/db/schema/index.ts:167-224`, machine in
   `src/main/lib/runs/run-state.ts`, vocabulary in `src/shared/run-state.ts`.
   Event kinds today: `created`, `started`, `approval_requested`,
   `approval_resolved`, `settled`. `observeRunChunk` is the shared
   chunk-to-transition observer used by BOTH routers (`claude.ts:971`,
   `runtime.ts:230`).
4. The Claude boundary is weaker than `types.ts` claims. Pinned
   `@anthropic-ai/claude-agent-sdk` 0.2.45 `sdk.d.ts:1494` builds `SDKMessage`
   from 18 members but never declares `SDKRateLimitEvent`, and the package
   imports `BetaMessage`/`BetaRawMessageStreamEvent`/`MessageParam` from
   `@anthropic-ai/sdk`, which is not in the dependency tree (its own
   `package.json` declares `"dependencies": {}`). Probes this session: every
   one of the 17 declared member types is individually sound, but the
   top-level union collapses to an `any`-like type under `skipLibCheck`, and
   `SDKAssistantMessage["message"]`, `SDKPartialAssistantMessage["event"]` and
   `SDKUserMessage["message"]` resolve to `any`. `ClaudeStreamMessage` in
   `src/main/lib/claude/types.ts:103` is therefore `any` in practice and its
   doc-comment promise ("a CLI/SDK message-shape change [is] a compile error
   at the read site") is false today.
5. Handled `msg.type` values in `claude/transform.ts`: `stream_event`,
   `assistant`, `user`, `system`, `result`. Known and silently dropped:
   `tool_progress`, `auth_status`, `tool_use_summary`, and six `system`
   subtypes (`hook_started`, `hook_progress`, `hook_response`,
   `task_notification`, `task_started`, `files_persisted`).
6. Consumers named by the step corpus: step 24 (memory) checkpoints on
   `compacted` ("step 09, `compacted` | by contract", `24-agent-memory.md:29`).
   The run-state design record assigns `wake_requested`/`background_progress`
   mapping to the backgrounding work and reserves a `backgrounded` status for
   it (`2026-09-13-run-state.md`, States section). Steps 16 and 26 name no
   specific event. `session_status` has no named consumer today.
7. `wake_requested` semantics from upstream jcode issue #1067 (implemented
   v0.81.0): in `wake_mode=external` the daemon emits
   `{ev:"wake_requested", session_id, reason: "background_task"|"swarm_await"|"comm_message", notification}`
   instead of starting a turn itself.

## Approach

The mapper (native translator) gains a second destination: harness events that
are run-record facts return run events alongside chunks. The run store gains a
capped, typed append for them. The Claude boundary gets real local unions so
the exhaustiveness check is not vacuous. One shared chunk observer records
`compacted` for both engines.

## Tasks in order

1. Shared vocabulary (`src/shared/run-state.ts`): add
   `HARNESS_RUN_EVENT_KINDS = ["compacted", "session_status",
   "background_progress", "wake_requested"]`, the `HarnessRunEvent` shape, and
   `RUN_EVENT_TEXT_CAP = 500`. Done when: exported, no import cycle.
2. Native mapper (`src/main/lib/runtime/translate.ts`): `translate` returns
   `{ chunks, runEvents }`; map `session_status`, `background_progress`,
   `wake_requested` to run events; `compacted` keeps its chunks (run-event
   recording happens in the chunk observer, task 3); unknown kinds warn once
   per kind and return an empty translation. Update the module doc block.
   Done when: `translate.test.ts` covers every mapped event, capping, and
   warn-once; internal arms unchanged.
3. Run store (`src/main/lib/runs/run-state.ts`): `RunHandle.noteHarnessEvent`
   appends a capped run event + emits to feed listeners; chunk observation
   moves onto the handle (`observeChunk`) with the `compacted` derivation from
   Compact tool chunks, keyed by toolCallId, working for both engines. Update
   both router call sites. Done when: `run-state.test.ts` proves the persisted
   `compacted` row a pre-compression hook can query, on both engines, and a
   `noteHarnessEvent` row with capped payload.
4. Turn stream (`src/main/lib/runtime/consume-turn-stream.ts`): forward
   translator run events through a new `onRunEvent` callback; the runtime
   router wires it to `noteHarnessEvent`. Done when: its tests assert the
   forward and the stop-races.
5. Claude boundary (`src/main/lib/claude/types.ts`,
   `src/main/lib/claude/transform.ts`): rebuild `ClaudeStreamMessage` from the
   17 sound SDK members plus local shapes for the four members whose published
   types resolve to `any` (assistant, user, stream_event) or lag the CLI
   (system-init `mcp_servers.serverInfo`); add local content-block and stream
   API event unions; type-level exhaustiveness at `msg.type` and `system`
   subtype level; runtime warn-once for unknown `msg.type`; fix what real
   typing surfaces. Done when: `npm run typecheck` clean, no `any` introduced,
   a new `transform.test.ts` proves warn-once, existing behaviour unchanged.
6. `.dump` records: event table at
   `.dump/app/research/2026-09-13-event-mapping.md` (the file steps 16, 24, 26
   cite), this plan updated, second-brain touched if the run-event vocabulary
   changed. Done when: every internal arm has a row with a reason.
7. Gates: full verification gate + code research gate; then PR (base
   `arena/01a097c4-mauscode`), linked to issue #11 both ways.

## Commands

```sh
npm install --ignore-scripts --legacy-peer-deps   # bun absent in sandbox
npm run build:runtime-client                      # workspace dist for typecheck
bun x biome check . || npx biome check .          # 0 findings
npm run typecheck                                 # tsc, 0 errors
npm run test                                      # vitest
npm run test:node                                 # node --test runtime suites
npm run test:contracts
node scripts/ci/lint-changed.mjs
node scripts/ci/typecheck-ratchet.mjs
npm --prefix packages/runtime-client run typecheck
```

## Open questions for the human (asked and answered 2026-09-18)

1. Do the four harness events record-only, with no `runs.status` change?
   **Answered: yes, record-only.** The six-status vocabulary stays closed.
2. Record `compacted` for the legacy Claude engine too, via the one shared
   chunk observer? **Answered: yes, both engines.** A failed Compact
   round-trip records nothing.
3. Rebuild `ClaudeStreamMessage` as local unions because the pinned SDK union
   collapses to `any`? **Answered: yes, local unions.** No dependency change.

## Code research gate (ran on the final diff, 2026-09-18)

Queries and sources beyond the deep research pass above:

- `@anthropic-ai/claude-agent-sdk` 0.2.45 `sdk.d.ts` read directly: member
  list at line 1494, member declarations verified individually by probe
  (each rejects a number literal), `SDKRateLimitEvent` confirmed undeclared,
  `@anthropic-ai/sdk` confirmed absent from the tree. Sources: the installed
  package, code.claude.com agent-sdk streaming docs (older, smaller union),
  and the typecheck probes themselves (E3).
- jcode issue #1067 read in full for `wake_requested` semantics (v0.81.0
  implementation note).
- The claude-agent-sdk docs page on `stream_event` / `SDKCompactBoundaryMessage`
  and two compaction explainers (unmarkdown, CometAPI) for the Compact
  indicator context.

Edge cases enumerated and covered: unknown `ev` kinds (warn once, never
fatal), unknown `msg.type` (warn once), a Compact output arriving with no
start (recorded), a different tool's output between Compact start and output
(ignored, keyed by id), a Compact round-trip that errors (no `compacted`
recorded), a settled run receiving harness events (ignored, seq unchanged),
long payload strings (capped at `RUN_EVENT_TEXT_CAP` plus ellipsis, repo cap
convention), uncommitted stream types at the qwen boundary (`toClaudeStreamMessage`
returns null and the line is dropped instead of yielding junk start chunks).

Attempted disprovals: the exhaustive ApiEvent switch made the old `default`
arm dead (`never`), which is why the entry now filters with `isKnownEvent`
first and keeps the default for client/mapper drift; the SDK union
exhaustiveness check was verified vacuous before the local-union fix (a probe
assigned `123` to `SDKMessage` successfully) and is real after it.

## Gate results (final diff, all run 2026-09-18)

| gate | result |
| --- | --- |
| `npm install --ignore-scripts --legacy-peer-deps` (bun absent in sandbox; frozen gate fallback) | passed |
| `npm run build:runtime-client` | passed |
| `npx biome check .` | 0 findings |
| `npx biome ci` on the 14 changed lintable files (what lint-changed.mjs computes) | passed |
| `node scripts/ci/lint-changed.mjs` as written | not run: it shells out to `bun`, which the sandbox lacks; the identical file set passed under `npx biome ci` |
| `npm run typecheck` | 0 errors |
| `npm run ts:check` (tsgo, second CI gate) | 0 errors |
| `npm run test` | 897 passed |
| `npm run test:node` | 34/34 passed |
| `npm run test:contracts` | 382 passed |
| `node scripts/ci/typecheck-ratchet.mjs` | passed (0 <= 0) |
| `npm --prefix packages/runtime-client run typecheck` | passed |
| `bun run build` / `package:mac` | not run: no packaging in this step, no renderer or asset change |

## CodeAnt SAST findings, validated 2026-09-18

CodeAnt's deep SAST pass flagged 2 issues in `src/main/lib/qwen-print/session.ts`
("Rating C", failing its Quality Gates and SAST checks on commits `b28dda4` and
`1fd9cd9`). Both validated as false positives; no code change made.

1. "[MEDIUM] session.ts:285 - CSP header includes user-controlled value via
   string interpolation". The file has no HTTP layer: grep for
   `Content-Security|CSP|http|header|res.set` returns nothing. Line 285 emits a
   `text-delta` chat chunk whose delta interpolates qwen-reported tool names.
   The renderer escapes text (React) and routes link clicks through
   `shell:open-external`, which runs `assertRemoteAllowed` before
   `shell.openExternal` (`src/main/windows/main.ts:333-342`). There is no CSP
   header and no web page generation in this module.
2. "[CRITICAL] session.ts:337-340 - password check short-circuit allows
   authentication bypass". The file contains no password or authentication
   code; grep for password/credential/secret/auth tokens hits only
   `inputTokens`/`outputTokens` usage fields. The flagged lines are a type
   guard reading `session_id` off a harness JSON frame. The described
   vulnerability does not exist.

Rebuttal recorded on PR #63. If CodeAnt's gate stays red on these, the
accepted-finding or path-suppression decision belongs to the human, since the
repo ships no CodeAnt suppression config.
