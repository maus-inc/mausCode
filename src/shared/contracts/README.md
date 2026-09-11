# Ported T3 contracts (Effect-isolated layer)

Source: `pingdotgg/t3code` `packages/contracts` @ `211618f` (MIT,
(c) 2026 T3 Tools Inc.), fetched to `refs/harvest/t3code`. Ported verbatim
except attribution headers + `vite-plus/test` → `vitest` in tests.

## Boundary rules
- ONLY this directory (and future T3-adapter ports) may import `effect/*`.
  App core (main, renderer, other shared) stays zod/tRPC/Drizzle.
- `effect` is pinned EXACT (`4.0.0-rc.112`, a v4 RC): T3's Schema API usage
  is v4-shaped and incompatible with stable v3. Upgrade to v4 stable on
  release. See `.dump/app/decisions/effect-adoption-t3-layers-2026-09-11.md`.
- T3 product identifiers (`t3MintCredential`, `t3.json`, `T3ProjectFile`)
  are kept verbatim so the ported tests stay faithful. Rename only when a
  mausCode scaffold wires to them (internal-only, never user-visible).

## Running tests
`npm run test:contracts` (vitest; 23 ported test files). Separate from the
`node --test` runtime suite.
