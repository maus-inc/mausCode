# Competitive capabilities — concepts worth stealing (not architectures)

Sources: JCode upstream docs/code (ce4e789); Hermes docs (hermes-agent.nousresearch.com,
2026-03); T3 docs (github.com/pingdotgg/t3code, 2026-09); OpenCode public architecture
knowledge (client/server over Bun, `opencode serve`, opencode.json); Claude/Codex
behavior as implemented in this repo's routers. OpenChamber: no reliable source found
yet — marked accordingly, not invented.

Format per concept: what / why / current equivalent / runtime-UI-security-perf
implications / placement verdict (native JCode vs application vs compatibility).

## C1. Hermes: terminal backend abstraction (local/docker/ssh/modal/daytona/…)

- What: one `execute()` interface with pluggable placements; per-backend images,
  cpu/mem/disk, `container_persistent` snapshots; SSH persistent shell + ControlMaster;
  `home_mode` (auto/real/profile); `env_passthrough` allowlist; remote→host state sync
  on teardown (content-hash diff applied back in place).
- Why: users keep one workflow while execution moves between laptop, container, remote,
  serverless. Matches the mausCode workspace-placement thesis exactly.
- Current equivalent: none — execution is main-process-local; remote is 21st-only.
- Runtime: the `RuntimeProvider` interface; per-placement session/supervision adapters
  around one JCode node binary. UI: runtime/device picker per workspace (§12 of plan).
- Security: placement = trust boundary; env allowlist (never blocklist); teardown sync
  must be explicit + previewed (Hermes auto-sync-back is too magic for default).
- Perf: persistent shell for SSH (kill per-command handshake); snapshot restore over
  rebuild; local stays a real local process (no container tax by default).
- Verdict: **native** (provider interface + local/SSH first) in runtime; picker UI in
  application. Adopt teardown-sync only as opt-in "bring changes home".

## C2. Hermes: `home_mode` + CLI-auth visibility rule

- What: explicit policy for what HOME (and thus `~/.ssh`, `~/.gitconfig`, CLI logins)
  a sandboxed agent sees; `auto` keeps host CLIs working while container state persists.
- Why: kills the "agent can't push / can't find my login" class of bugs without
  leaking everything.
- Current equivalent: `terminal/env.ts` captures login shell env; no policy object.
- Runtime: part of workspace spawn contract (`runtime/workspace` in protocol).
- Security: high value — makes credential visibility a deliberate per-workspace choice.
- Perf: negligible.
- Verdict: **native** — workspace spawn options in JCode node config.

## C3. T3: `serve` + `connect` + relay + SSH-launch with port forward

- What: headless server on any machine; `npx t3 connect` registers it to the account
  (relay, no router config); desktop-managed SSH launch (probe host, write launcher
  under `~/.t3/ssh-launch/`, start/reuse server, forward loopback port); Tailscale
  HTTPS option; pairing token + QR; troubleshooting taxonomy (link limits, revoked
  bearers, clock skew, relay 403/408/429/5xx).
- Why: the proven "spare Linux box" UX the thesis demands.
- Current equivalent: none (21st hosted only).
- Runtime: `mauscode node` daemon + registry/relay protocol; SSH launcher in app or
  node CLI; Tailscale as documented alternative, not a dependency.
- Security: bearer rotation, link proofs, revocation, clock-skew handling; SSH uses
  existing keys, non-interactive, known-hosts enforced (JCode `--ssh` already refuses
  unknown keys — keep that).
- Perf: relay only for control/events; bulk (files/PTY) prefers direct/WSS; loopback
  forward keeps remote daemon unexposed.
- Verdict: **native**; relay/control-plane in server track; launcher + pairing UI in
  application. This is the single most important concept import after C1.

## C4. OpenCode: `serve` HTTP API + `opencode.json` provider/agent config

- What: server with HTTP API that any client (TUI, IDE, MCP bridge) drives; declarative
  providers/models/agents/skills/MCP in `opencode.jsonc`; `opencode-mcp` bridges expose
  the whole thing as MCP tools to other agents.
- Why: proves the "runtime as a service, UI as a client" split; config-as-file is
  portable and versionable.
- Current equivalent: tRPC-over-IPC (Electron-only); config scattered across SQLite +
  claude JSON + localStorage.
- Runtime: harness-api v1 is already this idea (NDJSON over socket instead of HTTP);
  keep NDJSON for local (framing + streaming efficiency), add HTTP(S)/WSS only at the
  node/relay boundary. Adopt declarative `mauscode.jsonc`/`config.toml` parity with
  JCode's `~/.jcode/config.toml` rather than inventing a third format.
- Security: config file holds no secrets (refs only); credentials via OS store /
  `set_api_key`.
- Perf: NDJSON local avoids HTTP overhead per chunk; file-watch config reload.
- Verdict: **native** (config + protocol posture); HTTP surface only where remote
  demands it. The MCP-bridge inversion (expose mausCode *as* MCP) is a later
  compatibility-layer feature, not MVP.

## C5. Claude Code: plan/agent modes + permission modes + hooks

- What: plan (read-only) vs agent; permission tiers; `pre_tool`/`post_tool`/
  `session_start/end`/`turn_end` hooks (JCode already implements this shape); settings
  sources (project/user).
- Why: the safety UX users already understand; hooks let power users gate without
  forking.
- Current equivalent: `mode` plan/agent end-to-end (atoms → chat input → SDK
  permissionMode); `canUseTool` gate; `settingSources [project,user]`. BUT agent mode
  sets `bypassPermissions` + `allowDangerouslySkipPermissions` — must not survive.
- Runtime: harness permissions + JCode hooks as the enforcement points; mausCode ships
  managed default policy (deny-by-default for destructive/network/exfil classes, allow
  with approval) instead of bypass-by-default.
- Security: the re-audit centers here; every allow rule needs a test.
- Perf: hook exec budget (JCode's `pre_tool_timeout_ms` default 5s is sane).
- Verdict: **native** (policy + hooks in runtime); mode toggle + approval cards stay in
  application UI (already good).

## C6. Claude/Codex/OpenCode: subagents + Task/todo tools

- What: delegated agents with own context (`agents` SDK option, ACP subagents,
  OpenCode `@agent`), `TodoWrite` progress tracking, JCode `swarm`/communicate +
  `todo` tool.
- Why: long-horizon work needs decomposition + visible progress.
- Current equivalent: `buildAgentsOption` from markdown files; sub-chat tabs as poor
  man's parallelism; task snapshot caches in UI (`agent-task-tools`).
- Runtime: JCode `todo` + task-DAG (`TaskGraphNodeSpec` wire type exists) + mode-gated
  spawning; expose task graph events in protocol.
- Security: subagents inherit workspace policy, never broaden it; spawn depth capped.
- Perf: subagent transcripts must not duplicate into parent context (summaries only).
- Verdict: **native** (todo/DAG + bounded spawning); task-list UI in application
  (already started — keep `agent-task-tools`).

## C7. JCode-native: session import (`ResumeTarget` + `import-core`)

- What: typed resume targets + parsers for Claude/Codex/OpenCode/Cursor/Pi sessions;
  convert-then-resume in place.
- Why: the migration thesis made concrete — users arrive with history, not empty state.
- Current equivalent: `sandbox-import` (21st-sandbox → local worktree only).
- Runtime: import runs in runtime (needs file access + parsers); UI shows preview/map.
- Security: imported transcripts are untrusted input (prompt-injection via history);
  mark provenance, never auto-execute imported intents.
- Perf: parse streaming, cap history ingest per session.
- Verdict: **native**; UI flow in application. See `migration-system.md`.

## C8. JCode-native: rewind/undo + compaction + restart snapshots

- What: transcript rewind to message N + undo; summarization compaction with visible
  notice + hidden-prompt accounting; daemon snapshots survive reload/crash.
- Why: "checkpoint" behavior without Git abuse; crash recovery is a trust feature.
- Current equivalent: rollback stash (tree only) + SDK-side compaction (invisible).
- Runtime: expose `rewind/rewind_undo/compact` + `compacted` events; pair tree+transcript
  rewind as one "checkpoint" operation in protocol.
- Security: rewind must not resurrect revoked credentials in context.
- Perf: compaction reduces cache churn; snapshot async + incremental.
- Verdict: **native**.

## C9. JCode-native: soft interrupt + background tools + ambient/overnight

- What: inject-at-safe-point (`soft_interrupt`, urgent flag) vs hard cancel; move
  running tools to background with progress events; scheduled ambient/overnight runners.
- Why: responsive long-running work; the "works while you sleep" story without a cloud
  dependency for local users.
- Current equivalent: queue (renderer-only, dies with window); automations UI (hosted).
- Runtime: adopt soft-interrupt + bg progress wholesale; ambient/overnight stay
  disabled-by-default runtime features until the trust model is proven.
- Security: unattended runners need the two-tier safety policy + review queue before
  any network/human-reaching action — see SAFETY_SYSTEM.md.
- Perf: bg work must not block turn loop; progress events throttled.
- Verdict: **native** (interrupt + bg now; schedulers later behind explicit opt-in).

## C10. T3: multi-account + provider BYOK posture

- What: multiple Claude/Codex accounts; server-side provider config; BYOK-friendly env
  handling.
- Why: users have several identities; the app must not force one.
- Current equivalent: `anthropicAccounts` multi-account + active pointer (good);
  Codex login sessions; `customConfig` per call (leaky — token in call args).
- Runtime: JCode provider catalog + `set/clear_api_key` + per-workspace route;
  credentials referenced, never passed per-message.
- Security: migrate `customConfig.token`-in-args to credential refs immediately;
  per-account scopes; rotation/revocation events.
- Perf: negligible.
- Verdict: **native**; onboarding/account-switcher UI stays in application.

## C11. Hermes Desktop / T3: device + connection management UI

- What: connections list (local/SSH/relay/Tailscale), per-environment status, enable/
  disable routes, launch-from-desktop.
- Why: remote execution is only usable if connection state is legible.
- Current equivalent: none.
- Runtime: node registry + heartbeat + capability discovery (protocol).
- Security: show auth method + last-seen + version per device; one-click revoke.
- Perf: heartbeat cheap (existing `ping/pong`); capability cache with version.
- Verdict: application UI over **native** device protocol. Defer full UI until node
  protocol exists; SSH placement can ship with a minimal picker first.

## C12. OpenCode/Hermes: `doctor` command

- What: `hermes doctor` / provider-doctor checks (Docker present? keys set? SSH vars?
  auth valid?) with clear remediation errors.
- Why: environment setup is where users churn; precise errors retain them.
- Current equivalent: `debug` router (system info, db stats, offline simulation) —
  useful but not user-facing diagnostics.
- Runtime: `mauscode doctor` in node CLI + protocol `runtime_info` enrichment;
  JCode `provider-doctor` reused for provider checks.
- Security: doctor output must redact secrets (shareable diagnostics).
- Perf: checks run concurrently with timeouts.
- Verdict: **native** (CLI + protocol); surfaced in application settings.

## OpenChamber — no finding

No reliable architecture source located (name appears only in the thesis as a
UI-quality bar). Do not cite capabilities. Revisit if the human provides a link.
Recorded so future work doesn't hallucinate it.
