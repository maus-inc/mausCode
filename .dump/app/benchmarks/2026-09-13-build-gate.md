# Build gate reference run (roadmap step 03)

Date: 2026-09-14, 12:01 to 12:10 UTC. Branch: `arena/01a09fc7-mauscode` at
`bb92033`, base `arena/01a097c4-mauscode`. Step file:
`.dump/app/roadmap/03-build-gate.md`. Issue: #5.

## Conclusions

1. The full sequence is install, `build:runtime-client`, `build` with the CI
   heap flag, the seven gate commands, the two binary downloads, packaging,
   and one launch. On this sandbox everything up to and including the seven
   gates ran and passed. The renderer bundle, both binary downloads,
   packaging and the launch test are recorded below as environment failures
   with the exact evidence, because the machine has 3.8 GB of RAM and the
   proxy blocks the hosts that serve the electron dist, the native headers
   and the agent binaries. The CI jobs on the step 03 PR are the reference
   run for those parts, recorded in the CI reference run section below.
2. The renderer build needs more RAM than this machine has, with or without
   the CI flag. The default heap aborts V8 at 42 s, and the 4 GB flag
   kernel-OOMs the process at 56 s. The recorded "OOM below about 3 GB heap"
   fact in `.dump/ci/second-brain.md` is confirmed locally as an environment
   fact, not a code defect: main and preload build identically clean in both
   runs, and the tree passes every gate that can run here.
3. The 2026-09-11 host list in `.dump/ci/second-brain.md` is stale on one
   point: GitHub release assets now resolve to
   `release-assets.githubusercontent.com`, which is blocked exactly like the
   `objects.githubusercontent.com` host it replaced. Correcting that file is
   the CI domain to do, so it is noted here instead.

## Environment

| Item | Value |
| --- | --- |
| Machine | Arena sandbox, Debian 12 bookworm, kernel 6.1.158+ |
| CPU / RAM / swap | 2 cores / 3.8 GiB total, 3.6 GiB available at start / 0 B |
| Disk | 21 GB, 20 GB free |
| Node / npm | v22.22.3 / 10.9.8 |
| bun | 1.4.2, installed with `npm install -g bun@1.4.2` because bun.sh is blocked |
| V8 default old-space limit | 1.91 GB, measured with `v8.getHeapStatistics()` |
| Display stack | none: 0 X11/GTK/NSS libraries in `ldconfig`, no Xvfb, apt unreachable |
| Network | MITM TLS proxy; its CA (`/usr/local/share/ca-certificates/e2b-ca.crt`) is in the system store, not in node's bundled CAs |

## Network probes, this machine, 2026-09-14

| Host | Probe | Result |
| --- | --- | --- |
| registry.npmjs.org | `curl -I`, `npm ping` | 200; PONG 72 ms |
| github.com | `curl -I` | 200 |
| codeload.github.com | GET electron v39.4.0 source tarball | 200, 17,002,642 bytes |
| api.github.com | `gh` reads and writes | works |
| release-assets.githubusercontent.com | GET electron v39.4.0 linux-x64 dist zip, redirect followed, curl and node | connection reset, 0 bytes |
| storage.googleapis.com | `curl -I` | unreachable (000) |
| www.electronjs.org | `curl -I`, node-gyp headers fetch | unreachable (000); ECONNRESET from node-gyp |
| nodejs.org | GET v22.14.0 headers tarball | unreachable (000) |
| deb.debian.org | `curl -I` bookworm Release | unreachable (000) |
| bun.sh | `curl -I` | unreachable (000) |
| cdn.npmmirror.com | GET electron dist zip path | unreachable (000) |
| mirrors.tuna.tsinghua.edu.cn | GET electron dist zip paths, two forms | unreachable (000) |
| TLS, node without extra CA | `https.get` to github.com | UNABLE_TO_VERIFY_LEAF_SIGNATURE |
| TLS, node with `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` | same probe | github.com hop verifies, fails later at the blocked asset host |

The CA fix is an environment variable in this session only. Nothing
committed uses it, per the rule that sandbox workarounds never land in
committed config.

## Commands and results

### Install

```sh
bun install --frozen-lockfile --ignore-scripts
```

Result: 1169 packages in 5.94 s, exit 0, `bun.lock` unchanged
(`git status` clean). This is the same form the CI quality, build and
security jobs use. The scripts-enabled form is not runnable here by
construction: the root `postinstall` runs `electron-rebuild`, which fetches
headers from www.electronjs.org, and the `electron` package `postinstall`
fetches the dist zip from the blocked asset host. Both failures are
reproduced and quoted below.

### build:runtime-client

```sh
bun run build:runtime-client
```

Result: exit 0 in about 1 s, both as a standalone run and inside the
`bun run build` prebuild hook.

### Build, with the CI flag

```sh
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

| Target | Emitted | Size | Modules | Vite wall time |
| --- | --- | --- | --- | --- |
| main | `out/main/index.js` | 2,869.39 kB | 303 | 3.05 s |
| preload | `out/preload/index.js` | 12.48 kB | 2 | 25 ms |
| renderer | none | not emitted | transform in progress | SIGKILL about 56 s into the transform |

The renderer process was killed by the kernel OOM killer, not by V8: the
signal is SIGKILL and the machine has 3.8 GB of RAM against a 4 GB heap
limit plus OS and tooling overhead. Two `vite:reporter` notices print as in
CI, on `local-only.ts` and `analytics.ts` dynamic plus static import
splits; informational, pre-existing.

### Build, without the flag, recorded as an environment fact

```sh
bun run build
```

Default heap 1.91 GB. Result: main 2,869.39 kB in 2.53 s and preload
12.48 kB in 26 ms, identical to the flagged run, then the renderer aborts:

- exit code 134, SIGABRT, wall 42 s
- `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`
- final mark-compact: 1903.4 (1942.2) -> 1902.8 (1939.5) MB, flat
- machine memory sampler at 4 s: usage climbed 260 MB to 2586 MB and held

This is the OOM the step asks to be recorded as an environment fact rather
than a defect, and the difference between the two runs is the ceiling, not
the tree.

### Gates, all seven run here, all exit 0

Same `NODE_OPTIONS=--max-old-space-size=4096` cap as the CI workflow-level
env, which is a ceiling rather than an allocation.

| Gate | Command | Result | Wall |
| --- | --- | --- | --- |
| biome | `bun x biome check .` | 861 files checked, 0 findings, no fixes applied | 2 s |
| typecheck | `npm run typecheck` | `tsc --noEmit`, 0 errors | 36 s |
| vitest | `npm run test` | 54 test files, 618 tests, 618 passed | 19.07 s |
| node:test | `npm run test:node` | 27 tests, 27 passed, 0 failed | 37.4 s |
| contracts | `npm run test:contracts` | 23 test files, 382 tests, 382 passed | 7.51 s |
| lint-changed | `node scripts/ci/lint-changed.mjs` | no merge base with origin/main, the documented independent-roots fallback, so 955 files in scope, 806 lintable checked, 0 findings | 3 s |
| ratchet | `node scripts/ci/typecheck-ratchet.mjs` | 0 errors <= 0 baseline | 39 s |

### Downloads, both blocked, evidence quoted

```sh
bun run claude:download   # pin 2.1.45
bun run codex:download    # pin 0.137.0
```

- claude: `Failed to fetch manifest: Client network socket disconnected
  before secure TLS connection was established` against
  `storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/2.1.45/manifest.json`
- codex: `ECONNRESET`, `host: 'release-assets.githubusercontent.com'`, for
  `codex-x86_64-unknown-linux-musl.tar.gz` at 83.8 MB expected

### Packaging, not runnable here, evidence quoted

```sh
bunx electron-builder --dir
node node_modules/electron/install.js
```

- electron-builder 25.1.8 loaded the `build` field of `package.json`, then
  its first network step failed: `@electron/rebuild` for better-sqlite3
  fetched `https://www.electronjs.org/headers/v39.4.0/node-v39.4.0-headers.tar.gz`
  and got `ECONNRESET`, host `www.electronjs.org`, ending in
  `node-gyp failed to rebuild '/home/user/mausCode/node_modules/better-sqlite3'`
- `electron/install.js` (the same download electron-builder would need next
  for the dist zip) failed through `got` with `Client network socket
  disconnected before secure TLS connection was established`

The CI `package` job (ubuntu-24.04, full install, both downloads,
`bunx electron-builder --dir`, unsigned) is the artifact reference for this
step. That job log names the unpacked directory but does not print its byte
size, so the artifact size is recorded as CI-only and not measured here.

### Launch, not runnable here, evidence quoted

The sandbox has no X server, no Xvfb, no reachable apt, and zero X11, GTK
and NSS shared libraries in `ldconfig`. Even a downloaded electron binary
cannot open a window here. The acceptance check "app starts with no control
plane configured and no key, and the local-only path is what you saw" is
reported as not run, with this probe as the reason, rather than as green.

## Acceptance criteria, mapped

| Criterion | Status |
| --- | --- |
| `bun run build` exits 0 with the heap flag; the failure without it is an environment fact | Not on this machine, kernel OOM at the 4 GB ceiling on 3.8 GB of RAM. The no-flag abort is recorded above. The CI build job on the step 03 PR is the reference exit-0 run |
| All five gates report passed with counts | Passed here with counts, plus the two CI scripts |
| One unsigned artifact exists and its size is recorded | Not produced here, blocked as quoted. The CI package job produces it; its log does not print the byte size, so that number stays unmeasured until a later step adds a size line to the job |
| The app starts with no key and the local-only path is what you saw | Not run, no display stack, probe above |
| The benchmark file exists and every number in it came from that run | This file; all numbers are from the 2026-09-14 12:01-12:10 UTC run on `bb92033` |

## CI reference run

Run 34845477896 on PR #53, created 2026-09-14 12:48 UTC on the
`pull_request` event at `3e39245`, read from the `gh` API from this
sandbox:

| Job | Result | Wall |
| --- | --- | --- |
| Quality gates (lint, test, typecheck) | pass | 2m 01s |
| Build (ubuntu-24.04) | pass | 1m 33s |
| Build (windows-2022) | pass | 3m 09s |
| Build (macos-14) | pass | 4m 05s |
| Package (ubuntu-24.04, unsigned) | pass | 2m 45s |
| Package (macos-14, unsigned) | pass | 4m 53s |
| Security gates | fail | 18 s |

This is the reference for the renderer bundle (all three build jobs exit
0), the unsigned artifact (both package jobs complete the full install,
both binary downloads and `electron-builder --dir`) and the install with
scripts on a machine that can reach the blocked hosts. The Security gates
failure carries one error annotation, on the gitleaks step only. It is the
failure recorded in
`.dump/ci/audits/2026-09-14-gitleaks-inherited-findings.md`, which fails
identically on the base branch (run 34831545902). This diff adds no
secret-shaped string and touches none of the four recorded finding
locations. Fixing that gate is a gate-semantics change owned by a later
step, so this one records it rather than widening it.

The per-target bundle bytes sit in the build jobs' "Report bundle sizes"
step and the unpacked artifact names in the package jobs' electron-builder
output. The job log host
(`results-receiver.actions.githubusercontent.com`) is unreachable from this
sandbox, a fact recorded 2026-09-11, so those numbers are readable from the
run by anyone who can open the logs and are not re-typed here.

## Consequence for later steps

Steps 30 onward measure against this run. The local reference for install,
both fast bundles and all seven gates exists at the numbers above. The
reference for the renderer bundle, the unsigned artifact and the launch
check is the CI reference run section above.
A step that claims any of those green without the CI citation has not run
them.
