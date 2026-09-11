# Qwen Code provider adoption — decision brief

Date: 2026-09-11. Source: official qwen-code docs + CLI 0.23.3 `--help`
and live unauthenticated probes (no upstream port; mausCode-authored).
Provenance: docs fetched 2026-09-11 (headless, auth, settings, tools,
MCP pages); `qwen -p` envelope verified live in-sandbox.

## What was built

A 7th provider ("Qwen Code") driving the `qwen` binary over native
print turns (`src/main/lib/qwen-print/`), mirroring the grok backend's
proven shape (args/session/auth-config/mcp-config + router + transport
+ modal + selector/form/input/MCP-tab wiring):

- argv: positional prompt + `--output-format stream-json
  --include-partial-messages --channel desktop --approval-mode <mode>
  -m <model> --session-id <uuid>`; resume via `-r <sessionId> --resume`.
  `-p` is deprecated upstream and NOT used. Stdin carries dash-leading
  prompts (live-verified: bare dash-leading positionals fail, `--`
  drops the positional, stdin always works).
- Envelope: JSONL system|assistant|result|stream_event in the
  claude-vocabulary, so translation reuses the shared
  `createTransformer` with a qwen pre-map (snake_case tool ids ->
  canonical names, zeroed assistant usage stripped, disconnected
  mcp status -> failed, permission_denials -> visible text block).
- Completion ownership: the runner withholds message-metadata /
  finish-step / finish; the router owns completion (retry downgrades +
  persistence ordering). Error results surface as a held `{type:"error"}`
  chunk so recovered turns never flash a false failure.
- Retry loop (each once): stale-resume -> fresh session-id,
  unknown-model -> drop `-m`, unknown-flag -> drop `--channel` and
  friends. Exit contract live-verified: exit 0 even for in-envelope
  errors; pre-run failures print to stderr with EMPTY stdout; 130 =
  SIGINT, 143 = SIGTERM, 53/55 = budget aborts.

## Auth posture (the one genuine invention)

Upstream REMOVED `qwen auth` (now prints a removal notice) and ended
the OAuth free tier 2026-04-15; current auth is API-key plans (Coding
Plan `sk-sp-`, Token Plan, DashScope, OpenRouter). There is no
browser/device flow to wrap, so mausCode holds ONE encrypted
credential (authType + key + baseUrl + model + label, AES-256-GCM via
the shared token crypto, `qwen_credentials` table, drizzle 0011) and
injects it per-run via `--auth-type/--openai-api-key/--openai-base-url`
flags. The user's `~/.qwen/settings.json` is NEVER written.
Consequences:

- `testConnection` is fast and free (binary presence + held-credential
  presence only); it never spends a network call validating the key.
- The connect modal is a credential form (7 docs-verified endpoint
  presets + custom), not a browser flow. Opening it over an
  already-connected backend shows a connected panel (integration
  detail + Replace + Disconnect) instead of auto-closing.
- `getIntegration` additionally reports ambient CLI config
  (settings.json modelProviders + env key) so CLI-native users see
  `source: cli-config`; held credentials always win at run time.

## Deliberate deviations from the sibling routers

- `tool-output-error` chunks persist failed tools as
  `{errorText, state: "output-error"}` (renderer-supported terminal
  state) instead of leaving a stuck `call` spinner after reload.
  Siblings ignore this chunk in accumulation.
- `refreshMcpConfig` is an explicit no-op: qwen MCP readers hit disk
  every call, so there is no cache to invalidate (documented in code,
  kept for tab-shape symmetry).
- `mcp-config.ts` returns FULL `env`/`headers` value records
  (unredacted): the values feed stdio tool-fetch spawning and are
  never logged; the settings UI renders keys only.

## Follow-ups

- Live key smoke: no API key exists in-sandbox, so the held-credential
  run path (auth headers -> Coding Plan endpoint -> stream-json) is
  verified by construction + unit tests only. First run with a real
  key should confirm `--openai-api-key` flag auth end to end.
- Model-id drift: `QWEN_MODELS` pins the docs-listed ids
  (`qwen3-coder-plus/next/turbo`, `qwen3.7/3.6/3.5-plus`, `qwen3-max`,
  `glm-5/4.7`, `kimi-k2.5`, `MiniMax-M2.5`); the invalid-model retry
  makes drift a warning, not a breakage.
- `qwen mcp list` has no `--json`: server status is scraped from
  human-readable output (✓/✗ markers); re-check the scrape if the
  CLI changes its list format.
