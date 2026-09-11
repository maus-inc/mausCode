# benchmarks/

Runnable performance harnesses for mausCode. Method first, numbers second: every
result recorded under `.dump/app/benchmarks/` must state hardware, OS, versions,
method, sample size, and caveats. No "faster/lighter" claims without a run.

## Suites

- `runtime-harness/` — stock-JCode baseline via `@maus-inc/runtime-client`:
  daemon+bridge launch latency, ping, session create/list/attach, idle RSS of
  runtime processes. Needs only node + the package's pinned platform binary.

## Running

```bash
cd packages/runtime-client && npm install && npm run build && cd ../..
node benchmarks/runtime-harness/stock-baseline.mjs
```

Results go to `.dump/app/benchmarks/<date>-<subject>.md`, never into this directory.
