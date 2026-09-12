# Cline provider adoption — decision brief

Date: 2026-09-11. Source: official Cline docs (Headless, Provider
Config, Controls/MCP, Rules pages) + the npm `cline` README + the
installed CLI 3.0.61 `--help` + live unauthenticated probes with a
stub Responses-API provider (no upstream port; mausCode-authored).
Provenance: docs fetched 2026-09-11; headless envelope, `--json`
NDJSON vocabulary, binary layout, and signal behavior all verified
live in-sandbox.

## What was built

An 8th provider ("Cline") driving the `cline` binary (NOT the npm
node wrapper — see below) over native print turns
(`src/main/lib/cline-print/`), mirroring the qwen backend's proven
shape (args/session/auth-config/mcp-config + router + transport +
modal + selector/form/input/MCP-tab wiring):

- argv: `cline -P <provider> -k <key> -m <model> [-p] [-c <cwd>]
  [-t <s>] --json -- <prompt>`; `-p` (plan mode) for plan/ask turns,
  default act mode otherwise. `--` before the positional is
  load-bearing (dash-leading prompts fail with `unknown option`
  otherwise, live-verified); `--json` mode rejects piped-stdin
  prompts, so stdin carriage is NOT an option.
- Envelope: `--json` NDJSON with `hook_event` (ignored lifecycle
  markers) / `agent_event` (`iteration_start/end`, streaming
  `content_start/end` for text, complete-per-iteration tool blocks,
  `usage`, terminal `done{reason,text,usage}`) / terminal
  `run_result{finishReason,usage,aggregateUsage,durationMs,text}` /
  top-level `{"type":"error"}` (CLI failures + an echo of agent
  failures; `hook dispatch failed` lines are hub noise and ignored).
  stderr ALSO carries JSON error lines — parsed with the same
  handler. Notably this is the 3.x wire vocabulary, NOT the stale
  ask/say docs.
- Exit codes are UNRELIABLE (live: success 0, `-t` overrun 1,
  agent-error 0-or-1, SIGINT-cancel 0, arg errors 0) — completion
  status comes from EVENTS, never the code. Cancellation is detected
  via our own abort flag.
- Completion ownership: the runner never emits message-metadata /
  finish; the router owns completion (retry + persistence ordering).
  Error turns surface as a held `{type:"error"}` chunk so recovered
  turns never flash a false failure.
- Retry loop (once): unknown-model -> drop `-m` (provider default).
  No resume retry exists: `--id` is broken in ALL headless paths in
  3.0.61 (fails with "requires a prompt argument" even with a prompt,
  on failed AND completed sessions). Multi-turn continuity comes from
  a bounded `<conversation_history>` transcript block in the prompt
  (last 8 messages, text parts only, 12k-char front-truncated).

## Signals: bypass the npm wrapper (load-bearing)

The npm `cline` wrapper spawns the compiled Bun child with
`spawnSync` and does NOT forward signals: SIGINT-cancel through the
wrapper is silently ignored (verified live — the run continues to
completion). mausCode resolves the REAL binary instead
(`src/main/lib/cline-binary.ts`: `$CLINE_BINARY` -> `$CLINE_BIN_PATH`
-> `bin/.cline` next to the resolved `cline` entry -> PATH), and
spawned directly the binary dies promptly on SIGINT with truncated
JSONL. `interrupt()` sends SIGINT with a 3s SIGKILL escalator. Known
gap: the wrapper harvests OS trust anchors into NODE_EXTRA_CA_CERTS
for the child; direct spawns rely on the runtime's bundled CAs, so
corporate-proxy TLS may fail (surfaces as a provider error, not a
hang).

## Auth posture (mirrors qwen's held-credential invention)

Interactive `cline auth` persists provider credentials to
`~/.cline/data/settings/providers.json` with the apiKey in PLAINTEXT
(observed live), so mausCode holds ONE encrypted credential instead
(provider + key + baseUrl + model + label, AES-256-GCM via the shared
token crypto, `cline_credentials` table, drizzle 0012) and injects it
per-run via `-P/-k/-m` flags. The user's `~/.cline` files are NEVER
written. `CLINE_DATA_DIR` (documented env) replaces `~/.cline/data/`
when set and is honored by every reader. Consequences:

- `testConnection` is fast and free (binary identity + credential
  presence only); it never spends a billed call validating the key.
- The connect modal is a credential form (7 presets: openrouter,
  anthropic, openai, deepseek, ollama/lmstudio keyless, custom
  OpenAI-compatible endpoint), not a browser flow. Opening it over an
  already-connected backend shows the connected panel (integration
  detail + Replace + Disconnect) instead of auto-closing.
- `getIntegration` additionally reports ambient CLI config
  (`providers.json` lastUsed/has-key) so CLI-native users see
  `source: cli-config`; held credentials always win at run time, and
  no-held-credential runs still work through the ambient config.
- The CLI has NO per-run baseUrl flag, so custom-endpoint credentials
  run inside a per-turn isolated `CLINE_DATA_DIR` (mkdtemp dir with a
  0600 providers.json, deleted after the turn; the user's MCP
  settings/rules/skills are COPIED in so they keep loading).
  Fixed-endpoint providers never touch disk. The isolated doc
  deliberately pins NO model: the per-run `-m` flag overrides it,
  and a pinned model would defeat the unknown-model retry (caught in
  review — the retry drops `-m` to reach the provider default).

## MCP posture

`cline config mcp --json` lists servers but WITHOUT definitions
(name/transportType/disabled/path only — verified live), so the
machine-readable source of truth is the `mcpServers` map in the
settings files: global
`~/.cline/data/settings/cline_mcp_settings.json` (the path `cline
config mcp` actually reads — the `~/.cline/mcp.json` path in the docs
is NOT read by the CLI) plus project `.cline/mcp.json` (documented
project path; shown as its own group even though the CLI list command
does not merge it). No scrape layer exists (unlike qwen). Tool
enumeration reuses the shared stdio/HTTP fetchers; `env`/`headers`
values are read (spawning needs them) but never logged, and the
settings UI renders keys only. `refreshMcpConfig` is an explicit
no-op (readers hit disk every call).

## Deliberate deviations from the sibling routers

- `finishMetadata` carries NO sessionId: cline sessions are not
  resumable, and a stored id would only poison future turns.
- Provider inference in active-chat places the cline check BEFORE
  the codex/openrouter checks: cline ids carry slashes
  (`anthropic/claude-opus-4-6`) and would otherwise misread as
  OpenRouter `provider/model` ids. Canonical provider bindings
  (persisted at create/switch) still win; inference is legacy
  fallback only.
- `tool-input-available` ships `input: {}`: tool input is genuinely
  absent from the CLI stream (tool blocks arrive complete with
  output), so tool cards render name + result.
- Images travel as prompt path references the agent reads via tools
  (cursor posture): `@./path.png` mentions exist upstream but
  headless image support is unverified, so attachments are staged to
  temp files and appended as a `Referenced files:` block.
- Capability: `resume: false`, `fork: false`, `structuredOutput:
  false`, `images: true` (path-reference posture), `subagents: true`
  (upstream `spawn_agent`/team tools flow through the projector).

## Follow-ups

- Live key smoke: no provider key exists in-sandbox, so the held
  run path (`-P/-k/-m` injection -> provider -> NDJSON) is verified
  by construction + unit tests + the unauthenticated envelope probes
  only. First run with a real key should confirm auth, and confirm
  `-m` overrides the stored model (the retry design assumes it).
- `--id` resume: re-test each CLI upgrade; if fixed, hang cached
  task ids on the router's `cleanupProvider` hook and drop the
  transcript-block substitute.
- Model-id drift: `CLINE_MODELS` pins npm-README-verified ids
  (`anthropic/claude-opus-4-6`, `anthropic/claude-fable-5.1`,
  `claude-sonnet-4-6`, `google/gemini-3-pro`, `gpt-5`); the
  invalid-model retry makes drift a warning, not a breakage.
- The 3.0.61-era docs still describe ask/say vocabulary; if the CLI
  revs its `--json` vocabulary, unknown line types already pass
  silently (forward-compat) but the projector wants a re-capture.
