# Tasks

## Research and approval

- [x] Verify the requested base and session branch.
- [x] Record the approved preserve-reads and gate-writes policy.
- [x] Build local settings options and record the dedicated-page approval.
- [x] Run prototype browser checks and keep their evidence separate from app verification.
- [x] Finish the secret inventory's remaining consumers and tests. Every store, reader, writer, and transient is listed in `.dump/app/research/2026-09-13-secret-owners.md` with an owner; the CLI-owned temp file and plaintext CLI store are recorded as external with their permissions.
- [x] Obtain the external CLI refresh ownership decision. Keep automatic renewal under an explicit owner-gated exception.
- [x] Obtain the native scope decision after the binary finding: app-side cleanup now, protocol reserved in the vendored tree, labelled unshipped.
- [x] Finalize and approve the security design, including stored-format compatibility.
- [x] Establish that the shipped runtime binary comes from an npm optional dependency, so a vendored Rust patch cannot change it (2026-09-20, `packages/runtime-client/src/binary.ts:1-46`, `launch.ts:519`). Human approved the split: app-side cleanup now plus the reserved protocol.
- [x] Verify the runtime persists `set_api_key` as `$JCODE_HOME/config/jcode/anthropic.env` (0600) and answers `set_ephemeral_api_key` with `unknown_request` while staying connected (`.dump/app/audits/2026-09-20-native-credential-check.json`).

## Owner and consumers

- [x] Consolidate encryption, consent, legacy reads, atomic persistence, and redacted credential representation in `src/main/lib/secret-storage/` with an injected keychain (`store.ts`, `owner.ts`, `metadata.ts`, `keyed-store.ts`, `file-secret.ts`).
- [x] Make `src/main/lib/token-crypto.ts` a thin re-export; `auth-store.ts` keeps its public surface with an injected writer.
- [x] Route the three provider file stores and all database credential writers through the owner; existing database readers keep the legacy representation readable.
- [ ] Preserve Anthropic dual writes and check policy before refresh or token exchange.
- [x] Replace new raw renderer persistence with owner-held references (`src/renderer/lib/renderer-secrets.ts`) while keeping untouched legacy browser-storage reads and moving them only after a confirmed write.
- [x] Remove the secondary runtime and cookie secret writes after tracing all named consumers.
  - The persistent `x-desktop-token` cookie is now a session cookie written by one helper (`src/main/index.ts:111`), re-issued at startup from the encrypted session and on refresh, and removed when the stored token has already expired, so no token stays in the on-disk cookie store. Removing an older persisted cookie on the next login covers installs that already have one.
  - The runtime's plaintext provider files are cleared before the daemon starts, failing closed when a file cannot be removed, and after it stops (`src/main/lib/runtime/credential-files.ts`).
- [ ] Remove the temporary plaintext provider write on the Cline custom-endpoint path.
  - `src/main/lib/cline-print/auth-config.ts` writes `settings.apiKey` into an isolated `providers.json` for the CLI run and removes it afterwards; the file is 0600 and never touches the user's real `~/.cline`, but a crash can leave it behind. The cleanup sweep is the remaining work (`.dump/app/audits/2026-09-20-secret-storage-verification.md`).
  - Files the external CLIs own stay external in the inventory; that record already names them and their permissions.
- [x] Implement the approved external CLI refresh behavior without changing OAuth screens: pre-refresh permission check, single-flight refresh, no forked token stores.

## Settings and logging

- [x] Add the dedicated Credential storage settings page and tRPC status/consent procedures (`src/main/lib/trpc/routers/secret-storage.ts`, `agents-credential-storage-tab.tsx`).
- [ ] Distinguish current write policy from existing plaintext and inaccessible ciphertext.
- [ ] Preserve unsaved input on refusal, avoid nested modals, and verify Escape behavior.
- [x] Install redaction at actual logging boundaries (`redact.ts` at the raw Claude JSONL logger) and remove token-derived diagnostics from `claude.ts`.
- [ ] Remove dead secret-returning APIs only after proving there are no consumers.

## Verification and delivery

- [x] Add unit tests for refusal, consent, legacy formats, the keyed store, redaction, and private-file cleanup (30 vitest plus 5 node tests).
- [ ] Verify the private-file cleanup inside the running app, and on Linux with the keyring disabled.
- [ ] Measure storage-operation and startup cost against the base.
- [x] Run the AGENTS static gates, tests, and security checks on the final diff. Install (frozen), the runtime-client build, Biome, both typecheck gates and their ratchets, vitest, the node runtime tests, the contract tests, the dependency audit, and skills verification are green, with the evidence record in `.dump/app/audits/2026-09-20-secret-storage-verification.md`.
- [ ] Run the shipping gates locally. `build` cannot finish in this sandbox (the renderer chunk runs out of memory) and `package:mac` has no Electron binary here. CI runs `bun run build` on three operating systems and the unsigned packaging matrix (`.github/workflows/ci.yml`); record the terminal results for the final head before calling these done.
- [ ] Run the real Linux disabled-keyring connect/restart/disk inspection.
- [ ] Run the six UI delivery gates against the application, not only the prototype.
- [ ] Run final-diff code research and up to three self-review passes.
- [ ] Complete inventory, grep reduction, rollback, decisions, verification, and handoff records under `.dump/app/`.
- [ ] Open the PR from `arena/01a0c098-mauscode` to `arena/01a097c4-mauscode`, link issue #13, and post the issue backlink when GitHub permissions permit.
- [ ] Watch every head check until terminal and poll for late review findings. Fix verified findings and rerun the required gates.
