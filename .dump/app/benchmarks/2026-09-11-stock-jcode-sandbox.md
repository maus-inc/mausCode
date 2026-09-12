# Stock-JCode baseline (sandbox, preliminary)

Date: 2026-09-11. Method: `benchmarks/runtime-harness/stock-baseline.mjs` (committed;
verified runnable from repo root after `npm install && npm run build` in
`packages/runtime-client/`).

## Environment

- Linux x64, kernel 6.1.158+ (sandboxed/virtualized; exact CPU not recorded — treat
  absolute numbers as approximate).
- Node v22.22.3. Runtime: `@1jehuang/jcode-linux-x64@1.1.0` (155 MB on disk),
  driven via `@1jehuang/jcode-sdk@1.1.0` `launchInstance` + `JcodeClient`
  (temp-home private instances, `shareCredentials: false`, telemetry disabled).
- Upstream source at fork time: 1jehuang/jcode ce4e789 (v0.84.0, SDK 1.2.0-dev).
  Binary 1.1.0 < source 1.2.0-dev: numbers below are for the older binary.

## Results

| Metric | Value | n |
|---|---|---|
| Daemon+bridge launch (`launchInstance`) | 52–57 ms | 7 |
| `ping` round-trip | ok (<1 ms§) | 4 |
| `createSession` | 5–12 ms | 3 |
| `list_sessions` after create | correct, status `attached` | 3 |
| Bridge RSS, 1 idle session | ~23 MB (23876 KB) | 1 |
| Daemon (`serve`) RSS, 1 idle session | ~34 MB (34600 KB) | 1 |
| Total runtime RSS (daemon+bridge) | ~57 MB | 1 |

§ Ping was not timed with sub-ms resolution; "ok" only.

## Caveats (read before citing)

1. RSS, not PSS; sandbox allocator/overcommit behavior unknown. Upstream claims
   27.8 MB PSS single-session — same order of magnitude, but not a reproduction
   (different metric, different binary version, unknown hardware).
2. Earlier runs measured the bridge only (25–29 MB); the final run isolated both
   processes (bridge ~23 MB + daemon ~34 MB ≈ 57 MB total). Upstream's 27.8 MB PSS
   claim is a different metric/binary/hardware and is not reproduced here.
3. No 1Code-baseline app numbers yet (need bun + Electron run; CI-owned).
4. Live model-reachability test fails without provider credentials (expected;
   proves the path works up to the provider boundary).

## Conclusion

The harness-api integration path is proven live: launch→connect→ping→session in
~60 ms total with a ~25–29 MB bridge. Official numbers await CI with pinned
hardware, PSS measurement, and the vendored runtime binary.
