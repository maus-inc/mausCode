# Backend landscape: 30+ CLIs/agents integration survey

Date: 2026-09-11. Provenance: web research (official docs primary, community
secondary) for the provider-agnostic backend program. User priority order:
opencode, claude, hermes (full fidelity), cursor, grok build, qwen, roo code,
cline, openclaw, then the 30 most-used CLIs. Capability posture is tucked in
Settings; only violations surface in chat UI.

## Integration strategy ladder (applies to every backend)

Prefer in this order; stop at the first viable rung:

1. **Native TS/JS SDK** (type-safe, maintained) — e.g. Claude Agent SDK,
   `@opencode-ai/sdk`, `@cline/sdk`.
2. **Local serve/API + event stream** (REST + SSE/WebSocket, OpenAPI where
   available) — e.g. `opencode serve`, OpenClaw gateway RPC.
3. **Headless structured CLI** (one-shot or resumable, JSON/NDJSON output) —
   e.g. `cursor-agent -p --output-format stream-json`, `cline --json`,
   `qwen --prompt`, `opencode run --format json`.
4. **ACP (Agent Client Protocol)** — for CLIs that speak it (qwen, cline,
   hermes `acp_adapter/`, gemini CLI); reuse the generic
   `@mcpc-tech/acp-ai-provider` path already used by the gemini router.
   (Cursor graduated from this rung to rung 3 on 2026-09-11.)
5. **Raw API** (OpenAI-compatible or vendor) — last resort before PTY; loses
   the CLI's tools/sandbox unless re-implemented (avoid: that IS lock-in to
   our re-implementation).
6. **PTY scraping** (tmux send-keys/capture-pane) — only for interactive-only
   surfaces (hermes interactive TUI); never for core chat.

## Priority backends (deep survey)

### 1. opencode (MIT, Anomaly) — REFERENCE IMPLEMENTATION

- `opencode serve [--port] [--hostname]`: headless HTTP server, OpenAPI 3.1
  at `/doc`, basic auth via `OPENCODE_SERVER_PASSWORD` (user `opencode`).
  Binds loopback by default; random port when TUI-spawned.
- Official SDK `npm i @opencode-ai/sdk`: `createOpencode()` spawns
  server+client; `createOpencodeClient({baseUrl})` for client-only; generated
  types `Session, Message, Part`.
- Sessions: list/create/get/delete/patch/children/todo/init/fork/abort/
  share/diff/summarize/revert/unrevert/permissions. Messages: list, sync
  POST, `prompt_async` (204, then SSE), command, shell.
- Events: `GET /event` SSE (`server.connected` first, then bus events).
- Config: get/patch, providers list, provider OAuth authorize/callback,
  `PUT /auth/:id`, MCP status + dynamic add, agents/commands/files/LSP.
- Models are `provider/model`; permissions `edit`/`bash`: ask/allow/deny;
  agents incl. permission-restricted `plan`.
- Auth state: `opencode auth login` → `~/.local/share/opencode/auth.json`.
- mausCode strategy: spawn `opencode serve --port <free>` ourselves (binary
  resolution + env like other routers), drive via SDK client-only + SSE.
  Sources: [server](https://opencode.ai/docs/server/),
  [sdk](https://opencode.ai/docs/sdk/), [cli](https://opencode.ai/docs/cli/).

### 2. claude (Anthropic, proprietary) — SDK ALREADY INTEGRATED

- `@anthropic-ai/claude-agent-sdk` (repo already depends on it; claude.ts
  lazy-imports `query()`). `query({prompt, options})` returns an
  AsyncGenerator `Query` with `interrupt/setPermissionMode/setModel/
  supportedModels/supportedCommands/supportedAgents/mcpServerStatus/
  accountInfo/streamInput/close`.
- Options cover: `permissionMode`, `canUseTool`, `allowedTools/
  disallowedTools`, `mcpServers`, subagent `agents`, `hooks`, `resume/
  forkSession/continue`, `outputFormat` (JSON schema), `sandbox`,
  `settingSources` (default `[]` = no filesystem settings; include
  `'project'` for CLAUDE.md), `maxTurns`, `abortController`, `env`.
- MCP rule: prefer `allowedTools` wildcards (`mcp__server__*`) over
  `bypassPermissions`; `acceptEdits` does NOT auto-approve MCP tools.
- Work remaining: align existing claude/claude-code routers to the provider
  interface + capability profile (no rewrite).
  Sources: [TS SDK](https://docs.claude.com/en/docs/agent-sdk/typescript),
  [methods](https://platform.claude.com/docs/en/agent-sdk/typescript),
  [MCP](https://platform.claude.com/docs/en/agent-sdk/mcp).

### 3. hermes (NousResearch, open source) — FULL FIDELITY

- Repo `NousResearch/hermes-agent`: same agent core across CLI, messaging
  gateway (~20 platforms), TUI, Electron app. Any LLM provider (20+ incl.
  OpenRouter/local). Memory+skills, subagents, cron jobs, real terminal +
  browser. Extended via plugins/skills, not core growth.
- **Ships `acp_adapter/`** → core chat via the generic ACP path (streaming,
  tools). One-shot CLI: `hermes chat -q '...'` (background-able).
  Interactive CLI needs a real PTY (prompt_toolkit; tmux pattern documented).
- Full-fidelity surface inventory (nothing eliminated): CLI chat (+one-shot),
  ACP adapter, gateway + channels, cron/scheduled jobs, skills + plugins +
  plugin-catalog, providers, memory, TUI, Electron app, evals.
- mausCode strategy: ACP for chat; `hermes <subcommand>` (+skills) for
  cron/webhooks/tools state; gateway/channels/TUI/Electron stay Hermes-owned
  surfaces reported in the capability manifest, not re-implemented.
  Sources: [repo](https://github.com/NousResearch/hermes-agent),
  [AGENTS.md](https://github.com/NousResearch/hermes-agent/blob/main/AGENTS.md),
  [docs](https://hermes-agent.nousresearch.com/docs/user-guide/skills/bundled/autonomous-ai-agents/autonomous-ai-agents-hermes-agent).

### 4. cursor (Anysphere, proprietary)

- `cursor-agent` (aka `agent`): `-p/--print` headless, `--output-format
  text|json|stream-json`, `--stream-partial-output`, `--force` (file mods in
  scripts; without it changes are proposed-only), `--resume`, `--model`,
  `--workspace`, `CURSOR_API_KEY` env. Image inputs by file path.
- SHIPPED 2026-09-11: native print backend (`agent -p --output-format
  stream-json`, login/modal/transport/MCP UI; `src/main/lib/cursor-print/`,
  `trpc/routers/cursor.ts`). ACP path superseded.
  Source: [headless](https://cursor.com/docs/cli/headless).

### 5. grok build (xAI)

- SHIPPED 2026-09-11: native print backend over the official **Grok Build
  CLI** only (`grok -p --output-format streaming-json`; community `grok`
  CLIs are detected and rejected with a `$GROK_BINARY` hint — never
  targeted). Files: `src/main/lib/grok-print/` (argv/projector, 30 tests),
  `grok-binary.ts`, `grok-mcp.ts`, `providers/grok.ts`,
  `trpc/routers/grok.ts`, renderer transport + device-auth login modal +
  model picker + MCP section (mirrors cursor UI 1:1).
- Protocol (official user guide, xai-org/grok-build): streaming-json
  events text/thought/suppressed/tool_call/tool_call_update/usage/plan/
  available_commands/end/error; `end` always last, carries sessionId;
  exit 130/143 + SIGTERM interrupt/resume; headless ignores piped stdin
  (long prompts via `--prompt-file`); `-s UUID` client-chosen new ids,
  `-r` resume; plan mode read-only even under always-approve; ask =
  `--tools read_file,grep,list_dir,web_search,web_fetch` allowlist;
  turbo = `--always-approve --permission-mode bypassPermissions`.
- Auth: `grok login` (browser) / `--device-auth` (URL + user code),
  `~/.grok/auth.json` (0600, `$GROK_HOME` override), `XAI_API_KEY`
  fallback; no `status` subcommand — auth probed from credential
  locations. MCP: `grok mcp list --json` + `[mcp_servers.*]` in
  `~/.grok/config.toml` / `.grok/config.toml`. Models: `grok models`
  (dynamic endpoint + static picker fallback, default grok-4.5).
- Install: `curl -fsSL https://x.ai/cli/install.sh | bash`
  (macOS/Linux), `irm https://x.ai/cli/install.ps1 | iex` (Windows).
  Sources: [review](https://www.eigent.ai/blog/grok-build-cli),
  [details](https://claude-code-alternatives.com/cli-agents/grok-cli/).

### 6. qwen (QwenLM, Apache-2.0)

- `qwen` CLI (Gemini-CLI lineage): interactive TUI + `--prompt`
  non-interactive + `stream-json` + **ACP**; MCP via `.qwen/settings.json`
  (project) / `~/.qwen/settings.json` (user), `qwen mcp add` (stdio/SSE/
  HTTP, trust flags to skip confirmations).
- Experimental TS SDK exists (upstream issue #926 tracks programmatic use);
  MCP-config-by-flag still missing (config-file workaround races with
  parallel instances — adapter must serialize or scope configs).
- Strategy: ACP first (matches existing provider path), `--prompt`/
  stream-json second, SDK when stable.
  Sources: [mcp](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md),
  [issue #1278](https://github.com/QwenLM/qwen-code/issues/1278).

### 7. roo code — ARCHIVED, DO NOT START NEW WORK

- Repo archived; final release **May 15, 2026**; team pivoted to cloud
  product "Roomote". Recommended migration: **Kilo Code** or Cline.
- Had: `@roo-code/cli` headless (stdin NDJSON protocol:
  start/message/cancel/ping/shutdown), multi-provider, vscode-shim.
- **Proposed substitute: Kilo Code** (MIT, ~27k stars): Roo fork, CLI built
  on OpenCode — likely reuses the opencode serve/SDK protocol, so the
  opencode adapter may drive it with minimal changes (verify per recipe).
  Source: [survey](https://pinggy.io/blog/best_open_source_cli_coding_agents/).

### 8. cline (Apache-2.0)

- One engine, four surfaces: `@cline/sdk` (TS: `new Agent({providerId,
  modelId, systemPrompt, tools})`, `run()/continue()`, `createTool`,
  plugins, hooks, subagents, cron), CLI (`cline --json` headless, pipeable,
  `jq`-friendly `agent_event`s), desktop app (Tauri), VS Code extension.
- Also: plan mode, parallel subagents + git worktrees, ACP.
- Strategy: SDK first (deepest), CLI `--json` second.
  Sources: [repo](https://github.com/cline/cline),
  [sdk](https://github.com/cline/cline/blob/main/sdk/README.md).

### 9. openclaw (MIT, OpenClaw Foundation 501c3)

- Self-hosted **Gateway** (Node 24/26) + CLI + Web Control UI (default
  `http://127.0.0.1:18789/`) + macOS/iOS/Android nodes. Any model, no hosted
  middle, telemetry opt-out-able. Multi-channel (Discord/Signal/Telegram/
  WhatsApp/…), multi-agent routing, skills (+ClawHub marketplace), cron/
  hooks/webhooks, memory, media, plugin SDK.
- Config `~/.openclaw/openclaw.json`; state sqlite; `openclaw onboard
  --non-interactive` for scripted setup; CLI reference + RPC reference in
  docs; gateway token auth; loopback bind for local.
- Strategy: spawn gateway on loopback ourselves, drive via gateway RPC/CLI
  agent turns; channels stay OpenClaw-owned surfaces in the manifest.
  Sources: [docs](https://docs.openclaw.ai/),
  [skills](https://docs.openclaw.ai/tools/skills),
  [automation](https://docs.openclaw.ai/start/wizard-cli-automation).

## The wider 30+ CLI map (strategy per tool)

| Tool | License/cost | Integration rung |
|---|---|---|
| Gemini CLI | Apache-2.0, free tier | Headless `-p/--prompt` + JSON/stream-json; ACP (same lineage as qwen) |
| Aider | Apache-2.0, BYOK | `--message` one-shot + `--yes` + `--no-pretty`; git-native; weakest streaming (poll/replay) |
| Crush (Charm) | FSL-1.1-MIT, BYOK | Headless run mode; Go binary, Termux-capable; check `--format json` per recipe |
| Goose (Block/LF) | OSS, BYOK | `goose run` headless `--text`; MCP-first; extensions via manifest |
| Copilot CLI | Proprietary, sub | `gh copilot` suggest/explain; fleet mode + delegation; weakest agent loop |
| Amp (Sourcegraph) | Proprietary, PAYG | CLI + IDE; deep mode; credits billing in manifest |
| Mistral Vibe | Apache-2.0 CLI, paid models | Devstral-based; headless per recipe |
| Kiro (Amazon) | Proprietary, free tier | Spec-driven; audit trail maps to Thinking chunks |
| Amazon Q Developer | Proprietary, free tier | `q chat --no-interactive`? verify per recipe |
| Antigravity (Google) | Proprietary | Agent IDE; CLI secondary; parallel agents |
| Windsurf | Proprietary | IDE-first; CLI secondary |
| Continue.dev | OSS | IDE-first; headless via headless mode? verify per recipe |
| Zed agent | OSS (Rust) | Editor-first; ACP-speaking (Zed authored ACP) → rung 4 |
| gptme | MIT, BYOK | `gptme -n` non-interactive; chat logs replayable |
| fabric | MIT | Pipe-based patterns; stdout capture |
| sgpt (shell-gpt) | MIT | `--json` output; shell/code/chat modes |
| llm (simonw) | Apache-2.0 | `llm prompt -m` + JSON/templates; logs in sqlite |
| mods (Charm) | OSS | Pipe-friendly markdown; stdin/stdout |
| Ollama | OSS, local | Raw API (`/api/chat`, `/api/generate`); repo has ollama router already |
| llama.cpp server | MIT, local | OpenAI-compatible `/v1/chat/completions` |
| LM Studio | Proprietary, local | OpenAI-compatible local server |
| Jan | AGPL, local | OpenAI-compatible local server |
| Tabby | Apache-2.0, local/team | OpenAPI + chat/completions endpoints |
| Devika / SWE-agent / OpenHands | OSS research | Headless task runners; repo/worktree scoped; verify per recipe |
| Codeium / Windsurf legacy | Proprietary | Skip unless demand (superseded) |
| Warp agent | Proprietary | Terminal-integrated; no headless API → PTY rung only |
| Ghostwriter / Cody (legacy) | Proprietary | Skip (superseded by Amp/Cody successors) |
| Bolt/dyad/v0 | Cloud web | Out of scope for CLI program (web-only, no local protocol) |

## Cross-cutting gotchas (all adapters)

- **Auth state lives outside us**: `opencode auth login`, `codex login`,
  `cursor-agent login`, `hermes` provider keys, `openclaw onboard`. Adapters
  probe/detect, never store credentials; app-managed API keys only via env.
- **Parallel-instance races**: config-file MCP injection (qwen), shared
  auth.json, singleton daemons (opencode serve port, openclaw gateway).
  Serialize or scope per session (free ports, temp config overlays).
- **Resume identity differs**: codex threadId vs sessionId; opencode
  sessionID; cursor `--resume`; cline agent memory. Persist the native id.
- **Approval posture differs**: opencode ask/allow/deny per tool; codex
  approvalPolicy; cursor `--force` gating; ACP `authMethodId`. Manifest must
  report, never silently widen.
- **Structured output cost**: JSON-schema modes (opencode `format`,
  claude `outputFormat`) add validation retries; default off.
- **Licenses for bundling**: MIT/Apache-2.0 CLIs can be bundled or
  PATH-resolved; proprietary CLIs (cursor, claude, copilot) are PATH-only
  + user-installed. FSL (Crush) allows use, restricts competing hosting —
  fine for a desktop app, note in manifest.
