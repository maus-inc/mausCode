# Current system map — inherited 1Code app + upstream JCode

Provenance: 1Code tree at origin/main 9f1bc76 ("Release v0.0.72"); JCode upstream at
1jehuang/jcode ce4e789 (v0.84.0). All paths relative to repo root unless noted.
Verified by reading source, not docs.

## 1. Current frontend architecture

- Electron renderer (React 19, TS, Tailwind, Radix, `@/` → `src/renderer/`).
  Two HTML entries: `index.html`, `login.html` (`electron.vite.config.ts`).
- `src/renderer/App.tsx` (225 lines): provider stack is Jotai → next-themes →
  sonner Toaster → Tooltip → TRPCProvider → WindowProvider → VSCodeThemeProvider.
  `AppContent` routes between onboarding pages (`features/onboarding`: Anthropic,
  API-key, billing-method, Codex, select-repo) and `AgentsLayout` based on
  onboarding atoms. Multi-window: initial window params (chatId/subChatId) applied
  on mount; chat claimed per window to prevent duplicate windows.
- Feature folders (each with own atoms/stores/ui): `agents` (chat core), `terminal`,
  `changes` (git), `file-viewer`, `details-sidebar`, `sidebar`, `kanban`,
  `automations`, `mentions`, `settings`, `onboarding`, `layout`, `hooks`.
- `agents/` internals: `main/active-chat.tsx` (chat surface), `ui/` (tool renderers,
  preview, viewport), `components/`, `hooks/`, `commands/` (slash), `mentions/`,
  `lib/` (queue-utils, drafts, export-chat, remote-chat-transport), `search/`,
  `context/`, `atoms/` (1155 lines), `stores/` (6 zustand stores).
- Window isolation: `contexts/WindowContext` stable window ids; `lib/window-storage.ts`
  (`atomWithWindowStorage`); zustand keys prefixed `${windowId}:...` with legacy
  fallback. `windowManager` (main) tracks chat ownership per window.
- Rendering perf: per-message `atomFamily` isolation (`message-store.ts`, 1120 lines),
  `@tanstack/react-virtual` for long lists, WDYR wired as JSX import source in dev
  (`DEBUG-WDYR.md`, `wdyr.ts` flag).

## 2. Current backend architecture

- Electron main, bundled CJS (`electron.vite.config.ts`, main entry `src/main/index.ts`).
  Native deps externalized: `electron`, `better-sqlite3`, `@anthropic-ai/claude-agent-sdk`
  (dynamic import only).
- IPC is **tRPC over Electron IPC** (`trpc-electron` `ipcLink`, superjson transformer).
  `createAppRouter(getWindow)` exposes 20 routers (`trpc/routers/index.ts`): projects,
  chats, claude, claudeCode, claudeSettings, anthropicAccounts, ollama, codex, terminal,
  external, files, debug, skills, agents, worktreeConfig, sandboxImport, commands, voice,
  plugins, changes (git via `createGitRouter()`). Context is just `{ getWindow }`; there
  is no auth middleware — every procedure is public within the desktop app.
- Raw `ipcMain.handle` surface (`windows/main.ts`, 861 lines) backs `window.desktopApi`
  (preload, 396 lines): version, updates, theme/clipboard/dialogs, `signedFetch`,
  chat claim, git-watcher bridge, theme scanner. `createIPCHandler` registered once.
- `src/main/index.ts` (1000+ lines): lifecycle, OAuth deep links, menus (About 1Code,
  `1code` PATH installer), trusted origins (`21st.dev`, localhost), API base
  `https://21st.dev`, auth windows. `src/main/lib/platform/` per-OS darwin/linux/windows.
- Dead code found: `src/main/lib/credential-manager.ts` (821 lines) imports
  `./types.ts`, `../credentials/*`, `../auth/*` — none exist — and is imported by
  nothing. `renderer/lib/mock-api.ts` is marked DEPRECATED. No test files anywhere
  in the repo; no test runner configured.

## 3. Current agent execution path

Two independent, non-shared implementations:

**Claude** (`trpc/routers/claude.ts`, 3230 lines) — `chat` subscription:
`observable<UIMessageChunk>` → abort any existing session for subChat (`activeSessions`
map) → read messages JSON from `sub_chats` → offline check with auto-fallback to
Ollama (`offline-handler.ts`, sets `connectionMethod`) → parse `@[agent|skill|file|
folder|tool:...]` mentions → build env (`claude/env.ts`: captured shell env, bundled
Claude binary path, stripped keys) → merge MCP servers (global + project, drop
failed/needs-auth) → build agents option (`agent-utils.buildAgentsOption` from
markdown agent files) → dynamic `import("@anthropic-ai/claude-agent-sdk")` →
`query()` with `permissionMode plan|bypassPermissions`, `allowDangerouslySkipPermissions`
in agent mode, `canUseTool` gate, `settingSources [project, user]` →
`createTransformer()` converts SDK stream to `UIMessageChunk` (AI-SDK chunk format)
→ `safeEmit` guarded by `isObservableActive`. Related: `cancel`, `isActive`,
`respondToolApproval`, `getPendingPlanApprovals` (chats router), rollback stash on
`rollbackToMessage`.

**Codex** (`trpc/routers/codex.ts`, 1949 lines) — `chat` subscription over ACP:
`@zed-industries/codex-acp` native package per platform/arch + `@mcpc-tech/acp-ai-provider`.
`activeStreams` map keyed by subChat with `runId` supersede (`cleanupProvider`).
Input takes `authConfig.apiKey` (BYOK passthrough), model, mode. `cancel`, `cleanup`.
MCP via ACP-side config (`addMcpServer/removeMcpServer/startMcpOAuth/logoutMcpServer`).

Both paths own streaming, cancellation, persistence-writeback, and approvals
separately — no shared agent abstraction. This is the seam the runtime protocol
must close (one `AgentRuntime` interface, see §17).

## 4. Current state management

- **Jotai** (primary UI state): `features/agents/atoms/index.ts` (1155 lines:
  selection, modes `agent|plan`, drafts, preview paths/devices, sidebar, questions,
  approvals, unseen changes, split ratios) + `lib/atoms/index.ts` (925 lines:
  onboarding, settings dialog, multi-select). `atomWithStorage` /
  `atomWithWindowStorage` for persistence; `atomFamily` for per-chat/per-message.
- **Zustand**: `sub-chat-store` (tabs: active/open/pinned/all + up-to-4 split panes,
  persisted per window+chat in localStorage), `message-queue-store` (per-subChat
  FIFO with atomic pop/prepend + sent triggers), `streaming-status-store`,
  `agent-chat-store`, `changes-store`.
- **React Query** (server state via tRPC): stale 5s, gc 60s, `refetchOnWindowFocus:
  false`, `retry: false`, global client exported for non-React use (`TRPCProvider`).
- Conventions are sound (per-message atom isolation during streaming is genuinely
  good); risk is duplication between Jotai mirrors and React Query caches.

## 5. Current persistence

- SQLite (`better-sqlite3` sync driver) + Drizzle, WAL mode, FK on, auto-migrate on
  boot from `drizzle/` (dev) or `resources/migrations` (packaged). File:
  `{userData}/data/agents.db`.
- Tables (6): `projects` (id/name/path unique/git remote fields/icon),
  `chats` (project FK, archive, `worktreePath/branch/baseBranch`, PR fields),
  `sub_chats` (chat FK, `sessionId` SDK resume key, `streamId`, mode, `messages` JSON
  text), `claude_code_credentials` (DEPRECATED single-row), `anthropic_accounts`
  (multi-account OAuth, safeStorage-encrypted), `anthropic_settings` (active account).
- Non-DB persistence: localStorage (tabs, atoms, drafts), `window-settings.json`
  (frame pref), AuthStore files, pasted-text files (`files.writePastedText`),
  terminal serialized state (in-memory + renderer). Messages-as-JSON-text will not
  scale to cross-device sync — the runtime needs real session storage (JCode has it).

## 6. Current filesystem model

- `files` router (511 lines): `search` (cached tree walk, maxDepth 15, `clearCache`),
  `readFile/readTextFile/readBinaryFile`, `watchChanges` (subscription via
  `node:fs.watch recursive`), `writePastedText`, `renameFile`, `deleteFile`.
- No generic write API — agent-side file mutation happens inside Claude/Codex tool
  execution, invisible to this router. `fs/dirent.ts` safe type resolution;
  `file-viewer` + Monaco in renderer.
- Gap: no file locking, no conflict handling between agent edits and user edits,
  watcher is per-subscription with no shared hub (contrast JCode daemon-side state).

## 7. Current terminal model

- `terminal/` lib (1703 lines): `TerminalManager` (EventEmitter) keeps
  `Map<paneId, TerminalSession>` (node-pty), `pendingSessions` dedup for StrictMode,
  `createOrAttach` with `serializedState` recovery, `write/resize/signal/kill/detach`
  (detach keeps alive for remount). Exit handler respawns with fallback shell
  (`SHELL_CRASH_THRESHOLD_MS`). `session.ts` creation + initial commands; `env.ts`
  (374 lines) captures login-shell env via delimiter protocol, strips provider keys;
  `data-batcher.ts` coalesces PTY output; `terminal-history/` persistence;
  `terminal-escape-filter.ts` sanitizes.
- Port/preview coupling: `port-manager` polls every 2500ms across registered
  sessions (`port-scanner` + `pidtree`), ignores system ports, emits detected dev
  servers. Renderer uses xterm + canvas/fit/search/serialize/web-links/webgl addons.
- Sound design; the missing piece is purely placement — sessions are bound to the
  Electron main process on one machine.

## 8. Current Git/worktree model

- `lib/git/` (~25 files): `worktree.ts` (1200 lines: create/remove, branch ops,
  rebase checks, checkout safety, remote detection, `sanitizeGitError`),
  `worktree-naming.ts`, `worktree-config.ts`; `status/diff/staging/stash/branches/
  file-contents/diff-parser`; `cache/git-cache.ts`; `security/` (command allowlist,
  path validation, secure-fs); `github/` (PR ops); `shell-env.ts`; `offline-utils.ts`;
  `sandbox-import.ts`; `watcher/` (chokidar + debounce → batched `GitWatchEvent`
  over `ipc-bridge`, per-window cleanup on close).
- Product model: one worktree per chat (`chats.worktreePath/branch/baseBranch`),
  `getWorktreeStatus`, `getFileStats`, `getDiff/getParsedDiff`,
  `generateCommitMessage`, PR context/status/merge, export. Rollback via
  `createRollbackStash/applyRollbackStash` (`rollbackToMessage`).
- Exposed to renderer as router `changes` ("match Superset API" naming). This module
  is the strongest KEEP candidate: hardened paths, real product behavior, no
  21st-backend dependency.

## 9. Current authentication

- **Desktop user auth** (21st-coupled, must be reimplemented): `auth-manager.ts`
  (OAuth code exchange at `https://21st.dev/api/auth/desktop/exchange`, refresh
  timer, `getValidToken`), `auth-store.ts` (file-persisted `AuthData/AuthUser`),
  deep-link protocols, `getBaseUrl`. `signedFetch` proxies authed API calls.
- **Anthropic/Claude auth**: `claude-code.ts` router (OAuth token encrypt via
  `safeStorage` with base64 fallback when unavailable, multi-account store),
  `anthropic-accounts.ts` (list/getActive/setActive/add/rename/remove/migrateLegacy),
  `claude-token.ts` (existing-token discovery). Dev strips `ANTHROPIC_API_KEY` to
  force OAuth; prod passes user shell env through (BYOK-friendly).
- **MCP auth**: `mcp-auth.ts` (OAuth start/status, bearer tokens, `ensureMcpTokensFresh`,
  stdio + fetch tool probing), `oauth.ts` (942 lines, metadata fetch, base URL).
- **Codex auth**: login sessions (`startLogin/getLoginSession/cancelLogin/logout/
  getIntegration`) + per-chat `authConfig.apiKey`.
- Secrets hygiene: encrypted at rest where safeStorage exists, but tokens flow
  through chat inputs and logs need auditing (console.error of env PATH slices etc.).

## 10. Current provider configuration

- No unified provider abstraction. Anthropic (OAuth accounts + env passthrough),
  Codex (login/API key), Ollama (local models, offline fallback), `customConfig
  {model,token,baseUrl}` per chat call, voice (`setOpenAIKey/hasOpenAIKey`, Whisper),
  `claude-settings` (plugin toggles, MCP approvals, co-authored-by). Agent markdown
  models restricted to sonnet/opus/haiku/inherit.
- The `customConfig` + Ollama fallback proves OpenAI-compatible routing demand;
  JCode's provider catalog + `SetApiKey` is the natural consolidation target.

## 11. Current background execution

- **No local background daemon.** Agent runs live in main-process memory
  (`activeSessions`/`activeStreams`); quitting kills them (close confirmation via
  `hasActiveClaudeSessions/abortAllClaudeSessions`, same for Codex).
- Queueing exists only in renderer (`message-queue-store` + `lib/queue-utils` +
  QueueProcessor auto-send) — dies with the window.
- `automations/` views (cards, templates, inbox, triggers) and background-agent
  marketing are hosted-21st.dev features; CONTRIBUTING confirms Background agents =
  hosted-only. `sandbox-import` lets desktop adopt a formerly-remote chat.
- JCode closes this gap structurally: detached `serve` daemon, idle shutdown,
  restart snapshots, `bg` tool, ambient/overnight schedulers, hooks.

## 12. Current preview system

- `agents/ui/agent-preview.tsx`: URL preview with viewport toggle, device presets,
  scale control, resize handle, mobile copy-link; per-chat `previewPathAtomFamily`.
  `preview-setup-hover-card`, `preview-url-input`.
- Local: ports detected by `port-manager` → user picks URL. Remote/hosted: mock
  `getSandboxPreviewUrl = https://{sandboxId}-{port}.csb.app` (codesandbox; the
  commented import shows it was pasted from the web app and stubbed for desktop).
- No port forwarding, no auth, no share links locally. Remote story depends on
  tunnels/relay in the future device model.

## 13. Current remote execution

- Effectively absent in OSS. `remote-trpc.ts` builds an httpLink client against a
  `../../../../web/server/api/root` type that does not exist in this repo
  (type-only, erased — but proves the desktop expected a sibling web backend);
  `remote-api.ts` + `signedFetch`; `remote-chat-transport.ts` (275 lines) adapts
  remote chats to the local message pipeline; `selectedChatIsRemoteAtom` switches
  transports; `sandbox-import` (672-line router + `git/sandbox-import.ts`) clones a
  remote sandbox session into a local worktree + chat rows.
- All remote paths terminate at 21st.dev. There is no generic remote-runner interface.
  The mausCode device/relay design starts from zero here (T3/Hermes patterns apply).

## 14. Current MCP/plugin handling

- Config: `claude-config.ts` reads global (`GLOBAL_MCP_PATH`), `~/.claude/` dir, and
  project `.mcp.json` (resolving worktree → project root); `updateMcpServerConfig/
  removeMcpServerConfig/writeClaudeConfig`; merged view hides failed/needs-auth
  servers from execution but surfaces status in UI (`MCPServerStatus`).
- Runtime: tools fetched per run (`fetchMcpTools/fetchMcpToolsStdio`), `@[tool:]`
  mentions filter/hint, plugin MCP servers gated by explicit per-server approval
  (`approvePluginMcpServer/...All`, `getPendingPluginMcpApprovals`).
- Plugins: `plugins` router list/clearCache; `lib/plugins` discovery of installed
  marketplace plugins + component paths (agents/skills/commands/MCP contributed per
  plugin; `getEnabledPlugins` filters). Skills router (user/project/plugin sources),
  commands router (slash commands CRUD + content), agents router (file-agent CRUD).
- Formats are markdown + YAML frontmatter — directly compatible with JCode's
  skill/agent conventions. JCode's shared MCP pool + `mcp__server__tool` namespacing
  matches the existing `mcp__...` mention validation regex.

## 15. Current performance characteristics

- Good: per-message atom isolation, PTY data batching, debounced git watcher batches,
  cached file search, react-virtual, WDYR in dev, sync SQLite with WAL (fast local
  reads), dynamic SDK import (startup cost deferred), deduped terminal creation.
- Unmeasured: zero benchmarks, zero tests, no telemetry on session latency/tool
  latency/startup (only PostHog product analytics + Sentry, both 21st-coupled and
  off-by-default in OSS). `loggerMiddleware` exists but routers mostly use bare
  `publicProcedure` — no timing visibility.
- Risks: messages JSON blob rewritten per update; full-message-array scans for
  approvals; 2.5s port polling per session; superjson over IPC per chunk;
  main-process singletons grow unbounded (sessions, ports, watchers) with no
  eviction; renderer mirrors server state in multiple stores.
- Baseline to capture before changes: cold start, first-token latency (Claude +
  Codex), session create/resume, memory idle/loaded, event throughput. Bun is the
  package manager; CI owns these numbers (see `../decisions/provisional-assumptions.md`
  PA-6 for environment constraints).

## 16. Current JCode architecture (upstream v0.84.0, MIT, Jeremy Huang)

- Rust workspace, 82 crates, `edition 2024`. Shape: `jcode` root (cli/tui launch) +
  `jcode-app-core` (server, agent, tools) + `jcode-harness-api` (stable v1 boundary)
  + `jcode-harness-api-server` (bridge) + `jcode-protocol` (legacy internal wire) +
  `jcode-transport` (unix socket / win named pipe) + `jcode-storage` + session/
  message/tool/config/memory/background/batch/plan/swarm/compaction/embedding/fuzzy/
  logging/telemetry/update `-types|‑core` crates + provider crates (anthropic, openai,
  openrouter, gemini, bedrock, copilot, antigravity, cursor/grok/claude-cli runtimes,
  metadata catalog, doctor, env) + `jcode-tui-*` (strip: TUI is not our dependency).
- **Single-server, multi-client**: `jcode serve` daemon owns all sessions; clients
  attach over socket; registry `~/.jcode/servers.json`; idle shutdown 5 min; `/reload`
  execs new binary; `JCODE_SERVER_NAME` stable identity; `server stop` management.
- **Stable harness API v1** (`jcode-harness-api`): NDJSON, `{v,id,req}` /
  `{v,reply_to?,ev}` envelopes, `Unknown` catch-alls, minor-additive/major-breaking
  with handshake. Requests: hello, list/archive/restore/retention/create/attach/fork/
  detach/peek/clear/rewind(+undo)/rename sessions, send_message, cancel,
  soft_interrupt(+cancel), permission_response, list_models/set_model/
  set_reasoning_effort, runtime_info, set/clear_api_key, read_file/find_files/
  search_text/file_status, compact, ping. Events: hello_ok, ok/error, sessions/
  attached/forked/history, pong, text/reasoning deltas, tool_start/input_delta/exec/
  done, images, token_usage, turn_done, permission_request, session_status,
  connection_phase, model(s)/runtime info, credential_updated, file(s)/matches/
  status, compacted, renamed. **This is the integration surface.**
- **Bridge** (`jcode-harness-api-server`): serves the stable API on `jcode-api.sock`
  (`JCODE_API_SOCKET`), translates JSON-to-JSON to the legacy daemon socket without
  depending on internal types; 16 MiB frame cap; explicitly built so a desktop app
  can connect (socket-path bug class already fixed once via shared `sockets.rs`).
- **TypeScript SDK** (`sdk/typescript`, `@1jehuang/jcode-sdk`): mirrors the API crate,
  NDJSON over socket, `launch()` (starts own daemon+bridge, ships platform binaries
  via optional deps for 6 targets) / `connect()`; schema-drift tests both directions.
  **Fastest Electron-main integration path: use or fork this SDK.**
- **Tools** (`app-core/src/tool/`, registry + per-session policy): read, write, edit,
  multiedit, patch, apply_patch, ls, bash (+destructive gate), browser, open,
  computer, webfetch, websearch, todo, bg, memory, skill, batch, mcp (`mcp__…`
  namespaced via **shared MCP pool**), swarm/communicate, schedule (ambient),
  selfdev, gmail, goal/initiatives, session_search, conversation_search, agentgrep,
  side_panel, discover (+discover_secrets), feedback, jcode_docs, config_edit_notice,
  invalid. Output capped at 512 KiB for history with explicit truncation notice.
- **Sessions**: typed transcripts (`session-types`), restart snapshots, rewind/undo,
  compaction core, retention policies, `ResumeTarget` spanning JCode/Claude/Codex/
  OpenCode/Cursor/Pi (`import-core` parsers — the migration seed), session pickers.
- **Remote**: native `--ssh` attach (remote daemon + local UI, `/login` with import-
  local-login, non-interactive SSH, unknown-host-key refusal), `ssh_remote.rs`,
  remote-handoff docs. No Docker/Daytona backends — mausCode adds placements around
  the same node binary.
- **Permissions/safety**: harness `permission_request/response`; `command-risk`
  classification; `bash_destructive_gate`; lifecycle hooks (`pre_tool` gate +
  observers, direct-exec, timeouts); SAFETY_SYSTEM design (auto-allowed vs
  requires-permission, persistent review queue, notifier dispatch) currently wired
  to ambient mode. Two-tier, no always-deny.
- **Providers**: metadata catalog (ids, bases, env files, setup URLs, openai-
  compatible incl. `anthropic-api`/`openai-api` aliases), per-provider auth types,
  `provider-doctor`, env resolution, `/login` pickers, OAuth + API key + import flows.
  BYOK-shaped already.
- **Config**: `~/.jcode/config.toml` (providers, models, agents, hooks, terminal,
  websearch, ambient, notifications, safety, gateway, power, keybindings, display,
  features, sponsors, auto-review/judge). Env overrides win.
- **Perf posture**: README tables claim 27.8 MB PSS (1 session, embedding off) vs
  OpenCode 371.5 / Claude 386.6 / Codex 140; ~9.9 MB per extra client; `MEMORY_BUDGET.md`
  active guardrail with debug surfaces (`:debug memory*`, `server:memory*`,
  runtime memory log analyzer), `TERMINAL_BENCH.md`, `SESSION_CREATION_LATENCY.md`.
  Treat as benchmarks to reproduce, not gospel.
- **Also present**: swarm DAG coordination (mode-gated spawning, worktree managers),
  ambient/overnight schedulers, compaction, telemetry (anonymous minimal; transcripts
  strictly opt-in with versioned consent), auto-update channels, OAuth flows,
  Gmail/Composio integrations, iOS docs. Much of this is out of mausCode MVP scope
  but must not be broken by vendoring.

## 17. Exact seams where JCode replaces inherited execution logic

Principle: replace **execution authority**, keep **product modules**. Integration
vehicle: harness-api v1 client in Electron main (fork of `@1jehuang/jcode-sdk`,
or direct NDJSON client) + a `translate.ts`-style chunk mapper producing the
existing `UIMessageChunk` stream so renderer code keeps working during migration.

| # | Inherited module | JCode counterpart | Seam / verdict |
|---|---|---|---|
| 1 | `claude.ts chat` core (SDK query, transformer) | `send_message` + text/tool events | REPLACE core; keep mention parsing, offline-fallback UX, transformer pattern. Map ApiEvent→UIMessageChunk in `main/lib/runtime/translate.ts` |
| 2 | `codex.ts chat` core (ACP) | same harness `send_message` | REPLACE as native default; keep ACP path as first `CompatibilityAdapter` reference |
| 3 | `activeSessions/activeStreams` maps | daemon-owned sessions + `attach/detach` | REPLACE; `subChats.sessionId` becomes JCode session id; resume via `attach`, crash-safe |
| 4 | `cancel/isActive` | `cancel`, `session_status` | REPLACE (thin map) |
| 5 | `respondToolApproval` + plan approvals | `permission_request/response` | ADAPT UI onto harness permissions; design fresh policy (never copy `bypassPermissions` default) |
| 6 | `files` router read/search | `read_file/find_files/search_text/file_status` | ADAPT: route through runtime when session is remote; keep local fast path + watcher hub |
| 7 | Terminal manager/sessions | none in protocol (by design) | KEEP 1Code manager for local; remote PTY arrives with node placements (SSH exec channel first) |
| 8 | Git/worktree engine | swarm worktree use (not a service) | KEEP entirely; expose to remote via node-side execution later |
| 9 | MCP config + pool | `register_mcp_tools_for_dir` + shared pool | ADAPT: feed merged 1Code config into daemon; keep OAuth/approval UX |
| 10 | Skills/agents/commands markdown stores | skill tool + agent registry | ADAPT: same file formats; daemon resolves `active_skill`; keep CRUD routers as editors |
| 11 | Provider config (accounts/customConfig/ollama) | provider catalog + `set/clear_api_key`, `set_model` | REPLACE plumbing; keep onboarding UI flows; Ollama → openai-compatible endpoint entry |
| 12 | `sub_chats.messages` JSON blob | daemon transcripts + `get_history` | REPLACE gradually: daemon becomes source of truth; DB keeps metadata/index |
| 13 | Queue (renderer-only) | daemon `soft_interrupt`/queue + bg | MOVE server-side in phase 2; keep renderer queue until then |
| 14 | Rollback stash | `rewind/rewind_undo` + git stash | COMBINE: transcript rewind via runtime, tree rewind via stash (already pairs well) |
| 15 | Compaction (SDK-side) | `compact` + compaction core | REPLACE (explicit event `compacted`) |
| 16 | `import-core` + `ResumeTarget` | — (new capability) | SEED for migration engine: Claude/Codex/OpenCode/Cursor/Pi session import |
| 17 | `--ssh` + `ssh_remote.rs` | — (new capability) | SEED for SSH placement: reuse attach semantics, add mausCode device auth |
| 18 | Hooks (`pre_tool` gate) | — (new capability) | SEED for policy engine: mausCode permission policy as managed hooks |
| 19 | Telemetry/analytics | minimal anonymous telemetry | REPLACE 21st analytics with maus policy modeled on JCode's consent versioning |

Non-goals for the seam: JCode TUI crates (never ship), swarm/ambient/overnight/
gmail/selfdev (do not vendor-gate on them; keep compiling, disable by default),
daemon idle-shutdown default (desktop wants explicit lifecycle).

## 18. Module disposition (KEEP / ADAPT / REPLACE / REMOVE)

Module-level verdicts complementing the execution-seam table in §17. Read both
before touching an inherited module. Rule: replace execution authority, keep
product modules; never rewrite a stable module for cleanliness.

| Module | Path | Verdict | Rationale |
|---|---|---|---|
| Git core (status/diff/staging/worktrees/watcher/cache/security) | `src/main/lib/git/` (~25 files) | KEEP then ADAPT | Hardened paths (`security/`, `path-validation.ts`); runtime owns git only after protocol parity |
| Terminal/PTY (manager/session/port/env/history) | `src/main/lib/terminal/` | ADAPT then REPLACE | Good surface; daemon-side PTY arrives with node placements |
| Files router | `src/main/lib/trpc/routers/files.ts` (511) | ADAPT | Becomes protocol file surface; keep local fast path + watcher |
| Projects router | `src/main/lib/trpc/routers/projects.ts` (549) | ADAPT | Workspace-adjacent; maps to workspace model |
| Chats/sessions router | `src/main/lib/trpc/routers/chats.ts` (2196) | ADAPT (heavily) | Session behavior worth preserving; execution authority moves out |
| Claude router | `src/main/lib/trpc/routers/claude.ts` (3230) | REPLACE core, KEEP UX patterns | Execution → harness; keep streaming/approval/plan-mode UX |
| Codex router | `src/main/lib/trpc/routers/codex.ts` (1949) | ADAPT to compatibility adapter | Reference implementation of the adapter interface |
| Claude settings/accounts/Ollama/voice | `claude-code.ts`, `claude-settings.ts`, `anthropic-accounts.ts`, `ollama.ts`, `voice.ts` | ADAPT | Seeds for runtime-level BYOK provider config |
| Commands/skills/plugins/agents routers | `commands.ts`, `skills.ts`, `plugins.ts`, `agents.ts` | KEEP | Runtime-agnostic product modules; same file formats JCode uses |
| Auth (OAuth, auth-manager/store, mcp-auth) | `src/main/auth*`, `src/main/lib/oauth.ts` | REIMPLEMENT | 21st-service-coupled; device-registry auth is a new design |
| Auto-updater | `src/main/lib/auto-updater.ts` | REIMPLEMENT | Feed points at `cdn.21st.dev`; needs maus-owned channel |
| Analytics/Sentry/PostHog | `lib/analytics.ts`, `renderer/lib/analytics.ts` | REMOVE, then re-add deliberately | Needs maus-inc telemetry policy first |
| DB schema (projects/chats/sub_chats) | `src/main/lib/db/schema/` | ADAPT | Sound local-first base; extend toward workspace/device model |
| CLI (`1code` command) | `src/main/lib/cli.ts`, `src/main/lib/platform/` | REIMPLEMENT | Becomes `mauscode` CLI surface |
| Worktree config/naming | `src/main/lib/git/worktree*` | KEEP | Good product behavior, no backend coupling |
| Renderer `features/*` (agents, terminal, changes, kanban, …) | `src/renderer/` | KEEP as reference implementation | No redesign before the native vertical slice works |
| `credential-manager.ts` (821 lines) | `src/main/lib/credential-manager.ts` | REMOVE | Dead: imports nonexistent modules, zero references |
| `mock-api.ts` | `src/renderer/lib/mock-api.ts` | REMOVE | Self-marked DEPRECATED |

## 19. Inherited service coupling points (strip list)

Everything below terminates at 21st infrastructure and must be replaced, not
resurrected. No mausCode behavior may depend on these hosts.

- `src/main/index.ts`: API base `https://21st.dev`, renderer URL, About menu,
  `dev.21st.1code` app id, `1code` PATH installer, `shell.openExternal(21st.dev)`.
- `src/main/windows/main.ts`: window title, trusted origins (`21st.dev`).
- `electron-builder.yml` + `package.json`: appId / productName / artifact names /
  homepage / author.
- `src/main/lib/{config,auth-manager,oauth,mcp-auth,auto-updater,analytics}.ts`:
  service URLs, OAuth, CDN feed (`https://cdn.21st.dev/releases/desktop`), telemetry.
- `src/renderer/lib/{remote-api,remote-trpc,api-fetch}.ts`,
  `features/agents/lib/remote-chat-transport.ts`: hosted-backend assumptions.
- `resources/bin/` (gitignored): release pipeline downloads Claude/Codex binaries via
  `scripts/download-*-binary.mjs`.
- Docs: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `openspec/project.md` still
  describe 21st/1Code. `LICENSE` is Apache-2.0: retain, and preserve upstream
  attribution in any NOTICE/UPSTREAM handling. Never strip it.
