# Ported T3 codex-app-server client (Effect-isolated layer)

Source: `pingdotgg/t3code` `packages/effect-codex-app-server` @ `211618f`
(MIT, (c) 2026 T3 Tools Inc.), fetched to `refs/harvest/t3code`. Ported
verbatim except attribution headers.

## Boundary rules (same as contracts)
- ONLY `src/shared/contracts/` and this directory may import `effect/*`.
  See `.dump/app/decisions/effect-adoption-t3-layers-2026-09-11.md`.
- Upstream protocol schema is generated @ `678157ac` (2026-07-19). A regen
  against current upstream was attempted 2026-09-11 and failed (generator
  shims are July-specific; new `$ref` shapes unsupported). The client
  tolerates unknown server methods (`handleUnknownServer*`), so drift is
  absorbed. To regen in the future: copy `scripts/generate.ts` from
  upstream, `npm i -D @effect/openapi-generator@<matching-rc>`, fix the
  ref-rewriting for new constructs.
- `scripts/generate.ts` is deliberately NOT ported (it cannot typecheck
  without the generator dep and cannot run behind this sandbox's network).

## mausCode adapter (NOT verbatim port)
- `session.ts` — promise-based sessions over the ported client: one `codex
  app-server` child per chat, thread start/resume (+legacy session-id lookup
  via `thread/list`), `turn/start` with auto approval handlers, app-server
  events translated to AI-SDK UIMessageStream chunks, `turn/interrupt` cancel.
- `session.test.ts` + `test/fixtures/codex-app-server-turn-mock-peer.ts` —
  full turn lifecycle over real stdio (chunks, legacy resume, interrupt).

## Tests
`npx vitest run src/main/lib/codex-app-server` (6 files, 39 tests, incl. live
stdio mock-peer round-trips).
