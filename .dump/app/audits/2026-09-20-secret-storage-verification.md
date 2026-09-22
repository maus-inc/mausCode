# Secret storage verification

## Status

Implementation is complete on the session branch and verified by the static gates and test suites below. Two gates cannot run in this sandbox and are left to CI: the renderer bundle and packaging. The application was never driven on a desktop here, so nothing below claims UI or UX verification.

Investigated base `8a77cb2a70d9f6a55bea9d822ef87b6641f2d79b`. Session branch `arena/01a0c098-mauscode`. The human selected a dedicated Credential storage settings page and approved keeping existing reads while gating writes.

## Completed checks

| Command or probe | Result | Scope |
| --- | --- | --- |
| `NODE_OPTIONS=--max-old-space-size=4096 npm exec --yes --package=bun@1.4.2 -- bun install --frozen-lockfile --ignore-scripts` | Passed, 1169 packages installed | Existing locked dependencies only. Scripts skipped, so this does not verify native modules |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run build:runtime-client` | Passed | Baseline workspace build |
| `NODE_OPTIONS=--max-old-space-size=4096 npm run typecheck` | Passed | Baseline typecheck with no application edits |
| `git diff --exit-code -- package.json bun.lock` | Passed | No dependency declaration or lockfile edits |
| Existing token-crypto module executed through esbuild and a fake Electron implementation | Reproduced two defects | E3 mock execution, not OS crypto. Legacy base64 plaintext throws after availability changes to true. Ciphertext returns as decoded text after availability changes to false |
| Local HTML parser and `node --check` | Passed | Unique ids, explicit button types, local font files, no external scripts, and valid JavaScript in the prototype |
| Biome on prototype HTML, browser probe, and results JSON | Passed after fixes | Corrected an unsupported aria-label on a generic div, stylesheet specificity, unnecessary important, and a template-literal lint finding. No rule was suppressed |
| `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 npm exec --yes --package=@fission-ai/openspec@1.13.1 -- openspec validate refactor-secret-storage-owner --strict --no-interactive` | Passed | Draft proposal syntax and structure only. This is not human design approval |
| `git diff --check` | Passed | Current tracked diff. Newly created files also received direct prose and syntax checks |

The baseline token experiment used only the string `synthetic-credential` and a fake ciphertext buffer with a `v10` prefix. No real credential was loaded. Final regression tests must use deterministic fixtures and independently cover the neighboring guards.

## Browser prototype evidence

Tools are Playwright 1.63.0 and `@sparticuz/chromium` 153.0.0, both obtained in npm's external tool cache. The Chromium package supplies a headless executable and its Linux support libraries. The probe unpacks those libraries outside tracked source. It does not disable TLS certificate checks. The probe removes the package's `allow-running-insecure-content`, `disable-web-security`, and `disable-site-isolation-trials` flags. The local test browser runs without its OS sandbox in the sandboxed verification environment; this is not an application security setting or a production deployment recommendation.

The checked target is the local standalone HTML comparison, not Electron or a connected provider. No raw key or real storage operation exists in the comparison.

[Probe](../research/secret-storage-prototype-evidence/probe.cjs) and [results](../research/secret-storage-prototype-evidence/results.json) are persisted beside the screenshots. The six conditions are widths 360, 800, and 1280 at 900px viewport height in light and dark themes, with reduced motion enabled. Each condition starts a fresh browser and context. Reusing a browser after closing a context under the package's single-process mode caused a driver failure, so the probe uses one browser per condition. That failure was not reported as an app defect.

Every condition passed these assertions:

- The approved dedicated page is the initial option.
- The page has no horizontal overflow.
- Opening consent focuses Cancel.
- Tab and Shift+Tab remain between the confirmation controls.
- Escape returns focus to the initiating save action.
- Cancel does not save a demo credential.
- Confirming consent permits the demo save and labels it plaintext.
- Simulated keyring recovery leaves that saved plaintext label unchanged.
- Revocation blocks subsequent plaintext saves.
- A failed consent save leaves permission ungranted.
- Switching to the Models option changes the visible page.
- No page errors or console errors were recorded.

The first browser run caught a prototype Tab-focus escape. The same assertion passed after adding explicit endpoint wrapping for the two confirmation buttons. Application code must use the existing shared AlertDialog rather than copying the native-dialog prototype implementation.

The 1280px light dedicated-page capture and 360px dark confirmation capture were also visually inspected. This does not establish computed contrast, all text expansion cases, screen-reader behavior, or real app-state handling. Those probes remain pending. Screenshot weight is about 1.3 MB for the whole evidence directory.

To repeat, cache the exact tool packages without adding project dependencies, start `python3 .dump/app/research/2026-09-20-secret-storage-preview.py` with the process tool, and run the probe with `PLAYWRIGHT_MODULE` and `CHROMIUM_PACKAGE` set to those external package directories. The server exposes only the comparison HTML and its four local fonts. The probe uses loopback from inside the sandbox. Browser-facing prototype code names no server origin.

## Setup failures

| Attempt | Result and consequence |
| --- | --- |
| `node node_modules/electron/install.js` | Failed certificate validation. No Electron binary installed |
| Same command with `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` | Failed with connection reset before TLS establishment. Certificate verification stayed enabled |
| `npm exec --yes --package=playwright@1.63.0 -- playwright install chromium` | Browser CDN connections failed. The browser test later used the npm-distributed headless package instead |
| `sudo -n apt-get update -qq` and requested Xvfb/D-Bus/GUI libraries | Debian HTTP repository connections failed; packages could not be located. No successful system-package installation |
| `npm run postinstall` chained after Electron installation | Not run because installation failed first. Native rebuild and Electron dev patch are unverified |
| GitHub issue #13 ownership comments | Both attempts failed with `Resource not accessible by integration`. No issue comment posted |
| `gh api user` | HTTP 403. Repository reads remain available |

No browser tool was added to package.json. No TLS check, repository security gate, CSP, or preload setting was weakened to obtain a run.

## Application gate results, 2026-09-20

All commands ran on the final working tree with `NODE_OPTIONS` set as shown. Dependencies came from the frozen lockfile installed in this environment; `package.json` and `bun.lock` are unchanged (`git diff --exit-code -- package.json bun.lock` clean).

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| Frozen install | `npm exec --package=bun@1.4.2 -- bun install --frozen-lockfile` | Passed, 1169 packages. The `electron` postinstall failed on the blocked download host, which is why the Electron binary is absent | E3 |
| Biome, full tree | `node_modules/.bin/biome check .` | Passed, 955 files, no suppressions | E3 |
| Typecheck | `npm run typecheck` | Passed | E3 |
| Typecheck comparison | `npm run ts:check` | Passed | E3 |
| Typecheck ratchet | `npm run ratchet:typecheck` | Passed, 0 errors against a 0 baseline | E3 |
| Vitest | `npm test` | Passed, 1775 tests in 94 files | E3 |
| Node runtime suites | `npm run test:node` | Passed, 35 tests, including the real bundled daemon | E3 |
| Runtime-client build | `npm run build:runtime-client` | Passed | E3 |
| Lint gate | `npm run lint` with the bun binary on PATH | Passed; `fatal: origin/main...HEAD: no merge base` is handled by the script's endpoint fallback, 1104 changed paths reduce to 904 lintable files, no fixes. Without bun on PATH it exits 1 on the missing binary, which is a setup failure, not a finding | E3 |
| Dependency audit ratchet | `npm run ratchet:audit` (bun 1.4.2 on PATH) | Passed, no new critical advisories against baseline | E3 |
| Skills verification | `npm run skills:verify` | Passed, 50 of 50 locked skills | E3 |
| OpenSpec strict validation | `npm exec --package=@fission-ai/openspec@1.13.1 -- openspec validate ... --strict` | Valid | E3 |
| Main and preload bundles | `electron-vite build` (main and preload targets) | Built, `out/main/index.js` 3,026.82 kB, `out/preload/index.js` 12.48 kB | E3 |
| Renderer bundle | `electron-vite build` | Not run to completion here. V8 aborts on heap exhaustion at a 2800 MB limit | E3 |
| macOS packaging | `npm run package:mac` | Not run. No Electron binary in this environment and the platform is Linux | E4 |
| Real Linux disabled-keyring flow | manual connect, restart, disk inspection | Not run. No D-Bus, no keyring, no display, and no Electron binary | E4 |
| UI delivery gates on the application | the six gates and taste pre-flight | Not run. The app cannot be launched here | E4 |

### Why the renderer bundle cannot run here

The container has 3,939 MB of memory and CI's own workflow comment says the renderer build OOMs below roughly 3 GB of heap (`NODE_OPTIONS: --max-old-space-size=4096` at workflow scope, `.github/workflows/ci.yml:16-18`). A control run settles that this is environmental: the same command on an unmodified checkout of the base commit, extracted with `git archive` and sharing this tree's `node_modules`, aborts identically at 2800 MB. The build gate therefore runs in CI on three operating systems, and this record does not claim a green renderer bundle.

### What the tests cover

- Stored-representation decoding: ciphertext prefix handling, refusal when no keyring can decrypt, legacy plaintext remaining readable with and without a keyring, and unresolvable payloads raising instead of returning a substitute.
- Write policy: refusal without consent, permission with consent, consent required even for a plaintext-only target, `basic_text` treated as unprotected, and encryption failure storing nothing.
- Consent metadata: atomic write, 0600, malformed file preserved beside the replacement and reported, revocation.
- Keyed renderer store: encrypted round trip with the value absent from the file text, refusal leaving the file untouched, a plaintext value still readable after a keyring returns, unreadable entries reported, and per-key removal.
- Redaction: a serialized credential record with realistic field names, nested provider payloads, tokens embedded in free text, and deep or unusual input.
- Private credential cleanup: provider `.env` files removed with names only in the result, non-credential files kept, symlinked directories refused, missing directories tolerated.
- Sign-in store: encrypted round trip with the plaintext absent from the file bytes, every read still working after a keyring disappears, a refused write leaving the saved value alone, a consented plaintext write winning over ciphertext it cannot decrypt while the ciphertext is kept aside, legacy `auth.json` migration, a refused migration keeping the legacy file, and a malformed file reported rather than trusted.
- Provider file secrets: the same set for the `.dat` plus JSON companion layout, including the companion file surviving a refusal and a stashed unreadable file.

## Changes after the first record

Two self-review findings changed code after the earlier draft of this record:

| Finding | Change | Test |
| --- | --- | --- |
| A ciphertext file from a keyring that is gone would keep winning on read, hiding a newer consented plaintext value | `stashUnreadableCiphertext` in `owner.ts:45` renames it aside before the plaintext write, in both the sign-in store and the provider file stores | `auth-store.test.ts`, `file-secret.test.ts` |
| `x-desktop-token` was written to the `persist:main` cookie store with an expiry, a second plaintext copy of the session token on disk | `setDesktopTokenCookie` at `src/main/index.ts:111` writes a session cookie, login removes any older persisted one, and startup re-issues it from the encrypted session | Typechecked call sites only; Electron's cookie store cannot be driven here, so this rests on the pinned cookie documentation |

### Carried over

- The `electron` postinstall cannot complete here, so native module rebuild and the Electron dev patch remain unverified; CI's package job runs a full install.
- No raw credential was loaded at any point. The native check used the synthetic value `sk-ant-synthetic-0000000000000000`.
- The issue backlink is still blocked by `Resource not accessible by integration`; PR creation is attempted this turn.

## Duplication and review cleanup, session 2026-09-20 to 2026-09-21

SonarCloud measured 77 duplicated lines in the new code of PR #68, 2.59% of 2,973 new lines, against the 0.0% target. The component tree and two `duplications/show` responses located all of it:

| File | New duplicated lines | Duplicated with |
| --- | --- | --- |
| `src/main/auth-store.test.ts` | 20 | `file-secret.test.ts`, `keyed-store.test.ts` |
| `src/main/lib/secret-storage/file-secret.test.ts` | 20 | `auth-store.test.ts`, `keyed-store.test.ts` |
| `src/main/lib/secret-storage/keyed-store.test.ts` | 17 | the same two |
| `src/main/lib/gemini-auth-store.ts` | 10 | `openrouter-auth-store.ts` |
| `src/main/lib/openrouter-auth-store.ts` | 10 | `gemini-auth-store.ts` |

The counters add to 77 exactly, so no other new file carries duplicated lines on that analysis.

| Change | Files |
| --- | --- |
| One save/load/clear/status implementation, with the provider stores as configuration over it | `keyed-auth-store.ts` (new), `github-auth-store.ts`, `gemini-auth-store.ts`, `openrouter-auth-store.ts` |
| One fake keyring, temp home and cleanup, imported by every store test | `test-support.ts` (new), `owner.test.ts`, `auth-store.test.ts`, `file-secret.test.ts`, `keyed-store.test.ts` |

Findings from the same pass:

| Finding | Change | Test |
| --- | --- | --- |
| `loadFileSecret` answered `null` for a file it could not decrypt, so a provider status said "not saved" while the file sat on disk, and the settings page promised that an unreadable credential is reported there | `readFileSecret` returns `{ value, error }`, the keyed auth store reports `{ ok: false, error }`, and the status query carries `providerReadErrors` for the page | `keyed-auth-store.test.ts`, plus the `StatusData` assignment check in the settings tab |
| Masked credentials used the ellipsis character | `maskCredential` uses `...` | `keyed-auth-store.test.ts` |
| An orphaned doc comment above `stashUnreadableCiphertext` described `inspectBytes` | Comment moved to `inspectBytes`, and the decode contract says text columns hold base64 of the same bytes | Reading only |

SonarCloud issues after the re-analysis of `c9ee81d`: seven open, one MAJOR (`S3358` nested ternary in the settings tab) and six MINOR (three `S6759` read-only props, `S6606` at `secret-storage/index.ts:13`, `S7776` at `owner.ts:24`, `S7763` at `owner.ts:258`). Commit `7a33259` fixes all seven, and the re-analysis of the pushed head is the check that confirms it.

### Gate results after these changes

| Gate | Command | Result | Evidence |
| --- | --- | --- | --- |
| Frozen install | `bun install --frozen-lockfile --ignore-scripts` | No changes, 1285 packages | E3 |
| Runtime-client build | `npm run build:runtime-client` | Passed | E3 |
| Biome, full tree | `bun x biome check .` | Passed, 962 files, no suppressions | E3 |
| Typecheck | `npm run typecheck` | Passed | E3 |
| Vitest | `npm test` | Passed, 1785 tests in 95 files | E3 |
| Node runtime suites | `npm run test:node` | Passed, 40 tests | E3 |
| Contract tests | `npm run test:contracts` | Passed, 382 tests in 23 files | E3 |
| Lint gate | `node scripts/ci/lint-changed.mjs` with bun on PATH | Passed, 1107 changed paths reduce to 907 lintable files, no fixes | E3 |
| Typecheck ratchet | `node scripts/ci/typecheck-ratchet.mjs` | Passed, 0 errors against a 0 baseline | E3 |
| Runtime-client typecheck | `npm --prefix packages/runtime-client run typecheck` | Passed | E3 |
| Dependency audit ratchet | `npm run ratchet:audit` | Passed, no new critical advisories against baseline | E3 |
| Skills verification | `npm run skills:verify` | Passed, 50 of 50 locked skills | E3 |
| OpenSpec strict validation | `openspec validate refactor-secret-storage-owner --strict` | Valid | E3 |
| Typecheck comparison | `npm run ts:check` | Not run to completion here. Four attempts were killed with no diagnostics at 2048, 3072 and 4096 MB heaps while host load sat above 6, and a fifth hung past ten minutes. The command passed in this environment earlier in the session on the previous commit, `tsc` typecheck passes, and CI runs it in the quality job, which is green on `c9ee81d` | E4 |

## Acceptance criteria check, step 11

| Criterion | State | Evidence |
| --- | --- | --- |
| One import path for credential encryption, proven by a grep that finds no direct `safeStorage` use in provider routers | Met. Five call sites in `secret-storage/electron-keychain.ts` and comments elsewhere; the base had six importers and 35 references across `src/main` | E3, `rg -n "safeStorage" src/main`, recorded in `research/2026-09-13-secret-owners.md` |
| Unavailable encryption surfaces in settings and blocks new `secret: true` writes without consent | Met in code. `buildStatus` returns the protection, the backend and a concrete reason the page renders; `resolveProtection` throws `consent-required`; the store tests cover refusal, consent, plaintext-only targets, the Linux `basic_text` backend and an encryption failure | E3 tests, E4 for the rendered page (the app cannot be launched here) |
| A test asserts a credential record serialises redacted | Met. `redact.test.ts` covers a serialized credential record with nested provider payloads, tokens in free text, and deep input | E3 |
| The `safeStorage` grep shrinks and the record explains each remaining call | Met. The research record lists the remaining call sites, tests aside, and why each is there | E1 |
| Manual Linux run with the keyring disabled | Not run. No D-Bus, no keyring daemon, no display and no Electron binary here, so the connect, restart and disk-inspection flow stays with the human | E4, unchanged |

## Residual gaps from the review passes

| Gap | Where | Risk | Position |
| --- | --- | --- | --- |
| A crash leaves the per-run Cline temp directory `cline-run-*` in the OS temp dir holding a plaintext provider key | `src/main/lib/cline-print/auth-config.ts:106-153` | The module documents a one-turn plaintext window, and a crash or a killed process extends it until the OS cleans temp. The key is written only for a custom baseUrl, and the file mode is 0600 | Recommend a sweep of `cline-run-*` at app start or before the next Cline run, in the shape of `clearPrivateCredentialFiles` for the native runtime. Not changed here: the file belongs to another step's domain and step 11's approved native scope covers the runtime, not `cline-print` |
| The memory-only handoff ships in the vendored tree, while the daemon binary comes from the `@1jehuang/jcode-*` optional package | `runtime/jcode/crates/jcode-provider-env/src/ephemeral.rs` | No protection until a jcode release carries the patch. The shipped mitigation is the spawn and quit cleanup of `config/jcode/*.env`, and the settings page states the mechanism | Already stated in the PR body and the roadmap notes; the finding is recorded here so it is not mistaken for shipped protection |
| The native handoff path is unverified against a real capability advertisement | `src/main/lib/runtime/credentials.ts` | The runtime check recorded that the shipped daemon omits `ephemeral_api_key` and answers `unknown_request`, so the memory path never runs in the shipped configuration. The disk path it falls back to is disclosed in settings and cleared around each run | Verified live for the daemon in use, E1. A release that carries the patch is the next chance to exercise the memory path |

## Review comment resolution, PR #68 round 2 (2026-09-21)

Thirty open threads were on the pull request after the deduplication commit
(twenty-nine from CodeAnt AI and CodeRabbit, plus four nitpick suggestions in a
thread comment). Each was checked against the source before any change. This
round covers fixes only; no thread was closed without either a change or a
recorded reason.

| Finding | Verdict | Change |
| --- | --- | --- |
| `keyed-store.ts:75` unknown protection treated as plaintext | Valid | `isStoredEntry` reports an entry whose recorded protection or payload shape is unknown instead of returning raw payload |
| `keyed-store.ts:114` temporary file renamed before it is validated | Valid | `writeFile` reads the temporary file and runs the value check before `renameSync`, and removes the temporary file on any failure |
| `file-secret.ts:61` plaintext replacement written in place | Valid | `savePlaintextCompanion` writes through a temporary file and verifies it before replacing the companion |
| `file-secret.ts:123` clear swallows an unlink failure | Valid | `clearFileSecret` attempts both paths, then throws with the context when one remains |
| `file-secret.ts:37-44` temporary ciphertext leaked on a throw | Valid | The encrypted branch removes the temporary file in a `catch` for both the mismatch and the throwing read |
| `file-secret.ts:98-99` unreadable companion reported as absent | Valid | A companion that cannot be parsed, or lacks the field, returns an error instead of `{value: null, error: null}` |
| `owner.ts:58` stash predicate did not match the write policy | Valid | `stashUnreadableCiphertext` now keys off `readAvailability(keychain).usable`, so Linux `basic_text` cannot keep an older value winning after a consented plaintext write. Covered in `owner.test.ts` and `file-secret.test.ts` |
| `auth-store.ts:32` unvalidated session fields | Valid | `parseAuthData` requires string `refreshToken` and `expiresAt`; both legacy writers always wrote the full record |
| `runtime/credentials.ts:106` half-applied handoff | Valid | The applied ephemeral providers are cleared before the failure is rethrown, so no key outlives the turn that failed |
| `runtime/index.ts:75` cleanup skipped when shutdown fails | Valid | `try`/`finally` around `manager.shutdown()` |
| `runtime/credential-files.ts:47` unlink failure only warned | Valid | Cleanup fails closed: a `.env` file that cannot be removed stops the daemon, and the startup path calls the strict variant. The teardown wrapper stays quiet |
| `credential-files.test.ts:26` temp dirs never removed | Valid | Homes are registered and removed in an `after` hook; a failure path test was added |
| `redact.test.ts:51` GitHub-shaped token never asserted | Valid | The fixture builds `ghp_` plus 24 characters at runtime and the test asserts it is gone |
| `renderer-secrets.ts:99` migration after a read error | Valid | `hydrate` records the error and stops before touching browser storage |
| `renderer-secrets.ts:116` unsequenced mutations | Valid | Writes are chained per key, so an older request cannot land after a newer one |
| `renderer-secrets.ts:160` fire-and-forget save reported as success | Valid | `whenRendererSecretSaved` exposes the write outcome; both Codex save paths and the removal path in the models tab and the login flow await it before claiming success |
| `src/main/index.ts:115` expired token left the cookie behind | Valid | `removeDesktopTokenCookie` runs on the expired path and in the login block |
| `keyed-auth-store.test.ts:63` assertion could not fail | Valid | The check now filters the recursive listing for `openrouter-auth` entries |
| `keyed-store.test.ts:89` temporary file never inspected | Valid | The test asserts no `.tmp-` entry remains in the data directory |
| `preview.py:44` prototype bound to all interfaces | Valid | Loopback by default, with `PREVIEW_HOST` for a container preview proxy |
| `agents-models-tab.tsx:428` wording claimed encryption | Valid | The Gemini and OpenRouter rows say the key is saved by the app; the database writers still refuse without encryption or consent |
| `openspec .../spec.md:5` owner named as `auth-store.ts` | Valid | The requirement names `src/main/lib/secret-storage/` as the policy owner, `electron-keychain.ts` as the boundary and `auth-store.ts` as the sign-in surface |
| `openspec .../tasks.md:23` temporary-provider item marked done | Valid | Split: the runtime and cookie writes stay done, and the Cline custom-endpoint `providers.json` is a new unchecked item naming `src/main/lib/cline-print/auth-config.ts` |
| `openspec .../tasks.md:41` shipping gates marked done | Valid | Split: the static and test gates stay checked, and the renderer bundle and `package:mac` runs are a new unchecked item pointing at CI |
| `.dump .../native-credential-check.mjs:64` audit never failed | Valid | The five conclusions are checked, recorded as claims and exit non-zero when one changes. Re-run after the change: `claims_ok: true` |
| `docs/protocol.md:67` session-isolation claim | Valid | The section now states that the registry holds one value per provider variable, that only clearing is session-scoped, and that a client must treat the handoff as one active session per variable. The Rust comments say the same |
| `ephemeral.rs:29` and `:66`, session-aware lookup | Valid, not changed in code | The provider resolves its key by variable name and carries no session id, so session-scoped lookup is a runtime design change, not a patch. The capability is not advertised, mausCode gates its use on `client.supports("ephemeral_api_key")`, and the limitation is now documented at both sites and in `docs/protocol.md` |
| `claude-token.ts:359` permission checked before the refresh | Valid as a race, by design as a control | The pre-refresh probe is the approved rule, `writeToCredentialsFile` runs the same authorization again at write time, and a failed write keeps the CLI store as it is. A rotation that cannot be persisted stays a disclosed residual risk |
| `keyed-auth-store.ts:69` and `github-auth-store.ts:32` `load()` returns null for an unreadable file | Intended contract | `status()` reports the reason and the Credential storage page shows it per provider; `load()` is the value-or-nothing path for callers that cannot act on an unreadable file. Its contract is now documented on the type |
| `token-crypto.ts:14` `SecretStorageError` from a save procedure | No change needed | The refusal is the mutation error; there is no plaintext fallback and no other error shape in those procedures to map to. The message names the permission the user can grant |

### Gate results after this round

| Gate | Result | Evidence |
| --- | --- | --- |
| `npm run build:runtime-client` | Passed | E3 |
| `npx biome check .` | Passed, 962 files, no fixes | E3 |
| `npm run typecheck` | Passed | E3 |
| `npm test` | 95 files, 1788 tests passed (was 1785) | E3 |
| `npm run test:node` | 41 tests passed (was 40) | E3 |
| `npm run test:contracts` | 23 files, 382 tests passed | E3 |
| `npm run lint` | Passed, 907 files | E3 |
| `npm run ratchet:typecheck` | 0 errors <= 0 baseline | E3 |
| `npm run ratchet:audit` | No new critical advisories | E3 |
| `npm run skills:verify` | 50 of 50 locked skills verified | E3 |
| OpenSpec strict validation | Valid | E3 |
| Native credential check | `claims_ok: true`, exit 0, refreshed `.json` | E1 |
| `npm run ts:check` | Not run to completion here. A fifth attempt was killed after 300 seconds with no diagnostics while memory was free; CI runs the same command in the quality job | E4 |

### Residual gaps after this round

| Gap | Position |
| --- | --- |
| The ephemeral registry holds one value per provider variable, so two live sessions cannot hold different keys for the same variable | Documented in `docs/protocol.md` and at the Rust functions. The capability stays unadvertised and unshipped; a session-scoped lookup is a runtime change for a release that carries the patch |
| A successful Claude token rotation whose local write then fails leaves the CLI store on the previous token | Approved rule: the permission is checked before the network call, and the write re-checks it. The failure keeps the old store and logs; a user who can no longer refresh signs in again |
| A crash can still leave the Cline per-run `providers.json` | Unchanged from the previous record; the item is now an unchecked task with the file named |

## Second review round (2026-09-21)

Commit `17715b0` answers every open thread on the pull request: 14 from CodeAnt
AI and 16 from CodeRabbit. Each was checked against the source before any
change; 24 brought code changes, two are answered with a recorded reason and no
change (`token-crypto.ts` error mapping, `claude-token.ts` pre-refresh probe),
and four are documentation or evidence changes (`docs/protocol.md` and the
`ephemeral.rs` comments on the one-value-per-variable registry, the OpenSpec
owner requirement, and the two task-list items).

Per-thread dispositions are recorded in the "Review comment resolution" table
earlier in this file, and each thread carries a reply on the pull request.

### Gate results on `17715b0`

| Gate | Result | Evidence |
| --- | --- | --- |
| Frozen install | No changes | E3 |
| `npx biome check .` | 962 files, no fixes | E3 |
| `npm run typecheck` | Passed | E3 |
| `npm run ts:check` | Not run to completion. Every attempt in this sandbox was killed by the environment with no diagnostics (latest: 4096 MB heap, killed after 727 s). CI runs it in the quality job | E4 |
| `npm test` | 95 files, 1788 tests passed | E3 |
| `npm run test:node` | 41 tests passed | E3 |
| `npm run test:contracts` | 23 files, 382 tests passed | E3 |
| `npm run lint` | 907 files checked, no findings | E3 |
| `npm run ratchet:typecheck` | 0 errors <= 0 baseline | E3 |
| `npm run ratchet:audit` | No new critical advisories | E3 |
| `npm run skills:verify` | 50 of 50 locked skills | E3 |
| `npm run build:runtime-client` | Passed | E3 |
| OpenSpec strict validation | Valid | E3 |
| Native credential check | `claims_ok: true`, exit 0 | E1 |
| `electron-vite build` renderer | Cannot finish here (heap exhaustion; a clean base checkout behaves the same). CI builds it | E4 |
| `package:mac` | Not run, no Electron binary on Linux | E4 |
| SonarCloud, `b19089e` (the head that carries every dedupe change) | Quality gate OK, zero open issues, zero bugs, zero vulnerabilities, and `new_duplicated_lines` 0 of 3,151 new lines, which is 0.0% new-code duplication | E1, read from the SonarCloud API |

### Open items after this round

- The SonarCloud analysis of `17715b0` has not run yet; recheck the issues and
  the new-code duplication measure before calling the duplication target met.
- CI on `17715b0` is watched to terminal; the security and Ubuntu build jobs had
  passed when this was written.
- The manual Linux disabled-keyring run and `package:mac` remain with the human
  or CI, as recorded above.

### SonarCloud re-read after the fix batches (2026-09-21)

- Issues: `total: 0`. The seven findings recorded against `c9ee81d` are gone
  from the analysis of `b19089e`.
- New-code duplication: the project row reads `new_duplicated_lines` 0 of
  `new_lines` 3,151, and SonarCloud marks it as the best value. The 77
  duplicated lines from the `c9ee81d` analysis are gone: the shared provider
  store, the shared test fixtures, and the test-file rewrites removed every
  carrier.
- The analysis covering `17715b0` and `5bde078` had not been published when this
  was written. Those commits touch imports, two save or removal handlers, a few
  error paths and comments, with no new repeated block, but the measure is
  re-read after the analysis lands rather than assumed.

Re-read endpoints:

- `https://sonarcloud.io/api/issues/search?componentKeys=maus-inc_mauscode&pullRequest=68&resolved=false&ps=50`
- `https://sonarcloud.io/api/measures/component_tree?component=maus-inc_mauscode&pullRequest=68&metricKeys=new_duplicated_lines,new_lines&ps=500&s=metric&metricSort=new_duplicated_lines&asc=false`

### GitHub connection state (2026-09-21)

The GitHub token stopped working partway through the verification round
(`gh auth status` reports the token in `GH_TOKEN` as no longer valid, and every
API call answers 401). The pushes of `17715b0` and `5bde078` went through
before that, and every review reply and thread resolution was posted. What
remains blocked is reading the terminal CI conclusion for `5bde078` and any
further push, including this record.

## Third review round, CodeAnt AI on `5bde078` (2026-09-21)

Twelve new threads, all from CodeAnt AI, all validated against the source before
any change. Eleven brought code changes, one is answered with a recorded reason
and no change. Every thread carries a reply on the pull request.

| Finding | Verdict | Change |
| --- | --- | --- |
| `agents-models-tab.tsx:596` a refused write leaves the new value in the atoms | Valid | The Codex and OpenAI save and removal handlers restore the previous atom values when the write is refused, so the session cannot run on a key that was never stored |
| `renderer-secrets.ts:100` a failed startup read freezes the sync for the session | Valid | `hydrate` clears `started` on a transport failure, so the next read retries. A keyed-store read error still stops the migration, which is the documented guard, and the Credential storage page is the recovery path |
| `file-secret.ts:153` sign-out leaves a stashed ciphertext copy | Valid | `clearFileSecret` also removes the stashed copies, named by the new `stashedCiphertextPaths` in `owner.ts`, so one place owns the naming. A listing failure fails the clear. Covered in `file-secret.test.ts` |
| `credential-files.ts:38` a symlinked credential directory counts as cleaned | Valid | The cleanup throws instead of returning success, so the startup path refuses to run the daemon beside a path it cannot vouch for. The test now asserts the throw and that the symlink target is untouched |
| `credential-files.ts:58` inspection errors are swallowed | Valid | `lstat` and `readdir` failures throw with the directory named. ENOENT still returns quietly, and the teardown wrapper stays non-throwing |
| `credentials.ts:151` a failed release is swallowed | Valid | Each failure warns with the provider name and the reason, never the value. The daemon is long-lived and holds one value per variable, so the residual key is now visible instead of silent |
| `auth-store.ts:93` the stash runs before the plaintext write | Valid | The companion is written through a temporary file first, then the ciphertext moves aside, and a stash that did not happen is reported. `auth-store.test.ts` covers a failed companion write that keeps the session loadable |
| `auth-store.ts:179` the cleanup loop stops on the first unlink error | Valid | Every path is attempted, the failures are named, and `clear()` throws. The logout handler logs and still clears the cookie and shows the login page, and the Credential storage page shows the recorded reason |
| `claude-token.ts:314` the CLI credential file is written in place | Valid | The write goes to a temporary file and replaces the file in one step, so an interrupted refresh cannot truncate the only stored credential |
| `claude-token.ts:376` a rotation whose write fails | Valid as a race, answered without a code change | A server-side rotation cannot be undone locally. The permission probe before the refresh is the approved rule, `writeToCredentialsFile` re-checks it, the write can no longer truncate, and a failure keeps the CLI store and reports it. The refreshed access token still serves this session in memory |
| `keyed-store.ts:134` a malformed file is replaced by the next write | Valid | The unreadable bytes move to `<file>.unreadable-<stamp>` with the path logged, and the write then starts from a clean file. Covered in `keyed-store.test.ts` |
| `runtime.ts:396` a replaced turn clears the replacement's key | Valid | A new credential ledger (`runtime/credential-ledger.ts`) records which generation wrote which providers. A superseded turn releases only providers no newer generation owns, and the ledger is pure state with five unit tests |

## Design alignment pass on the Credential storage page (2026-09-21)

Sources loaded: `DESIGN.md`, `docs/design-system-baseline.md`,
`.agents/skills/impeccable/reference/craft-floor.md`, the `antislop` core,
`antislop-ui`, `unslop`, `design-taste-frontend`, and `ui-ux-pro-max`. No skill
script was run, per the execution limits in `docs/design-skills.md`.

Findings and changes:

| Finding | Baseline rule | Change |
| --- | --- | --- |
| The page's row pill used `text-[10px]`, `bg-muted`, and `text-emerald-700 dark:text-emerald-400` | §3.5 and `DESIGN.md` badges: `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium`, a 10 percent wash, solid-500 text | New shared `src/renderer/components/ui/status-pill.tsx` with the four recorded tones, used by the Credential storage page and by the Backends page, whose local copy of the same pill is deleted. One implementation, one set of values |
| Every row without a claim showed "See notes" | Copy names the state; a control names its action | Each row now carries its own honest state: Encrypted, Plaintext, Refused, Unreadable, CLI-owned, Plaintext during a run, Moved to the app store, Not in use |
| The consent notice used `bg-amber-500/5` | Colored status washes are 10 percent (`bg-orange-500/10`, `bg-destructive/10`, `bg-amber-500/10`) | Changed to `bg-amber-500/10` |
| "Check again" was a bare ghost button with no loading state | States: hover, disabled, loading, error, empty; the debug page pairs `RefreshCw h-4 w-4 mr-2` with an outline small button | Outline small button with a `RefreshCw` that spins while fetching and disables the button |
| `agents-backends-tab.tsx` used the `…` character | `DESIGN.md`: don't use the `…` character | `probing...` |

Checked and left alone: the tab header (`h3 text-sm font-semibold` plus `text-xs`
description) matches every sibling settings tab; the card shell, card header, row
switches, `space-y-6` root, loader, and the shared `AlertDialog` confirm all match
the baseline and the siblings. The page was not redesigned; the human approved
its direction, and only values and copy that contradicted the recorded baseline
changed.

## Gate results after the third round

| Gate | Result | Evidence |
| --- | --- | --- |
| Frozen install | `bun install --frozen-lockfile --ignore-scripts`, lockfile unchanged | E3 |
| `npm run build:runtime-client` | Passed | E3 |
| `npx biome check .` | 965 files, no fixes | E3 |
| `npm run typecheck` | Passed | E3 |
| `npm run ts:check` | Not run to completion. The sandbox kills `tsgo` with no diagnostics (4096 MB heap, killed after 366 s). CI runs it in the quality job | E4 |
| `npm test` | 95 files, 1792 tests passed | E3 |
| `npm run test:node` | 47 tests passed, including the credential ledger and the fail-closed cleanup | E3 |
| `npm run test:contracts` | 382 tests passed | E3 |
| `npm --prefix packages/runtime-client run test` | Passed | E3 |
| `npm run lint` | 910 files checked, no findings | E3 |
| `npm run ratchet:typecheck` | 0 errors <= 0 baseline | E3 |
| `npm run ratchet:audit` | No new critical advisories | E3 |
| `npm run skills:verify` | 50 of 50 locked skills | E3 |
| OpenSpec strict validation | Valid | E3 |
| Native credential check | `claims_ok: true`, exit 0 | E1 |
| SonarCloud on `b19089e` | Quality gate OK, 0 open issues, 0.0% duplication on new code (0 of 3,151 lines) | E1, read from the SonarCloud API |
| `electron-vite build` renderer, `package:mac` | Not run here, environment-blocked; CI owns both | E4 |

### Open items after the third round

- SonarCloud has not analysed the commits after `b19089e`; the duplication and
  issue measures are re-read once the analysis lands.
- CI on the newest head is watched to terminal.
- The manual Linux disabled-keyring run and `package:mac` remain with the human
  or CI.
- Two pre-existing items stay out of scope and are flagged: the Cline
  custom-endpoint temporary `providers.json` sweep, and the `docs/protocol.md`
  session-scoped lookup, which needs a runtime signature change.

### Self-review findings on the third-round diff (2026-09-21)

Two gaps were found in my own changes after the gates went green, both fixed
before the commit was pushed:

| Gap | Why it mattered | Fix |
| --- | --- | --- |
| `clearFileSecret` would throw when nothing was ever written, because listing an absent `data` directory raises ENOENT | Clearing a key on a fresh install would have reported that a credential "may still be stored" when none existed | `stashedCiphertextPaths` returns an empty list for an absent directory, keeps the throw for any other listing failure, and a new test clears a secret whose data directory does not exist |
| The renderer retry re-fired the status query on every read while the failure persisted | A broken main process would have been queried on every render instead of once per retry | `startRendererSecretSync` keeps one attempt in flight and only marks the session hydrated after a successful read, so a failure allows exactly one new attempt per caller |

The renderer retry is not covered by a test: `src/renderer` has no vitest suite
for this module, and the retry depends on the tRPC client. The behavior is a
two-line guard that typecheck and the manual read of the module cover, and it is
reported here as E4 rather than claimed as verified.

## Fourth review round, CodeAnt AI on `caab035` (2026-09-21)

Twelve new threads arrived on the self-review commit. Each one was checked
against the source before changing anything.

| Finding | Verdict | Change |
| --- | --- | --- |
| `keyed-store.ts:138` moves an unreadable file aside before the consent check, so a refused write still destroys the canonical store | Confirmed. `prepare` is what enforces consent, and it ran after `setAsideUnreadableFile` | `prepare` now runs first, and a test asserts a refused write leaves both the bytes and the absence of a `.unreadable-` copy |
| `owner.ts:91` swallows read and rename failures, so the bytes stay at the canonical path and hide the new value | Partly confirmed. The failure was returned, but `save()` cleared the message it had just set | The message is carried out of the branch instead of being overwritten, with a test that forces the stash to fail |
| `raw-logger.ts:112` only redacts known key names and token shapes | Known limitation. The redactor is a boundary filter over a log that only carries provider payloads; widening it to arbitrary fields has no bounded rule | Reply-only, reasoning recorded in the thread |
| `credentials.ts:124` partial-handoff cleanup ignores generations | Confirmed. The catch cleared every ephemeral provider, including one a newer turn had just written | Cleanup now goes through `markCredentialsApplied` and `releaseNativeEphemeralCredentials`, so a superseding turn keeps its key |
| `runtime/index.ts:59` clearing runs only when the manager is created, so crash recovery can restart the daemon beside stale files | Confirmed as a real gap; the crash path is the cleanup's whole purpose | Deferred with a flag: a recovery hook has to sit in the manager's restart path, which is a different owner's file and beyond this PR's scope. The spawned-process path is covered |
| `auth-store.ts:108` clears the stash failure and reports success | Same finding as `owner.ts:91`, same fix |
| `claude-token.ts:290` macOS passes the persistence check even when the Keychain write can fail | Confirmed and narrowed. Availability cannot be proven per item, so the fix is not a pre-flight claim | The refresh now refuses when the credential came from the system store on a platform that cannot write it, and the outcome is surfaced |
| `claude-token.ts:394` Linux and Windows read from the keychain but write the file, so later reads keep the stale value | Confirmed. The write path never looked at where the credential came from | `readExistingClaudeCredential` returns the source store, the refresh refuses when the source is the keychain and the platform writes files, and the file path is unchanged for file-sourced credentials |
| `windows/main.ts:540` the logout catch swallows a failure that leaves a session on disk | Confirmed. Logging the failure and signing the user out in the UI is the wrong signal for a credential that is still on disk | Deferred: the only non-cascading change is to rethrow, which would leave the renderer mid-logout. The comment records the gap |
| `agents-credential-storage-tab.tsx:309` a capability pill reads as a claim about saved plaintext | Confirmed. Legacy values stay readable and are never described per file | Pills and details now say what the next write does, which is the state the main process actually reports |
| `agents-models-tab.tsx:732` the rejected OpenAI key stays active in the main process | Confirmed. `voice.setOpenAIKey` lands before the app store is written, and only renderer state was restored | `restoreOpenAIKey` re-applies the previous key and invalidates `voice.isAvailable` |
| `use-codex-login-flow.ts:153` the atom keeps a key that failed to persist | Same class as the models tab, and cheaper to fix here | The previous atom value is restored before the error is reported |

Untested changes in this round are the two renderer rollbacks and the runtime
restart hook, all noted above as E4.

### Fifth pass, gaps the fourth round left (2026-09-21)

The refusal added for `claude-token.ts:290` was the one new decision with no
test behind it. `canPersistRefreshedClaudeCredential("keychain")` now has a test
in `src/main/lib/claude-token.test.ts` that stubs Electron the way
`src/main/lib/hermes/acp-chat.test.ts` already does. On Linux and Windows it
asserts the refusal, and on macOS it asserts the keychain write is allowed, so
the platform split is covered instead of assumed. The macOS case is skipped on
this Linux sandbox and runs on the macOS CI job.

Two more checks in this pass, both clean: the OpenAI key has exactly one
renderer writer and one main-process sink, so the rollback covers every path,
and the Codex key in the models tab never leaves the atom, which is why its
round-3 restore is enough there.

Gate results after this pass: biome 966 files clean, typecheck pass, vitest 96
files / 1796 passed with 1 skipped (the macOS case), `test:node` 47, contracts
382, runtime-client 43, lint clean, both ratchets pass, skills 50 of 50, openspec
valid, native check `claims_ok: true`.

### SonarCloud on `4f99745` (2026-09-21)

The analysis landed at 03:12:30Z with the quality gate OK: 0 bugs, 0
vulnerabilities, 0 open issues, 0 new code smells, 3891 new lines and 0
duplicated lines in them (0.0%). The duplication acceptance the human set is met
on the published head.

## Fifth review round, CodeAnt AI on `29bca56` (2026-09-21)

Three findings, all checked against the source.

| Finding | Verdict | Change |
| --- | --- | --- |
| `keyed-store.ts:140` a failed write leaves every entry only under a recovery name that reads ignore | Confirmed. The set-aside ran before the replacement write, and a write that threw left the canonical path empty | The set-aside path is captured, and a failed write puts those bytes back when the canonical path is still empty. A test creates a directory at the temporary name so the write fails after the move, then asserts the original bytes are readable at the canonical path again |
| `auth-store.ts:122` a crash between the plaintext temporary write and its rename leaves a credential-bearing file that `clear()` never removes | Confirmed. The temporary name carried the process id, so the next write could not overwrite it and sign-out never looked for it | New shared helper `removeStaleTemps` in `owner.ts` lists and removes the temporary siblings of a file. It runs before every write in `file-secret.ts`, `keyed-store.ts` and `claude-token.ts`, and `clear()` sweeps all three session paths and reports anything it could not remove. Two tests cover a stale temporary file being swept and removed at sign-out |
| `credentials.ts:82` the runtime holds one value per provider variable, so two live sessions can share the newest key | Confirmed and already disclosed. `docs/protocol.md` section 3.1 states that writing is not session-isolated, that the most recent write wins, and that a client must treat the handoff as one active session per provider variable; the Rust module comment repeats it | Reply-only. Scoping the lookup to a session needs a session id in the provider resolution path, which is the runtime's design and not in this diff; the PR body's known-gaps block now names it |

Gate results after the fifth round: biome 966 files clean, typecheck pass,
vitest 96 files / 1799 passed with 1 skipped, `test:node` 47, contracts 382,
runtime-client 43, lint clean, both ratchets pass, skills 50 of 50, openspec
valid, native check `claims_ok: true`.

## Sixth review round, CodeAnt AI on `31c6402` (2026-09-21)

| Finding | Verdict | Change |
| --- | --- | --- |
| `agents-models-tab.tsx:747` a slower failed save restores a stale key over a newer one | Confirmed. The rollback captured the value at the time of the write, so an older attempt that lost the race wrote its value back over the newer one | Every save and removal takes an attempt number, and a rollback returns early when a newer attempt owns the key |
| `index.ts:156` a cookie restore can finish after sign-out and put the removed cookie back | Confirmed. `logout()` clears the store before the cookie is removed, so an in-flight `getValidToken` could resolve into an app that is already signed out | The continuation re-checks `isAuthenticated()` before setting the cookie, which leaves the sign-out the winner |
| `owner.ts:118` a failed stash is swallowed, so a caller can report success while reads still select the inaccessible file | Confirmed for the file secret store. The auth store already kept the reason | The stash result carries a `reason`, `file-secret.ts` refuses a plaintext replacement when the old bytes could not be moved aside and throws with a concrete message, and the auth store now names the reason too. Two tests cover the reason and the refusal |

Gate results after the sixth round: biome 966 files clean, typecheck pass,
vitest 96 files / 1801 passed with 1 skipped, `test:node` 47, contracts 382,
runtime-client 43, lint clean, both ratchets pass, skills 50 of 50, native check
`claims_ok: true`.

### SonarCloud on `1a831ca` (2026-09-21)

Analysis at 11:20:35Z, quality gate OK: 0 bugs, 0 vulnerabilities, 0 open
issues, 0 new code smells, 4077 new lines and 0 duplicated lines in them
(0.0%).

### Seventh pass, gaps in the sweep and the rollback (2026-09-21)

Three things my own review turned up after the sixth commit, fixed before this
note was written:

| Gap | Why it mattered | Fix |
| --- | --- | --- |
| `removeStaleTemps` deletes every temporary sibling, including one a live process is about to rename | The app holds a single-instance lock, so another process id can only be an earlier run that is gone, but the helper gave no way for a caller to say so | The rule is documented on the helper: `keepPath` protects the caller's own in-flight temporary file, and a foreign process id means a run that is already gone |
| The OpenAI removal rollback put the previous key back into the edit box even when a newer attempt owned the key | The atom guard covered the stored value, but the field the user is typing in was still overwritten by an older failure | `restoreOpenAIKey` returns whether it acted, and the caller only restores the field when it did |
| The plaintext refusal in `file-secret.ts` can also fire for a `.dat` file that holds plaintext, where the message would not name a reason | The base version only ever wrote ciphertext to that path, so the case comes from outside this app, and the refusal is still the honest outcome | Left as it is, and recorded here: the guard refuses rather than reporting a save that reads would never see |

One documentation gap was closed in the same commit: the `ephemeral.rs` module
comment described the memory-only registry without saying that no released
binary reaches it. It now states that the request variants exist in
`jcode-harness-api`, that the daemon does not handle them, and that a client
falls back to the persisted path, matching `docs/protocol.md`. The change is a
comment only, so it needs no compile check beyond the CI job that owns Rust.

Gate results after this pass: biome 966 files clean, typecheck pass, vitest 96
files / 1801 passed with 1 skipped, `test:node` 47, contracts 382, lint clean.

### SonarCloud on `0b78fa3` (2026-09-21)

Analysis at 13:44:19Z, quality gate OK: 0 bugs, 0 vulnerabilities, 0 open
issues, 0 new code smells, 4084 new lines and 0 duplicated lines in them
(0.0%).

This is the head with the sweep-rule comment, the OpenAI rollback guard and the
`ephemeral.rs` note. Each of the five commits since the fourth round was gated
in this sandbox before it was pushed, and CI ran the full set on every one.

### Eighth pass, the refusal message and what a foreign file does (2026-09-21)

The sixth round refused a plaintext replacement when the file at the ciphertext
path could not be moved aside. Reading that guard again showed the message was
wrong for one of the two cases it covers, and the fix belongs in the wording and
in the tests rather than in the condition.

A file at that path is the only source reads use, and the plaintext write
targets the companion file, so a stored file that holds no ciphertext still wins
the next read and the new value never loads. Refusing is right. What was wrong
was saying the file "cannot be read without a keyring" for a file that is
perfectly readable.

Both modules now name the file and say it was not moved aside, and the reason is
appended when the move itself failed. Two tests replace the earlier pair: a
plaintext file at the ciphertext path blocks the write, the error names the
file, and the value that file already holds is still readable afterwards. The
first attempt at this pass changed the condition instead and the tests showed
the old value winning on read, which is why the condition stayed and the wording
moved.

Gate results: biome 966 files clean, typecheck pass, vitest 96 files / 1803
passed with 1 skipped, `test:node` 47, contracts 382, lint clean, both ratchets
pass.

### SonarCloud on `db0c16f` (2026-09-21)

Analysis at 14:13:24Z with the gate OK, but one new code smell: `typescript:S4624`
on `file-secret.ts:81`, a nested template literal inside the refusal message
added in the eighth pass. The same shape sat in the auth store message. Both now
build the optional reason in a local variable before the message, which is the
clearer form anyway, so the finding is fixed rather than suppressed.

### SonarCloud on `1709e35` (2026-09-21)

Analysis at 14:26:48Z, quality gate OK: 0 bugs, 0 vulnerabilities, 0 open
issues, 0 new code smells, 4117 new lines and 0 duplicated lines in them
(0.0%). The nested-template finding from `db0c16f` is gone, and the acceptance
the human set for this step holds on the head that carries every fix: zero
duplication in new code, zero open issues.

## Seventh review round, CodeAnt AI on `1709e35` (2026-09-21)

Four findings, all in code this pull request added, and two of them in the
credential ledger I wrote in the third round. Every one is confirmed and fixed.

| Finding | Verdict | Change |
| --- | --- | --- |
| `credential-ledger.ts:38` a late release returns every provider once the current record is deleted, so it can clear a slot a later handoff took | Confirmed, and the round-3 test encoded the wrong behaviour on purpose. Generation numbers were also reused after a delete, so a straggler could collide with the live turn's number | The ledger now tracks ownership per provider and allocates a generation before the first write, never reusing a number. A release clears a provider only while the slot still holds the value that generation wrote, and clearing gives up ownership |
| `credentials.ts:140` a failed partial handoff overwrites a newer ledger generation and then clears the replacement's providers | Confirmed. The catch called `markCredentialsApplied`, which advanced the generation, so the failed turn became the newest owner and cleared everything it had written, including a slot the replacement owned | The generation is allocated at the start of the handoff and each key is claimed only after the daemon accepted it. The catch releases under that same generation, so it clears exactly the keys it wrote |
| `index.ts:150` a saved session that is expired or unreadable returns before the old persistent cookie is removed | Confirmed. `isAuthenticated()` false returned early, leaving a cookie an earlier version wrote with an expiry in the on-disk store | The not-authenticated path now removes the cookie before returning |
| `index.ts:159` a sign-in as another account lets an older restore pass `isAuthenticated()` and overwrite the new user's cookie | Confirmed. The check was authentication, not identity | The continuation writes the cookie only while the store still holds the exact token it resolved, which covers sign-out, a different account, and a re-sign-in as the same account |

The ledger test file was rewritten, not relaxed: the old test asserted that a
straggler clears a slot nothing had replaced, which is the behaviour this round
removes. It now asserts the opposite, plus a failed handoff clearing only its own
key, a generation number never being reused, and a release giving up ownership.
`test:node` grew from 47 to 51 passing tests.

Gate results: biome 966 files clean, typecheck pass, vitest 96 files / 1803
passed with 1 skipped, `test:node` 51, contracts 382, runtime-client 43, lint
clean, both ratchets pass, native check `claims_ok: true`.

### SonarCloud on `84a8b05` (2026-09-21)

Quality gate OK: 0 bugs, 0 vulnerabilities, 0 open issues, 0 new code smells,
4195 new lines and 0 duplicated lines in them (0.0%). The acceptance for this
step holds on the head that carries the seventh round: the ledger rewrite, the
failed-handoff fix, and the two startup cookie fixes.

Every check on the pull request passes on this head, including SonarCloud, and
no review thread is unresolved.

## Eighth review round, CodeAnt AI on `e46b831` (2026-09-21)

Three findings. Two of them sit in code added by earlier rounds of this pull
request, and one of them is a race that the ledger rewrite in the seventh round
narrowed without closing. All three are confirmed and fixed.

| Finding | Verdict | Change |
| --- | --- | --- |
| `credentials.ts:196` a release gives up ownership before its clear lands, so a replacement that claims the provider meanwhile loses its key to the older clear | Confirmed, and stronger than the wording suggests. Ownership was not the whole problem: the clear call is already in flight when a replacement writes, so no bookkeeping change alone can stop the older clear from landing after the newer write | Turns for one session are now chained through `runCredentialTurn`, so a release and a replacement's writes never overlap, and the release reads the slots when it runs rather than when it was asked for. Ownership is given up in `settle` once the clear has settled |
| `file-secret.ts:46` a `writeFileSync` that fails after creating the temporary file leaves plaintext bytes with no cleanup | Confirmed. The read-back check and the rename sat inside a `try` that starts after the write returns, so a throw from the write itself skipped the cleanup entirely. The keyed store's writer had the same shape | Both stores write the temporary file through `writeCredentialTempFile`, which removes a file the failed write created and rethrows. The keyed store's own catch still covers read-back and verify failures |
| `auth-store.ts:228` a directory listing failure in `removeStaleTemps` throws out of `clear()` and leaves the remaining session copies behind | Confirmed. The call sat outside the per-file handler, so a listing error ended the sign-out loop | The sweep and the stash removal are wrapped per path, a failure is recorded against that path and reported, and the loop continues. Stashed ciphertext copies are removed too, since they hold the same session |

The new tests fail without the fixes, which was checked by reverting each one in
turn. The ledger file grew three tests for the turn queue, the temp-write file
has three, and the auth store two, one of which covers a listing failure that
cannot be arranged on a real filesystem without permissions a test cannot rely
on, so it is injected through a partial module mock.

An unrelated gap found while reading the same code: `stashUnreadableCiphertext`
reported a failure to move aside a file that does not exist, which is the state
before the first save. The warning is gone and the result says nothing was moved.

Gate results: biome 967 files clean, typecheck pass, vitest 97 files / 1809
passed with 1 skipped, `test:node` 55, contracts 382, runtime-client 43, lint
clean, both ratchets pass, skills 50 of 50 locked plus 2 unrecorded, native check
`claims_ok: true`. The renderer bundle build was killed by this sandbox's memory
limit while the main and preload bundles built, so CI owns the renderer build as
before.

### SonarCloud on `bd1a1db` (2026-09-21)

Analysis at 16:13Z reports one new code smell, `typescript:S6582` on
`credential-ledger.ts:118`, which asks for an optional chain on the slot lookup
added in this round. The guard is now `slot?.generation !== generation`, which
says the same thing, so the finding is fixed rather than suppressed. Quality gate
OK, 0 bugs, 0 vulnerabilities, 0.0% duplication in 4561 new lines.

## Ninth review round, CodeAnt AI on `bd1a1db` (2026-09-21)

Four findings, and the two critical ones sit in code from earlier rounds rather
than in the round-eight change that prompted them. All four are confirmed and
fixed, and every fix has a test that fails without it.

| Finding | Verdict | Change |
| --- | --- | --- |
| `credentials.ts:163` each provider is queued separately, so another turn can run between the two writes and see a mixed configuration | Confirmed. Queueing per key left a window between the providers, which is the same window the round-eight finding was about | The whole handoff is one queued unit. The catch that releases a failed handoff calls the unqueued clear directly, because the queued one would wait on the handoff holding its own place |
| `credentials.ts:188` clear failures are swallowed but `settle()` then drops ownership, so a failed release is never retried and the daemon keeps the key | Confirmed. The clear returned nothing, so a failed release was indistinguishable from a completed one | The clear returns the providers the daemon did not clear. `settle(retained)` keeps those slots owned, so the ledger never records a release that did not happen and a later release of the same generation tries again. The daemon still holding an in-memory key is the residual risk already stated for the handoff |
| `auth-store.ts:117` a later assignment overwrites an earlier plaintext-removal failure, so `save` reports success while a plaintext session remains | Confirmed, and worse than described. `removePlaintextCopies` assigned each failure over the previous one, so two failed removals reported only the second, and the ciphertext path then replaced the whole message with the stash notice, which is null on the happy path | The removal returns every failure, the save collects them with the stash notice, and `lastError()` names each copy that is still on disk |
| `index.ts:977` the refresh callback writes any completed refresh over the current session's cookie | Confirmed, and the root cause is one level up. `AuthManager.refresh()` saved the response without checking that the session it refreshed is still the current one, so a replaced session was also stored, not just written to the cookie | `refresh()` is single flight and drops a response when the store no longer holds the refresh token the request used. The callback cannot hear about a replaced session, because a discarded refresh never reaches it |

The auth manager had no test file. A new one covers the five behaviours that
matter here: a current refresh is stored and reported, a refresh that finished
after another account signed in is dropped, one that finished after a sign-out
is dropped, callers arriving together make one request, and a later call starts
a new request. Removing the guard and the single flight fails three of them.

The session store now writes its temporary files through the same
`writeCredentialTempFile` helper as the other two stores, which closes the
partial-write gap CodeAnt reported for `file-secret.ts` in the same class of
code, so all three credential writers behave alike.

Gate results: biome 968 files clean, typecheck pass, vitest 98 files / 1817
passed with 1 skipped, `test:node` 57, contracts 382, runtime-client 43, lint
clean, both ratchets pass, native check `claims_ok: true`, skills 50 of 50
locked plus 2 unrecorded.

### SonarCloud on `0c56366` (2026-09-21)

Quality gate OK: 0 bugs, 0 vulnerabilities, 0 open issues, 0 new code smells,
4849 new lines and 0 duplicated lines in them (0.0%). The acceptance the human
set for this step holds on the head that carries the ninth round, including the
two critical fixes and the new auth manager tests.

## Tenth review round, CodeAnt AI on `6f35a8c` (2026-09-21)

Five findings, all confirmed. Two of them are in the external Claude CLI
renewal path, which is the one place this branch writes a store it does not own,
so a wrong store decision there is costly. Every fix has a test that fails
without it except the two that need a running app or a mock of the whole
exchange path, which are noted below.

| Finding | Verdict | Change |
| --- | --- | --- |
| `auth-store.ts:39` the saved user record is only checked as a non-null object, so an array or wrong-typed field reaches callers as a user | Confirmed. `typeof [] === "object"`, so an array passed, and `{ id: 7 }` passed as well | The user record is parsed field by field. `id` and `email` must be strings, the other three must be a string or null, and an absent optional field reads as null so a file an earlier version wrote stays readable |
| `agents-credential-storage-tab.tsx:201` the plaintext-consent switch has no accessible name | Confirmed. The visible text sat in a `span`, which labels nothing, so a screen reader announced an unnamed switch | The text is a `label` pointing at the switch's `id`, and the helper text is wired through `aria-describedby`. No visual change |
| `index.ts:203` overlapping sign-in exchanges can let an older response write the cookie after a newer session is stored | Confirmed. The exchange path removed and rewrote the cookie without checking that the session it just stored is still the one the manager holds | The cookie is written only while `getAuth()?.token` matches the token this exchange returned, so a superseded exchange leaves the newer session's cookie alone. Guarded by inspection, since the path needs a running app and a deep link |
| `claude-token.ts:221` the Windows reader reads the credentials file but reports the source as the credential store | Confirmed. The Windows branch of `readFromKeychain` reads `~/.claude/.credentials.json`, so every Windows refresh was refused as unwritable even though the file is exactly what the platform can write | `credentialSourceForRead` reports what the reader actually read, so a Windows read is file-backed |
| `claude-token.ts:365` a file-backed credential on macOS is written to the keychain, so the refresh fails when the file is the only usable store | Confirmed, and it also breaks the rule the same file states. The permission check returned true for any file-backed credential on macOS, then the write went to the keychain | The write targets the credential's own store, and the plaintext permission is checked for a file-backed credential on every platform. The platform seams take an explicit platform so both halves are tested on one machine |

Gates: biome 968 files clean, typecheck pass, vitest 98 files / 1823 passed with
1 skipped, `test:node` 57, contracts 382, runtime-client 43, lint clean, both
ratchets pass, native check `claims_ok: true`, skills 50 of 50 locked plus 2
unrecorded. The renderer bundle build is still killed by this sandbox's memory
limit and `package:mac` still cannot run on Linux, so CI owns both.

### Two more findings, posted while the round was being read

| Finding | Verdict | Change |
| --- | --- | --- |
| `credentials.ts:173` two sessions can overlap, and the runtime holds one value per provider variable, so one session can use another session's newest credential | The value-sharing half is the limitation `docs/protocol.md` 3.1 already states, and the runtime has no session-scoped lookup for a client to work around. The ownership half was a real gap: the ledger tracked ownership per session, so an older session's release still asked to clear a variable the newer session had taken | Ownership is now per provider variable, keyed by the session and generation that wrote it. A variable another session took is not clearable by the older session, and a session the ledger never saw cannot clear a variable someone else holds. The doc comment records that this mirrors the newest-writer-wins rule the runtime enforces |
| `keyed-store.ts:213` files set aside as `.unreadable-*` are never removed, so credential bytes stay on disk | Confirmed. Nothing in the app removed them, and no keyring this build has can read them | Removing the last stored secret removes those copies, since the store is being emptied on purpose. Removing one key of several leaves them, because they may hold the values of the secrets that remain and a later keyring could read them. Two tests cover both halves |

Gates after both: biome 968 files clean, typecheck pass, vitest 98 files / 1825
passed with 1 skipped, `test:node` 59, contracts 382, runtime-client 43, lint
clean, both ratchets pass, native check `claims_ok: true`, skills 50 of 50
locked plus 2 unrecorded. Both fixes fail their tests when reverted.

## Eleventh pass, the gates after the two late fixes

SonarCloud raised two new minor smells on the rewrite from `dd2036d`, one in each
file. Both asked for an existing check to be written more directly rather than
pointing at a defect: `auth-store.ts` normalised an absent optional user field in
two branches where `??` says it in one, and `credential-ledger.ts` reached into a
slot on both sides of an absence check. `f718d14` and `e93c977` make those two
expressions direct, and the behaviour is unchanged: `auth-store.test.ts` stays at
22 passing and the ledger node tests stay at 17. SonarCloud on `e93c977` reports
the quality gate passed with zero new issues, zero hotspots, and 0.0% duplication
on new code (bot comment 5765072838, 17:56Z).

CodeAnt's SAST gate failed on `dd2036d` and again on `e93c977` with four findings
in `src/main/index.ts`. The findings do not match the code:

| Finding | What the line holds |
| --- | --- |
| `115` CRITICAL, auth-bypass-falsy-password-check | `if (Number.isFinite(expiry) && expiry <= Date.now()) {`. No password anywhere in the repository: `grep -rn "currentPassword"` finds nothing, and no file under `src/main` mentions a password |
| `131`, `140`, `171` LOW, sensitive-data-in-logs | The three `console.warn` calls that report a failed cookie set, removal, or restore. Each logs the thrown Electron error, which carries the API's message; the token is not a field on those calls |

`dd2036d` does not touch `src/main/index.ts` at all, and the same lines passed the
same gate at `6f35a8c` with "Rating S: No issues". The base tree at line 115 holds
`if (planData)` and `origin/main` holds `const planData = await
authManager.fetchUserPlan()`, so the rule name cannot be about this code on either
revision. The gate failed at `6f35a8c` for an unrelated reason, "Bugs: Rating C",
which is what a scanner that answers differently on the same bytes looks like. The
dispute is posted on the pull request as comment 5764897677. The rest of that
gate passes here: no secrets, no duplicate code, rating S for bugs and IAC, and
100% test coverage.

The Rust handoff cannot be compiled in this sandbox and CI has no cargo job, so
the patch was checked by reading it against the tree it plugs into:
`load_api_key_from_env_or_config` consults `ephemeral::lookup` before it reads the
provider file, `is_safe_env_key_name` is the same guard the persisted path uses,
and `pub mod ephemeral` is declared in `lib.rs`. The pull request previously said
CI owns the Rust compile check, which was wrong, and now says a human with a Rust
toolchain does.

Gates on `e93c977`: biome 968 files clean, `tsc --noEmit` clean, vitest 98 files
with 1825 passed and 1 skipped, `test:node` 59, contracts 382, lint 913 files
clean, both ratchets pass, runtime-client 43, native check `claims_ok: true`, and
skills 50 of 50 locked with 2 unrecorded. GitHub CI is green on that head apart
from the CodeAnt gate described above.

## Round eleven, the review that verified the last round

CodeAnt answered the ten findings of the previous two rounds with one verification
per thread, each marked "verified this suggestion was addressed in subsequent
commits" as of `e93c977`, and approved that head. Two of its ten replies cover the
two late findings, so every thread is now resolved and the audit keeps the count
at zero open.

The one item that was still open came from CodeRabbit's review of `4f0572b2d`,
posted outside the diff and therefore answered nowhere: `docs/protocol.md`
section 5 said credentials cross the protocol only as reference operations and
never as values in call arguments, while `set_api_key` and the reserved
`set_ephemeral_api_key` both carry the value in the request. The invariant now
names the two credential-update requests and keeps the reference-only rule for
every other operation, and the clause about logs, telemetry, crash reports and
persisted transcripts covers any other persisted frame. Section 3.1 states the
same rule for the reserved extension from the other direction. This is a wording
correction in a document this change extends, not a change to behaviour.

CodeRabbit itself will not review this pull request again: its own status on every
head reads "Review skipped: bot user not eligible for review", so the review the
human triggered at 17:16 produced nothing. Sourcery refuses the diff for size.

## Round twelve, the nitpicks list

CodeAnt keeps a second comment beside its reviews, the nitpicks list, and four
suggestions sat in it from the round it ran on `6f35a8c`. Three were real and are
fixed in `efa8330`; the fourth is declined with the reason recorded here.

| Nitpick | Verdict | Change |
| --- | --- | --- |
| The protection card shows a refusal reason while the status query is still running | Confirmed. `protectedByOs` is false until the query answers and the missing data fell through to `describeRefusal`, so the card read "Checking the OS keyring..." above a sentence saying the keyring could not be read | `protectionDetail` says it is reading the state while the query runs, reports the query's own message when it fails, and only then states a verdict |
| A refused or failed sign-in save is labeled "Unreadable" | Confirmed. `AuthStore.lastFailure` is set by saves, reads, migrations and removals, and the sign-in row labeled all four the same way | The row names its own failure. The provider rows still say "Unreadable", because their failures come from `providerReadErrors`, which only reports reads |
| Any value in the app store is labeled "Moved to the app store" | Confirmed. The status lists the keys the store holds, whether they were migrated from browser storage or written there directly | The row says "In the app store" or "Nothing saved", and the caption counts the provider values the store holds without claiming where they came from |
| Each session keeps a ledger entry for the process lifetime | Declined. The generation number must never be handed out twice: a release from an older turn can be queued after the same session's newer turn has written its keys, and a reused number would make that release clear the newer keys, which is the defect the numbering was added to fix. One string and one number per session is the price, and the comment on the map now says so | Comment on `generations` |

## Round thirteen, four findings on the cookie, the protocol and the release

CodeAnt reviewed `8642017` and left four findings. Three are fixed in the same
commit; the fourth is fixed one step further than the finding asked.

| Finding | Verdict | Change |
| --- | --- | --- |
| `src/main/index.ts:168` a stale continuation can recreate the signed-out session's cookie | Confirmed. The session was checked, then the cookie was written, and a sign-out or a newer sign-in landing during the write left the older token in the store | `writeDesktopTokenCookie` re-checks the store after the write. When the saved session changed, the token it wrote is taken back and the saved session's own cookie is written in its place, so the cookie matches the store instead of an account the app has left. The same step now runs on all three cookie paths: startup restore, the deep-link exchange, and the refresh callback, which had the same window and was not reported |
| `docs/protocol.md:86` the registry does not always prefer an ephemeral key, because the inherited environment is checked first | Confirmed by reading `load_api_key_from_env_or_config`. The environment is read before `ephemeral::lookup`, and before the provider file | The section now states the whole order: process environment, then a held key, then the provider file, and says plainly that a key handed for a variable the daemon inherits is not the one that takes effect. The claim about the two stores keeping a held key ahead of the provider file stands on its own |
| `docs/protocol.md:97` the persistence invariant is not enforced by the protocol, because message and tool-output fields are free-form | Confirmed as a wording problem. The invariant read as though the wire format carried the guarantee | The bullet is split. One rule says which requests carry values, the other says implementations keep key material out of logs, telemetry, crash reports, persisted transcripts and any other persisted frame, and names the reason the redaction lives there: the wire format cannot inspect free-form message content or tool output |
| `src/main/lib/runtime/trpc/routers/runtime.ts:262` the release is fire-and-forget, so a transient daemon failure leaves the key held | Confirmed. The turn that asks for the release has already ended, so nothing goes back for the key, and the daemon holds one value per provider variable for its whole life | The release now retries a retained provider up to three times, 250ms apart, re-planning each time through the ledger, which is what keeps ownership of a key the daemon did not clear. After the last attempt the provider stays owned exactly as before, so a later release can still try |

The environment precedence has a consequence worth recording: when the daemon
inherits `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, the app still hands over the
stored token for that provider, and the daemon uses the environment value
instead. Kept as it is, because the effective value is the same either way and
changing which one the app offers would change what the turn reports. The
protocol section now says so rather than leaving it to be discovered.

Gates on the tree with all four: biome 968 files clean, `tsc --noEmit` clean,
vitest 98 files with 1825 passed and 1 skipped, `test:node` 59, contracts 382,
lint 913 files clean, both ratchets, runtime-client 43, native check
`claims_ok: true`, skills 50 of 50 locked with 2 unrecorded. The release retry is
not unit-tested: `credentials.ts` imports the database module, which the node
test runner cannot strip, so that path stays E4 and needs a daemon that answers
`set_ephemeral_api_key`. The ledger contract the retry loop relies on is covered
by the retained-provider test.

## Round fourteen, five findings on the cookie and the store writes

CodeAnt reviewed `ac40492` and left five findings, all Major. All five were real
and all five are fixed here.

| Finding | Verdict | Change |
| --- | --- | --- |
| `index.ts:163` `setDesktopTokenCookie` swallows the cookie-store failure, so the settle step reports success with no cookie in place | Confirmed. The function caught the `cookies.set` rejection, logged it and returned nothing, so the caller's `true` meant "the session is still saved", not "the cookie is there" | `setDesktopTokenCookie` returns whether the store accepted the write, and the settle step returns false when it did not. An expired token still removes the cookie and now reports that it wrote nothing |
| `index.ts:193` a startup refresh that ends in a sign-out leaves an older persisted cookie behind | Confirmed. `getValidToken` can fail into `logout()` inside a 401 refresh, and the continuation returned on a null token without touching the cookie an earlier version wrote with an expiry | When the token resolves to null and the manager is no longer authenticated, the cookie is removed before the continuation ends |
| `file-secret.ts:62` a failed `renameSync` leaves the temporary ciphertext behind | Confirmed. The read-back was inside the try and the rename was outside it, so a rename failure threw past the cleanup | The rename has its own handler that removes the temporary file and rethrows. The temporary file holds the credential, encrypted, under a name no read uses |
| `file-secret.ts:91` a failed plaintext companion write after the stash leaves neither value at the path reads use | Confirmed. The old ciphertext was moved aside so the new plaintext value could load, and a failed companion write threw with the old bytes stranded under a recovery name | The write restores the stashed file at the original path before rethrowing, the same shape `writeKeyedSecret` uses |
| `agents-credential-storage-tab.tsx:232` a status query that failed states a keyring verdict it never reached | Confirmed, and the earlier nitpick fix covered only the sentence, not the headline or the inventory rows. With no data the flags are false, so the card said the OS cannot encrypt new credentials and the rows said a new sign-in is refused | Both cards take the unknown state from the tab. The headline, the sentence, the sign-in row, the provider row and the browser-storage row all say the state is not known while the query has no result, and the failed query's own message is shown when there is one |

Tests for the two store fixes are in `temp-write-failure.test.ts`, which already
interrupts a write partway: 6 tests there now, 2 new. The rename test makes the
next rename from a temporary file fail and asserts no temporary file survives and
the previous value still loads. The stash test fails the companion write after
the stash and asserts the old file is back at the read path with no
`.unreadable-*` copy left. Reverting each fix separately fails its own test and
no other.

The cookie fixes are E4: they need a running app with a sign-out or a failed
cookie write landing inside the window, and there is no main-process test
harness here.

Gates: biome 968 files clean, `tsc --noEmit` clean, vitest 98 files with 1827
passed and 1 skipped, `test:node` 59, contracts 382, lint 913 files clean, both
ratchets, runtime-client 43, native check `claims_ok: true`, skills 50 of 50
locked with 2 unrecorded.

## Round fifteen, the settle step, the decoder and a stale answer

CodeAnt reviewed `dac468b` and left three findings. All three were real and are
fixed here.

| Finding | Verdict | Change |
| --- | --- | --- |
| `index.ts:173` CRITICAL the fallback cookie write is not serialized, so an older continuation can restore a token after the session changed | Confirmed, and it was two gaps. The first write was settled against the store, but the fallback write after it was not, so a logout landing during that write left the cookie behind. Nothing serialized cookie work either, so two writers could interleave their remove and set | Cookie work now runs one task at a time through a queue, and `writeDesktopTokenCookieNow` settles in a loop: each round writes the cookie for whatever session the store holds and checks again, up to three rounds. A session that keeps changing takes the cookie back rather than leave one that may belong to an account the app has left. The direct `...Now` helpers run inside a task, the queued ones only from outside, so nothing waits on itself |
| `owner.ts:228` `Buffer.from` ignores invalid base64, so malformed database text can decode into readable bytes and be returned as a credential | Confirmed by probe. `Buffer.from("aGVsbG8=!", "base64")` drops the stray character and yields "hello", which `decodeBytes` returns as a plaintext credential because the bytes are valid UTF-8 | `isCanonicalBase64` requires the text to be exactly a base64 encoding of the bytes it decodes to, accepting an unpadded payload because it carries the same bytes. Text that fails is refused with a typed error instead of being read as whatever the decoder made of part of it, and the status reader reports it as unknown rather than describing it |
| `agents-credential-storage-tab.tsx:60` after a failed refetch the cached data keeps `unknown` false, so stale protection and inventory read as current beside a separate error | Confirmed. A failed query keeps the previous answer in the React Query cache, and only a missing result was treated as unknown | `unknown` is true while there is no result or the query is in an error state, so the headline, the rows and the sentence all say the state is not known, and the query's own message is what the sentence shows |

Tests: `owner.test.ts` gains one, 15 there now. It asserts that the payload with a
stray character is refused, that its inspection is unknown, and that the same
text without the stray character still reads as the legacy plaintext value this
store writes. The test was written first and failed against the unfixed code.

The cookie serialization and the settle loop are E4: they need a running app with
a sign-out landing inside a cookie write, and there is no main-process test
harness here. The renderer change is E4 for the same reason.

Gates: biome 968 files clean, `tsc --noEmit` clean, vitest 98 files with 1828
passed and 1 skipped, `test:node` 59, contracts 382, lint 913 files clean, both
ratchets, runtime-client 43, native check `claims_ok: true`, skills 50 of 50
locked with 2 unrecorded.
