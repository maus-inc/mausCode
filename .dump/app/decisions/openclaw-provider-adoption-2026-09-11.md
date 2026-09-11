# OpenClaw provider adoption — decision brief

Date: 2026-09-11. Source: official OpenClaw docs (agent CLI,
onboarding, models, MCP references) + live probes against openclaw
CLI 2026.9.2 installed in-sandbox (no upstream port;
mausCode-authored). Provenance: docs fetched 2026-09-11; `agent
exec` argv, JSON envelopes (error/timeout/unknown-model), exit codes,
env-auth detection, model catalog behavior, `models status`, and `mcp
list` shapes all verified live. A live SUCCESS envelope was NOT
captured (sandbox TLS interception breaks provider HTTPS) — the ok
shape is docs-sourced and marked as such in code.

## What was built

A 9th provider ("OpenClaw") driving `openclaw agent exec --json`
(one embedded turn, no Gateway) over native print turns
(`src/main/lib/openclaw-print/`), mirroring the cline backend's
proven shape (args/session/auth-config/mcp-config + router +
transport + modal + selector/form/input/MCP-tab wiring):

- argv: `openclaw agent exec --json --timeout 600 --cwd <dir>
  [--model <provider/model>] --message-file -` + prompt on stdin.
  The prompt rides stdin (live-verified) so dash-leading prompts can
  never parse as flags. `--auth-env-only`/`--isolated` are NOT used:
  they load no config at all, which would drop the user's MCP
  servers from the turn.
- Envelope: stdout carries ONE JSON object at settle time — NO
  STREAMING surface exists. ok: `{ok:true,status:"ok",
  final,payloads,usage:{input,output,total},costUsd,assistantTurns,
  toolSummary,model,provider,sessionId}` (exit 0, docs-sourced).
  Failures (all live-captured): `{ok:false,status:"error"|
  "timeout",error:{message,kind},model:null,provider:null,
  sessionId}` — exit 1 for errors, exit 2 for timeouts. stderr
  carries `[diagnostic]`/`[model-fallback/decision]` progress lines;
  only the tail is kept, for error context.
- `final` projects as one text-start/delta/end triple at settle.
  `toolSummary` has counts + names only (no per-call I/O), so NO
  tool cards are synthesized — fabricated parts would mislead.
  `sessionId` is debugging-only (exec takes no resume flag).
- Empty/unparseable stdout is an ERROR (nothing streamed to keep —
  unlike the streaming siblings, there is no partial content to
  salvage).
- Completion ownership: the runner never emits message-metadata /
  finish; the router owns completion (retry + persistence ordering).
  Error turns surface as a held `{type:"error"}` chunk.
- Retry loop (once): unknown-model -> drop `--model` (config
  default), GATED on `!runAuth || runAuth.provider === "openai"`.
  Otherwise the retry would swap the real error for a misleading
  missing-auth failure on a provider the user never set up. No
  resume retry exists: continuity is a bounded
  `<conversation_history>` transcript block (last 8 messages, text
  parts only, 12k-char front-truncated).

## Signals: SIGINT is slow/ignored (load-bearing)

A network-blocked turn SURVIVED SIGINT in-sandbox (still alive after
3s; SIGKILL exited 137). `interrupt()` therefore sends SIGINT, then
escalates to SIGKILL after 3s; cancellation is detected via our own
abort flag. Stop latency is up to ~3s by design. The `openclaw` entry
is a direct node script on PATH (`$OPENCLAW_BINARY` override); no
wrapper bypass is needed.

## Auth posture (environment injection — no disk touch)

`openclaw onboard` persists keys as PLAINTEXT auth profiles by
default (per docs), so mausCode holds ONE encrypted credential
instead (provider + key + model + label, AES-256-GCM via the shared
token crypto, `openclaw_credentials` table, drizzle 0013) and
injects it per-run via the spawn ENVIRONMENT. Live-verified: with
`OPENAI_API_KEY` set, `models status` reports openai `effective.kind:
"env"` and clears `missingProvidersInUse` — in the DEFAULT run mode,
so ambient config (MCP, harness) stays loaded. `~/.openclaw` is NEVER
written. Consequences:

- `testConnection` is fast and free (binary identity + credential
  presence only); runtime auth errors stay authoritative per-turn.
- The connect modal is a credential form (4 presets: OpenAI,
  Anthropic, OpenRouter, xAI — each env-var shown, e.g. "injected as
  OPENAI_API_KEY"), not a browser flow. Opening it over an
  already-connected backend shows the connected panel instead of
  auto-closing.
- `getIntegration` checks binary -> held -> ambient (`models status
  --json`, live: exit 0, side-effect-free, honors $HOME), so
  CLI-native users see `source: cli-config` and held runs SKIP the
  status spawn (binary-first ordering added in review).
- No-held-credential runs still work through ambient config + ambient
  env keys.

## Catalog findings (live,-shape the preset/model lists)

- `models list --json` -> `{count, models:[{key,name,input,
  contextWindow,local,available,tags,missing}]}`. The default catalog
  is `openai/gpt-5.6-sol` (+ sandbox-only github-copilot entries).
- Setting `ANTHROPIC_API_KEY` expands the catalog with 7 hyphenated
  anthropic refs (no network needed); `OPENROUTER_API_KEY`/
  `XAI_API_KEY` do NOT expand the list — BUT exec-time `--model`
  resolution accepts them anyway (`openrouter/auto`, `xai/grok-4`,
  `xai/grok-code-fast-1` all reached the network, i.e. resolved).
- Every UI/preset/static model ref was individually verified to
  RESOLVE env-only (network-timeout, never "Unknown model"):
  `openai/gpt-5.6-sol`, `anthropic/claude-opus-5`,
  `anthropic/claude-sonnet-5`, `anthropic/claude-haiku-4-5`,
  `openrouter/auto`, `xai/grok-4`, `xai/grok-code-fast-1`.
- gemini/deepseek/zai/moonshot/ollama need config entries env-only
  runs cannot supply: no presets (follow-up: temp `--config` merge).
- `listModels` spawns the CLI catalog WITH the held key in env
  (catalog expands for the held provider), then held model, then the
  verified static list.

## MCP posture

`openclaw mcp list --json` (live shape: `{name: definition}` map —
NOT the docs' `{path, servers[]}`) is the source of truth: the CLI
loader resolves JSON5/`$include`/migrations a file parse would miss.
Definition keys live-verified: command/args/env/url/transport/
headers (+ docs: auth/oauth/toolFilter/timeouts). Global-only — one
"Global" group; no project surface exists. mcporter servers
(`config/mcporter.json`) are explicitly NOT covered (the list command
excludes them). `refreshMcpConfig` is an explicit no-op (the reader
shells to the CLI every call).

## Deliberate deviations from the sibling routers

- `streaming: false, partialStreaming: false` — the only
  non-streaming backend. Long turns emit NOTHING until the envelope
  lands (up to the 600s deadline); the UI shows a pending turn with
  no deltas. No mitigation exists headless.
- No plan-mode flag exists: plan/ask turns carry a read-only
  planning prefix in the prompt (`PLAN_READONLY_PREFIX`); prompt
  injection by the workspace can only weaken this (same caveat class
  as all prompt-level guards).
- The drop-model retry is provider-gated (see above) — siblings drop
  unconditionally.
- `finishMetadata` carries NO sessionId (not resumable; a stored id
  would poison future turns).
- Provider inference in active-chat places the openclaw check BEFORE
  the codex/openrouter checks (refs carry slashes and would misread
  as OpenRouter). Exact `=== "openclaw"` match only (no prefix
  match — strictly less false-positive surface than the cline twin).
- Capability: `resume: false`, `parallelTools: false` (unverified),
  `subagents: false`, `skills: false` (upstream skills exist but
  exec-run loading is unverified), `images: true` (path-reference
  posture — no image input surface on exec).

## Follow-ups

- Live success smoke: first real-key run should confirm the ok
  envelope shape (`final`, `usage`, `toolSummary` keys) against the
  docs-sourced projection, and confirm exec auto-approvals (docs:
  "full execution policy"; unverified without a successful turn).
- Custom/local endpoints: temp-`--config` support (baseUrl + ollama)
  needs an ambient-config merge for MCP retention; explicitly
  deferred.
- mcporter (`config/mcporter.json`) MCP servers are invisible to the
  settings tab; decide whether to read that file too.
- `--id`-style resume does not exist for exec; if upstream adds a
  session-continue flag, hang it on the `cleanupProvider` hook.
- Model-ref drift: the 7 static refs were live-resolved 2026-09-11;
  the gated invalid-model retry makes drift a warning for openai
  and an explicit error otherwise.
