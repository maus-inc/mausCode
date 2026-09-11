# @maus-inc/runtime-client

Harness-api v1 NDJSON client connecting the mausCode application to the native
runtime daemon. Forked from `@1jehuang/jcode-sdk` — see `UPSTREAM.md` for source,
license, and the patch list.

## Use

```ts
import { launchInstance, JcodeClient } from "@maus-inc/runtime-client"

const inst = await launchInstance() // private daemon+bridge, temp home
const client = await JcodeClient.connect({
  socketPath: inst.socketPath,
  clientName: "mauscode/0.1",
})
await client.ping()
const sessions = await client.listSessions()
// ... client.close(); await inst.shutdown();
```

Live proof against stock JCode (2026-09-11, sandbox): launch 53–57 ms,
createSession 5 ms, `ping`/`list_sessions` green. Method and numbers:
`.dump/app/benchmarks/2026-09-11-stock-jcode-sandbox.md`.

## Verify

```bash
cd packages/runtime-client
npm install          # devDeps (typescript, @types/node) + pinned platform binary
npm run check        # typecheck + unit tests (mock harness, no binary needed)
npm run test:live    # live launch against the pinned platform binary
```

## Boundaries

- Wire parity with harness-api v1 is mandatory (`schema-parity.test.ts` guards it).
- No `maus.*` extensions here yet — payloads are undefined until `docs/protocol.md`
  says otherwise.
- Socket paths, env vars (`JCODE_*`), and protocol strings stay upstream-compatible;
  only the npm package identity is maus-owned.

## Error codes

Stable SDK and server error codes (`` `code` ``). This list is enforced by
`test/error-docs.test.ts` — every code below must appear here in backticks.

- `concurrent_next`
- `connect_failed`
- `disconnected`
- `event_buffer_overflow`
- `handshake_failed`
- `internal`
- `invalid_instance_home`
- `invalid_option`
- `invalid_request`
- `jcode_not_found`
- `startup_failed`
- `startup_timeout`
- `structured_output_invalid`
- `structured_schema_invalid`
- `timeout`
- `unexpected_reply`
- `unknown_request`
- `unknown_session`
- `unsupported_transport`
- `unsupported_version`
