# Centralize app-held secrets and require plaintext consent

## Why

The application has six direct Electron encryption importers and additional secret writers that never use them. Centralizing the import alone would leave renderer localStorage, native runtime files, refreshed CLI credentials, persistent cookies, and temporary provider files outside the policy.

The [inventory](../../../.dump/app/research/2026-09-13-secret-owners.md) is authoritative for the investigated base. The existing decoder also chooses its format from current keyring availability. Mocked execution reproduced unreadable legacy plaintext after keyring recovery and ciphertext returned as text after keyring loss.

## What changes

- Make `src/main/lib/secret-storage/` the only app encryption and secret-persistence policy owner, with `auth-store.ts` as the sign-in consumer. Keep `src/main/lib/token-crypto.ts` as a thin re-export and retain existing provider file names and attribution.
- Refuse new, replacement, copied, and refreshed secret writes when encryption is unavailable unless explicit plaintext consent permits them. Linux `basic_text` is not protected encryption. An encryption exception does not trigger a silent fallback.
- Keep existing reads and files unchanged on read. Decode from the stored representation rather than current keyring availability, and report unreadable ciphertext without treating it as plaintext.
- Persist consent in app-owned metadata without a database migration. Apply consent only to future writes. Keep the existing schema unless implementation research proves a marker column is necessary.
- Replace new renderer raw-secret persistence with app-owned credential references. Keep a read-only compatibility path for untouched legacy slots.
- Give credential storage its own settings destination, as the human approved. Show current backend or failure reason, write policy, consent state, and separate storage facts about existing credentials. Refused writes link to that destination without losing unsaved input or stacking dialogs.
- Remove token previews and lengths. Redact at actual console, file, and error boundaries, not only through an unused serialization helper.
- Remove secondary plaintext writes caused by app-held credentials. The native runtime binary ships as an npm optional dependency (`packages/runtime-client/src/binary.ts:1-46`, `launch.ts:519`), so a vendored Rust patch cannot reach it. The app therefore clears the runtime's plaintext provider files before the daemon starts and after it stops, holding the exposure window to the daemon's life, and the memory-only handoff is reserved in the vendored protocol (`docs/protocol.md` 3.1, `jcode-provider-env::ephemeral`) for a runtime release. The app requests the memory-only path only when a daemon advertises `ephemeral_api_key`, and the loader prefers a held key over the provider file so a stale file cannot shadow it.
- Preserve Anthropic OAuth dual writes and existing app/provider file layouts. Check write policy before remote exchange or refresh can invalidate the previous credential, then recheck before local persistence after asynchronous work.

## Approval status

The human approved preserving reads while gating writes and selected the dedicated settings page. They reassigned step 11 to this session after closing PR #67.

The human also approved keeping automatic renewal of external CLI credentials under a narrow exception. `claude-token.ts` may still refresh those credentials, but the central owner must authorize and perform writes to the existing external store. Plaintext file updates require consent before the remote refresh begins, even when the OS keyring protects app-owned files. Do not fork a rotating refresh token into independent app and CLI stores.

Implementation landed on `arena/01a0c098-mauscode` (2026-09-20). Verified: bundled-runtime behavior, refusal and consent paths, legacy reads, redaction, and the static gates.

The pinned native protocol explicitly defines `set_api_key` as a persistent file write, and its tests assert that behavior. Changing that existing request to memory-only would silently break the upstream contract. The proposed fix is an additive, capability-negotiated memory-only credential handoff for mausCode, leaving the existing request intact for standalone upstream clients. Credentials must be scoped to the consuming runtime session and omitted from debug serialization. A runtime without that capability must refuse the app-held-key path with a concrete upgrade requirement, never fall back to the disk-writing request.

The vendored protocol additions are additive and inert in this release: `set_ephemeral_api_key` and `clear_ephemeral_api_key` are defined in `jcode-harness-api`, the registry and loader preference live in `jcode-provider-env::ephemeral` with unit tests, and `docs/protocol.md` 3.1 records them as reserved. The runtime the app spawns answers `unknown_request` for both and stays connected, which the app treats as "use the clearing path". Threading the request through the bridge into the daemon process, and advertising the capability once that is done, remain runtime-release work that needs a Rust toolchain; cargo is absent in this environment, so nothing here claims compilation.

## Impact and boundaries

The implementation touches the app store, provider file wrappers, credential routers, auth refresh callers, renderer credential state and its consumers, logging sinks, runtime credential handoff, tests, and settings navigation. The change list is derived from the inventory rather than the stale issue-bot plan.

No new application dependency or lockfile change is planned. No generated migration, CSP widening, preload expansion, remote origin, telemetry, or provider OAuth/device-auth screen redesign is permitted. MCP credential changes remain owned by step 28.

## Verification

Require encrypted round trips, refusal and consent paths, consent revocation, persistence failures, legacy reads, keyring changes, malformed metadata, simultaneous refresh and consent changes, restart recovery, and real log-sink redaction tests. Verify that references rather than raw secrets survive renderer persistence and that native and temporary-file paths do not reintroduce disk writes.

Run all AGENTS gates on the final diff with the required heap setting. Run the Linux disabled-keyring connect/restart/disk inspection and the final-diff research gate. The current browser evidence covers only the comparison prototype, not these application requirements.

## Rollback

Reverting the code changes does not remove or encrypt consented plaintext already on disk. The user must remove it. Preserve untouched legacy reads and document any new representation's downgrade limit before implementation approval.
