# Tasks: add-native-local-execution

## Proposal

- [x] Draft proposal.md, design.md, tasks.md, spec deltas
- [ ] Human approves this proposal (gate for implementation)
- [ ] Run `openspec validate add-native-local-execution --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Runtime host (`src/main/lib/runtime/`)

- [ ] Daemon manager: resolve vendored binary (dev: `cargo run`?/pinned npm binary;
      packaged: bundled runtime), spawn `serve`+bridge, health-check via `ping`,
      supervise (restart on crash with backoff), shutdown on app quit
- [ ] Socket management via shared path rules; one daemon per app instance
- [ ] Harness client wrapper over `@maus-inc/runtime-client` with request timeouts
- [ ] `translate.ts`: `ApiEvent→UIMessageChunk` mapping (text/reasoning deltas, tool
      lifecycle, usage, errors, permission requests, compacted/renamed)
- [ ] Session map: subChatId ↔ JCode session id, persisted in `subChats.sessionId`

## Router + renderer (additive)

- [ ] New `runtime` router: `chat` (input/output-compatible with `claude.chat`),
      `cancel`, `respondApproval`, `rewind`, `compact`
- [ ] Credential resolution from existing stores → `set_api_key` at session start
- [ ] Renderer transport flag per sub-chat (native vs legacy) + runtime indicator
- [ ] Approval cards wired to `permission_request/response` (deny-by-default policy)

## Verification

- [ ] Benchmarks vs Claude path: cold start, first-token, create/resume, RSS
      idle/loaded — recorded in `.dump/app/benchmarks/`, regressions block
- [ ] Crash/recovery test: kill daemon mid-session, re-attach, transcript intact
- [ ] Secret audit: no token in args/logs/transcripts on the native path
- [ ] Full `runtime-client` check + live tests green in CI
- [ ] Update second-brain + task states; no other `.dump` file needs this change's
      detail (link, don't duplicate)
