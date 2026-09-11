# Change: add-native-local-execution

## Why

The protocol (`docs/protocol.md` v0) and the client (`packages/runtime-client/`)
exist and are proven against stock JCode, but the application still executes only
through the inherited Claude-SDK and Codex-ACP paths. This change proves the core
architectural claim: the same UI, workspace, and session work unchanged against the
native runtime locally. Everything downstream (BYOK consolidation, SSH/Docker/Daytona
placements, device model) builds on this slice.

## What changes

- New Electron-main runtime host (`src/main/lib/runtime/`): daemon lifecycle
  (spawn/supervise stock vendored JCode `serve`+bridge, socket management, explicit
  app-tied lifecycle with no idle-kill under a running app), harness client wrapper,
  and `ApiEvent→UIMessageChunk` translation so existing renderer code keeps working.
- New additive `runtime` tRPC router: `chat` subscription (input/output-compatible
  with `claude.chat`), `cancel`, approval response, rewind, compact. Existing
  `claude`/`codex` routers are untouched; the renderer opts in per sub-chat via a
  transport flag, enabling side-by-side benchmarking.
- Session mapping: `subChats.sessionId` stores the JCode session id for native
  sessions; resume re-attaches through the daemon (crash-safe, survives window
  reload — unlike the current in-memory maps).
- Provider credentials resolved from existing stores and applied via `set_api_key`
  over the local socket at session start. No tokens in call args (kills the
  `customConfig.token` pattern on the native path).

## Non-goals

- No removal or rewiring of `claude`/`codex` routers (a later change retires them
  once native parity is benchmarked).
- No remote/SSH/Docker/Daytona (placements are follow-up changes on this same host).
- No PTY/git in protocol; no `maus.*` extension implementations (names stay reserved).
- No UI redesign; the renderer change is a transport switch plus a runtime indicator.

## Impact

- Additive under `src/main/lib/runtime/`, one new router, one renderer transport flag.
  Zero behavior change for existing Claude/Codex paths; native path is opt-in.
- Benchmarks required before merge: cold start, first-token, session create/resume,
  RSS idle/loaded vs the Claude path on the same workload.
- Approval requested before implementation (this proposal is the gate).
