# mausCode product thesis — extracted from source of truth

Source: `new mauscode branding/original chat context leading to creation.md` (2167 lines,
full conversation assimilated 2026-09-11). This file is the compressed, decision-oriented
record. The full history lives in the source document; nothing here replaces it.

## Original motivations

- 1Code (archived 2026-07-07, Apache-2.0) has a product surface that would take months
  to rebuild: Cursor-like UI, Claude Code/Codex orchestration, BYOK, worktrees,
  background execution, previews, Git/PR handling, MCP/plugins, queueing, plan mode,
  sub-agents, voice, PWA.
- JCode (Rust, MIT, github.com/1jehuang/jcode) is unusually fast and cache-efficient,
  with an existing `serve`/`connect` daemon model, multi-session workflows,
  OpenAI-compatible endpoints, and published low-memory measurements.
- The human wants one beautiful BYOK setup that is super performant, plus migration
  from existing tools (Hermes, OpenCode, Claude, Cursor, Codex) and pluggable execution
  (local, Docker, Daytona, remote device — T3 Code style).

## Product direction (decided)

- Product name: **mausCode**. Company: **maus-inc**.
- mausCode is a **new full-stack agent application**, not a rebranded 1Code.
  - 1Code codebase = inherited **product/UI foundation**.
  - JCode = inherited **runtime foundation**, to be deeply refined, integrated, and
    evolved into the native mausCode managed runtime.
- Canonical rule: **JCode is the product's native runtime. Everything else is an adapter.**
- Native execution ultimately powered by the refined mausCode/JCode runtime across:
  local, SSH, Docker, Daytona, remote machines running the runtime, future providers.
- Claude Code / Codex / OpenCode / Hermes = **secondary, optional compatibility
  runtimes**. The native experience must not depend on them.
- Steal good *ideas* (not implementations) from OpenCode, Hermes agent+desktop,
  OpenChamber-style products: session architecture, subagents, permissions, MCP,
  skills, context management, persistent sessions, background work, queues.
- Target: better UI than OpenChamber-class tools, far faster runtime with far lower
  memory than OpenCode.

## Architecture ideas (decided)

- Vertical seam, never a merge:
  `app/ (1Code-derived UI)` | `runtime/jcode` | `protocol/ (new stable contract)` |
  `server/control-plane` | `integrations/` (adapters).
- UI talks to a **versioned runtime protocol**, never to JCode internals. JCode never
  learns about React. Protocol carries hello/capabilities/workspace/session/message/
  tool/approval/terminal/filesystem/git/process/preview/error/heartbeat; no
  UI-specific structures inside it.
- Runtime abstraction: `RuntimeProvider` with `LocalJCode / RemoteJCode / SSHJCode /
  DockerJCode / DaytonaJCode` — five ways to *place* one runtime, not five agents.
- `mauscode node`: small daemon for the spare-box story
  (register/authenticate/heartbeat/receive workspace/spawn JCode/stream/reconnect/update).
- Control plane hosts only coordination (auth, devices, workspace/session metadata,
  relay, secrets metadata, sync). Computation stays on JCode nodes.
- BYOK is runtime-level (`ProviderConfig`: provider/model/endpoint/credential_ref/
  capabilities). Full app usable without surrendering an LLM key to maus-inc.
- Workspace model independent of agent: repository/runtime/sessions/environment/git/
  provider/MCP/skills/instructions/metadata.
- JCode must remain usable standalone (`serve`, `connect`, `run`); the app consumes
  JCode, it does not define JCode.

## Rejected ideas

- "Just fork 1Code and rebrand" — rejected; new platform identity required.
- "JCode as another optional adapter next to Claude/Codex" — explicitly rejected by
  the human; JCode is the default backend.
- Merging 1Code + JCode into one coupled tree — rejected ("that's the trap").
- Recreating Claude Code/OpenCode inside JCode — rejected; JCode stays a small
  universal execution/orchestration runtime (workspace lifecycle, permissions, PTY,
  filesystem, git/worktrees, supervision, streaming events, provider config, adapters).
- Resurrecting 21st backend/service assumptions — rejected; strip them completely.
- Blindly inheriting 1Code's permission model — rejected; re-audit from scratch
  (documented critical `allowDangerouslySkipPermissions` bypass history, issue #104).
- Giant JS orchestration layer on the hot path (React state → Node middleware →
  transforms → event bus → JCode) — rejected; keep the hot path thin.
- Redesigning every screen before a vertical slice works — rejected; get
  `1Code UI → protocol → JCode` working first, then redesign incrementally.

## Performance goals (decided)

- Sacred rule (for CONTRIBUTING.md): no feature may materially degrade runtime
  performance, memory, rendering, startup, or existing UI behavior without an explicit
  benchmark and architectural justification.
- Preserve JCode's hot-path measurements as benchmarks to *reproduce*, not promises
  to preserve blindly; establish `benchmarks/` and make regressions CI-visible.
- Benchmark matrix: cold/warm startup, first response, first tool call, session
  create/resume, terminal startup, fs ops, event throughput, memory idle + per-session,
  CPU idle + per-session, remote latency — at 1/5/10/25/50 sessions.
- UI discipline (from T3 guidance): minimal websocket payloads, no gratuitous
  animations, virtualized lists, lazy panels, no raw tool-output walls, stable
  scrolling, keyboard-first.

## UI expectations

- Keep 1Code's proven UI/interaction modules intact and performant; surgical changes.
- Tool activity as structured components (collapsible cards), never giant textual
  tool dumps.
- After vertical slice: build `mauscode-ui` design system (primitives, tokens,
  command palette, session, tool-cards, diff, terminal, file-tree, runtime/device
  pickers).

## Runtime expectations

- Managed runtime: agent sessions, PTY/terminal, filesystem, process lifecycle,
  git/worktrees, context/state, tools, MCP, skills, permissions, model/provider
  routing, workspace lifecycle, checkpoints/resume, streaming events.
- Graceful behaviors: cancellation, reconnect, crash recovery, session/log
  persistence, filesystem watching, resource limits, graceful shutdown.
- Transport-agnostic remote execution; device as first-class concept with identity,
  capabilities, heartbeat, remote revoke/update.

## Migration expectations

- `Import environment`: detect Claude/Codex/OpenCode/Hermes/Cursor/Cline/Roo configs,
  MCP servers, skills, rules, hooks, AGENTS.md/CLAUDE.md, git identity, providers.
- Flow is always **Detect → Preview → Map → Confirm → Import**; never silently mutate.
- Killer onboarding: "Claude Code detected — Skills 14, MCP 6, Rules 3 — [Import]".

## BYOK expectations

- First-class provider abstraction (OpenAI, Anthropic, OpenRouter, Google, Groq,
  Mistral, DeepSeek, local/OpenAI-compatible, custom endpoint).
- Keys encrypted at rest, never logged/telemetered, redacted from errors; local-only
  mode; credential forwarding to remote runtimes; rotation/deletion/scopes.

## Remote execution expectations

- Order: local → SSH → Docker → remote JCode node → Daytona → generic provider
  interface. Daytona must not become a special snowflake.
- `mauscode node start` + `npx <...>/mauscode connect`-style onboarding for devices.
- MVP proof: same UI/workspace/session against local JCode, then remote JCode, with
  zero application-behavior change.

## Decisions already made

1. JCode = default/native runtime; others = optional adapters.
2. BYOK first-class; users own credentials; local execution works without an account.
3. Hosted control plane optional; JCode node independent of UI.
4. UI never knows whether execution is local/SSH/Docker/Daytona/remote.
5. Stable workspace protocol independent of runtime.
6. Freeze both upstream baselines (exact SHAs) before building; 1Code is read-only.
7. Strip 21st branding/services; new product identity; preserve Apache-2.0 notices.
8. Security/permissions re-audited from scratch before remote beta.
9. MVP-0 = UI → JCode → local workspace → BYOK → session → files → terminal → diff.
10. Docs committed early: vision, architecture, protocol, runtime, devices, providers,
    agents, migration, security, deployment, roadmap — with `protocol.md` as source
    of truth.

## Decisions explicitly left open

- Exact new repo/organization layout and package naming.
- Protocol versioning/transport details (NDJSON vs other; auth story for nodes).
- Which 1Code backend modules are KEEP vs ADAPT vs REPLACE — inventory required.
- Device auth/relay mechanism specifics.
- Free-tier hosted architecture specifics.
- Release/signing/CDN infrastructure choices.
- Branding assets: final logo/wordmark selection from `new mauscode branding/`.
- Telemetry policy contents (what is collected, opt-in/out defaults).
