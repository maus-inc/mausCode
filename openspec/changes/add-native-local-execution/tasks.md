# Tasks: add-native-local-execution

## Proposal

- [x] Draft proposal.md, design.md, tasks.md, spec deltas
- [x] Human approves this proposal (gate for implementation) — approved 2026-09-11
- [ ] Run `openspec validate add-native-local-execution --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings
      (CLI unavailable in sandbox 2026-09-11; run in CI/dev)

## Runtime host (`src/main/lib/runtime/`)

- [x] Daemon manager (`manager.ts`): resolve binary (dev: pinned npm platform
      binary; packaged: `resourcesPath/bin/jcode[.exe]` when bundled), lazy
      `launch()` start, `ping` health checks, supervised restart with backoff
      (3 tries), no idle-kill, `shutdown()` on app quit. Injectable paths for
      tests; ESM client via dynamic import (same precedent as the Claude SDK).
- [x] Socket management via the client's launch path; one daemon per app
      instance; stable state dir `{userData}/maus-runtime` so daemon sessions
      survive app restarts (proven by test).
- [x] No separate harness wrapper: `JcodeClient` is used directly
      (requestTimeoutMs 10s, inheritLogins:false; deviations from the draft:
      a wrapper would add an orchestration layer on the hot path for no P1 gain).
- [x] `translate.ts`: `ApiEvent→UIMessageChunk` mapping (text framing, tool
      lifecycle, usage passthrough, error mapping, permission→approval-question
      synthesis, compacted pseudo-tool pair, unknown-event tolerance). 10/10
      unit tests green. `renamed`: ignored (no UI consumer in P1).
- [x] Session map (`sessions.ts`): subChatId ↔ JCode session id, persisted in
      `subChats.sessionId`; stale mappings self-heal by creating fresh.

## Router + renderer (additive)

- [x] New `runtime` router (`routers/runtime.ts`): `chat` (contract-compatible
      with `claude.chat`), `cancel`, `isActive`, `respondApproval`, `rewind`,
      `compact`, `status`. Legacy routers untouched. Plan mode refused with a
      clear error (no read-only enforcement yet).
- [x] Credential resolution (`credentials.ts`) from existing stores →
      `set_api_key` at turn start (stored Anthropic OAuth token; env-inherited
      keys; per-call custom token). Custom `baseUrl` refused with a typed,
      honest error. Secrets never in args/logs/transcripts (see Verification).
- [x] Renderer transport flag per sub-chat (`subChatEngineAtomFamily`,
      persisted, Legacy default) + engine toggle in the input row (Native
      opt-in on empty local claude-code chats only; duplicated tabs inherit).
      Selection order: remote → codex → native → legacy.
- [ ] Approval cards wired to `permission_request/response` (deny-by-default
      policy) — ROUTING DONE (`approval-routing.ts` routes `native:`-prefixed
      answers to `runtime.respondApproval`; translator synthesizes the
      question UI), but DORMANT: the stock bridge advertises no `permissions`
      capability and never issues `permission_request`. Live end-to-end
      approval waits on the mausCode runtime patch; verify then, do not fake it.

## Verification

- [ ] Benchmarks vs Claude path: cold start, first-token, create/resume, RSS
      idle/loaded — recorded in `.dump/app/benchmarks/`, regressions block.
      CI-owned (sandbox has node only, no bun/Electron run). Gate stays CLOSED.
- [ ] Crash/recovery test: kill daemon mid-session, re-attach, transcript
      intact. (Supervised restart implemented; live kill test needs CI/dev.)
- [x] Secret audit (static, 2026-09-11): native path passes no token in argv
      (env inherit, same exposure as legacy) or logs; `set_api_key` values
      stay in the credentials module's narrow scope; router inputs carry no
      secrets (custom token rides the existing tRPC channel only when the user
      configured one, same as legacy customConfig). Runtime re-audit when the
      permissions patch lands. Full dynamic audit needs CI/Electron run.
- [x] Full `runtime-client` check + live tests green (43/43 in P0; P1 adds
      13/13: translator 10, manager 3 incl. cross-restart persistence).
- [x] Update second-brain + task states; no other `.dump` file needs this
      change's detail (link, don't duplicate)
