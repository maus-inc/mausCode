# Effect adoption for T3-ported layers (2026-09-11)

Provenance: technical decision owned by app-track agent; user approved T3
FULL-ADOPT (Phase 4 contracts + Phase 5 spike) 2026-09-11, which necessarily
includes the Phase 4 substrate (the harvest proposal gated Phase 4 on this
decision explicitly).

## Decision
Adopt `effect` as a dependency ISOLATED to ported T3 layers
(`src/shared/contracts/`, future codex-app-server adapter work). App core
(main, renderer, existing shared) stays zod/tRPC/Drizzle and MUST NOT import
`effect/*` (convention boundary; see `src/shared/contracts/README.md`).

## Facts forcing it
- T3 `packages/contracts` (69 files) uses Effect Schema pervasively (every
  source file); validators ARE the value.
- T3 pins `effect@4.0.0-rc.112` (v4 RC, not stable). Their Schema API usage
  (`Schema.Literals`, `.check()`, `decodeTo`) is v4-shaped; stable v3 is
  incompatible. De-effecting to zod would discard their 23 test files —
  the safety net that makes the port survivable.
- External-import scan of contracts: ONLY `effect/*` (incl.
  `effect/unstable/http*`). Single-dep port.

## Terms
- Pin EXACT `effect@4.0.0-rc.112` (+ `@effect/vitest` same for tests,
  `vitest` per its peer range). No `^`. Phase 5 spike proved transitives
  drift independently: `@effect/platform-node-shared@rc.114` broke against
  `effect@rc.112`, fixed by direct exact pin. ALL `@effect/*` packages
  (incl. `@effect/platform-node[-shared]`, kept as devDeps for the
  codex-app-server port) stay exact-pinned; add npm overrides if a caret
  escapes again.
- Upgrade to v4 stable when released; until then, no other code may depend
  on Effect behavior.
- Port is verbatim except: attribution headers, `vite-plus/test`→`vitest`
  in tests. T3 product identifiers (`t3MintCredential`, `t3.json`,
  `T3ProjectFile`) kept verbatim so ported tests stay faithful; renames
  deferred until scaffolds wire to them (internal only, not user-visible).
- Tests run via `npm run test:contracts` (vitest), separate from the
  node--test runtime suite.
