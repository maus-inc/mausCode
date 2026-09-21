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
