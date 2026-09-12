# UPSTREAM — packages/runtime-client

- Source: `sdk/typescript/` from https://github.com/1jehuang/jcode
- Upstream commit: ce4e789 (JCode v0.84.0; SDK sources at 1.2.0-dev)
- Upstream license: MIT, Copyright (c) 2025 Jeremy Huang — preserved verbatim in
  `LICENSE`. Never remove or alter that file.
- Fork date: 2026-09-11. Fork version: 0.1.0 (mausCode versioning, independent).

## What changed from upstream (patch list)

1. `package.json`: renamed to `@maus-inc/runtime-client`, private, version reset.
   Optional platform binaries pinned to published `@1jehuang/jcode-*@1.1.0` (latest
   published at fork time; upstream source was ahead at 1.2.0-dev).
2. Added `test:live` script + `test/run-live.mjs` wrapper (resolves the bundled
   platform binary; upstream's live script defaults to `jcode` on PATH).
3. `test/schema-parity.test.ts`, `test/error-docs.test.ts`: Rust source path is
   overridable via `JCODE_HARNESS_API_SRC`, defaulting to the future vendor location
   `runtime/jcode/crates/jcode-harness-api/src` (upstream hardcodes a monorepo
   parent that does not exist here).
4. `README.md` rewritten for mausCode + required Error-codes section (enforced by
   `error-docs.test.ts`; 20 codes).
5. Restored upstream `dependencies` (`ajv`) in `package.json`.
6. Added this file.

`src/*`, `test/*`, `tsconfig.json` are byte-identical to upstream at the fork commit
except as noted above. Future upstream syncs: diff, record here, re-run `npm run
check` + live proof.

## mausCode direction for this package

- Keep wire parity with harness-api v1 (schema-parity tests must stay green).
- `maus.*` extension request builders will be added in a follow-up change once
  `docs/protocol.md` defines their payloads. No extension code exists yet.
- Long term: platform binaries become mausCode runtime builds; the `@1jehuang`
  optional deps are a bridge, not the destination.
