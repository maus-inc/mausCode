# Runtime and Claude event mapping table

Roadmap step 09 (issue #11). This is the file steps 16, 24 and 26 cite. It
records, for every event both provider boundaries receive, where it goes today
and who asked for it. Measured and written 2026-09-18 against base
`arena/01a097c4-mauscode` at `fd62662`; line numbers move, the event names and
destinations are the contract.

## Part 1: native runtime mapper (`src/main/lib/runtime/translate.ts`)

`NativeTranslator.translate` takes `AnyApiEvent` and returns
`{ chunks, runEvents }`. Known kinds it does not map stay chunk-silent; kinds
the client does not know warn once per kind per translator instance
(`[runtime] unmapped harness event kind: <ev>`) and never break the stream.
The run-event kinds and the text cap (`RUN_EVENT_TEXT_CAP = 500`) live in
`src/shared/run-state.ts`; the store append is
`RunHandle.noteHarnessEvent` in `src/main/lib/runs/run-state.ts`, which caps
every string payload field and emits to run-feed listeners.

### Mapped to run events (run-record facts)

| event | payload | consumer that asked | notes |
| --- | --- | --- | --- |
| `compacted` | `{message}` | step 24 (memory) checkpoints pre-compression on it: "step 09, `compacted`, by contract" (`24-agent-memory.md:29`) | keeps its existing Compact indicator chunks; the run event is derived once in the chunk observer from the Compact tool round-trip, so the legacy engine records it too. A failed Compact round-trip records nothing |
| `session_status` | `{session_id, status}` | none named yet; step 09's plan names it; step 26 (loopback session API) reads run state generally | status is a free-form daemon string, so no `runs.status` transition keys on it |
| `background_progress` | `{session_id, task_id, label, percent?, summary, done?}` | backgrounding work; step 16 (CI autopilot) and step 19 (fan-out) are the direction, per the step 07 design record which reserves a `backgrounded` status for it | record-only; no status change |
| `wake_requested` | `{session_id, reason, notification}` | same backgrounding work as above. Upstream semantics: jcode v0.81.0 `wake_mode=external` emits `{reason: "background_task"\|"swarm_await"\|"comm_message"}` instead of self-starting a turn (jcode issue #1067) | record-only; the decision to start a follow-up turn belongs to orchestration, not the mapper |

### Deliberately internal (no chunks, no run event), with reasons

| event | reason it stays internal |
| --- | --- |
| `message_accepted` | transport ack for `send_message`; the turn lifecycle already has `started`/`settled` run events |
| `connection_phase` | daemon attach lifecycle; surfaced through the manager's connection state, not the turn stream |
| `session_renamed` | title changes flow through the sessions snapshot path |
| `credential_updated` | credential state is owned by the credential store and settings UI, not the run record |
| `model_info` / `models` / `runtime_info` | model catalogue reads go through dedicated client requests, not the turn |
| `history` / `sessions` / `attached` / `session_forked` | session-management replies consumed by `runtime/sessions.ts` request paths |
| `file_content` / `files` / `text_matches` / `file_status` | file-tool replies served through dedicated requests; large payloads must not enter `run_events` (payloads carry state facts, not transcripts) |
| `side_pane_images` | renderer image pane data, out of run-record scope |
| `hello_ok` / `ok` / `pong` | transport-level acks |

Count: 19 internal, 4 on run events, 12 on chat chunks (`text_delta`,
`reasoning_delta`, `reasoning_done`, `tool_start`, `tool_input_delta`,
`tool_exec`, `tool_done`, `token_usage`, `permission_request`, `compacted`,
`turn_done`, `error`). The pre-step count of "22 internal" included the three
now on run events.

## Part 2: Claude boundary (`src/main/lib/claude/transform.ts`)

`ClaudeStreamMessage` is declared locally in `src/main/lib/claude/types.ts`
because the pinned SDK cannot type this boundary: `@anthropic-ai/claude-agent-sdk`
0.2.45 `sdk.d.ts` builds `SDKMessage` from 18 members but never declares
`SDKRateLimitEvent`, and it imports `BetaMessage` / `BetaRawMessageStreamEvent`
/ `MessageParam` from `@anthropic-ai/sdk`, which is not installed. Verified by
probe this session: all 17 declared member types are individually sound; the
top-level alias collapses to an `any`-like type under `skipLibCheck`. The
classification lists (`HANDLED_*` / `INTERNAL_*`) with `AssertNever` compile
guards in `transform.ts` fail typecheck when the SDK grows an unclassified
member. Unknown runtime `msg.type` values warn once per type per transformer
(`[transform] unmapped SDK message type: <type>`).

| `msg.type` (member) | destination | notes |
| --- | --- | --- |
| `stream_event` (SDKPartialAssistantMessage) | chat chunks | text/tool/thinking trios |
| `assistant` (SDKAssistantMessage) | chat chunks | complete text/tool_use blocks |
| `user` (SDKUserMessage, SDKUserMessageReplay) | chat chunks | tool_result outputs |
| `system`/`init` | `session-init` chunk | typed locally as `ClaudeSystemInitMessage`: the CLI sends `serverInfo`/`error` per MCP server, which the SDK's published shape omits |
| `system`/`status` (`compacting`) | Compact indicator chunk | start of the round-trip the observer records as `compacted` |
| `system`/`compact_boundary` | Compact completion chunk | the observer-matched `compacted` trigger |
| `result` (SDKResultMessage) | metadata + finish chunks | |
| `tool_progress` (SDKToolProgressMessage) | internal | per-tool streaming progress; the transcript already shows the round-trip, no second live feed has a consumer |
| `auth_status` (SDKAuthStatusMessage) | internal | mid-turn auth changes, no consumer owns them |
| `tool_use_summary` (SDKToolUseSummaryMessage) | internal | batch summaries of past tool use |
| `system`/`hook_started`, `hook_progress`, `hook_response` | internal | hook bookkeeping, no chat content, no named consumer |
| `system`/`task_notification`, `task_started` | internal | background task bookkeeping; a future backgrounding step may promote these alongside `background_progress` |
| `system`/`files_persisted` | internal | transcript persistence notice, no consumer |
| (undeclared) `SDKRateLimitEvent` | absent from the local union | the SDK references it without declaring it; including it would re-collapse the union to `any`. Revisit at the step 12 pin bump |

`src/main/lib/qwen-print/session.ts` reuses this transformer for qwen print
stdout lines and parses through `toClaudeStreamMessage` (discriminant check,
then the transformer's warn-once covers unknown types).

## How the pre-compression hook reads `compacted` (for step 24)

```
runs.get({ runId, afterSeq }) -> events where kind == "compacted"
runs.subscribe(...)           -> feed items with event.kind == "compacted"
```

A hook gates on the existence of a `compacted` row for the current run; the
payload carries the native harness `message` when the engine provides one and
the legacy `{status: "compacted"}` record otherwise. Run event payloads are
capped at `RUN_EVENT_TEXT_CAP` per string field.

## Research pass log (2026-09-18)

Mandatory deep research pass for step 09, 5 queries run, 6 sources read:

1. "Anthropic Claude Agent SDK SDKMessage type union stream_event result system"
   - code.claude.com agent-sdk streaming-output docs (read): documents
   `SDKPartialAssistantMessage`, `SDKCompactBoundaryMessage`, the compact
   boundary as a `system` subtype, and that stream events carry raw API
   events. The docs describe fewer union members than the pinned SDK ships,
   which is why the installed `.d.ts` is the binding source.
   - A TypeScript SDK reference article (read): full older `SDKMessage`
   union.
2. "Claude Code compacting conversation context window auto-compact UI
   indicator" - two explainers read (unmarkdown, CometAPI): Claude Code shows
   a visible compacting indicator and fires Pre/PostCompact hooks; the
   indicator-then-boundary shape our Compact chunks already implement matches
   the category norm.
3. "jcode harness API wake_requested background_progress session_status" -
   jcode issue #1067 read in full (primary source): `wake_requested` payload,
   its `reason` values, and the external-wake mode shipped in v0.81.0.
4. "coding agent CLI background task progress notification pattern task_id" -
   two results read (opencode background agents, deepagents tail-logs
   issue): background progress is surfaced as task-id-scoped status lines,
   consistent with a run-record row rather than a chat chunk.

Skills pass: `npx skills find` returned nothing for "event sourcing state
machine" and "electron main process testing" (the endpoint returns empty for
every query per `docs/design-skills.md` era note; confirmed live). The
vendored inventory is design/UI-focused, so no skill matches this main-process
step; `unslop` governed the prose. Nothing installed.

