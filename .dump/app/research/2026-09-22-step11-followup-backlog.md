# Step 11 follow-up backlog, 2026-09-22

Everything here was deliberately kept out of pull request 68. The PR merged the
storage policy, the settings page, and the runtime mitigation; these are the
items recorded along the way as real but out of scope. Order is suggested
priority, not commitment.
A deep independent review of PR 68 on 2026-09-22 re-prioritized this list: the
crash-restart clear hole and the `removePlaintextCompanion` surfacing moved to
the top because the reviewer called them the two items with real security or
user-visible weight, and the three low findings it logged are folded in below.

## 1. The daemon's supervised crash-restart skips the credential-file clear

`RuntimeManager` restarts a crashed daemon with backoff
(`runtime/manager.ts`, the `restarts` path around the `start()` recall) and
that restart never passes the two clear points: manager creation
(`runtime/index.ts:59`) and shutdown (`:86`). A plaintext provider file the
crashed daemon wrote can therefore stay on disk until the app quits, which is
the known gap the PR body names. The deep review rates this the highest
priority item because it is an actual plaintext-at-rest hole, not a polish
gap. The fix belongs in the manager's restart seam, before it calls `start()`
again: run the same fail-closed `clearPrivateCredentialFiles` the creation
path runs, because the app re-applies credentials for every turn and nothing
needs to survive.

## 2. `removePlaintextCompanion` failures are log-only

`file-secret.ts` reports a companion it could not remove with `console.error`
and nothing else. A plaintext companion that survives an encrypted write is
the kind of remnant step 11 exists to eliminate; the failure should surface
in the storage status or the sign-out warnings the auth store already
collects, so the user learns the file is still there. The deep review pairs
this with item 1 as the second priority, because a leftover plaintext file the
user is never told about defeats the whole point of the migration.

## 3. Four login pages say "stored encrypted" when the store may hold plaintext

`cline-login-content.tsx:216`, `openclaw-login-content.tsx:193`,
`qwen-login-content.tsx:209`, and `roo-login-content.tsx:193` each tell the
user the key is stored encrypted on this device, with the same claim in their
hooks' module comments. Each save goes through `trpc.<provider>.saveCredentials`
into `encryptToken`, and `encodeForDatabase` returns the base64 of the
plaintext when plaintext consent is granted and no keyring is usable
(`secret-storage/store.ts:78-82`). The sentence is false in exactly the state
the Credential storage page's own banner describes. It is not a regression,
the four pages are outside PR 68's diff, and the wording is a product
decision: either a neutral claim ("stored by the app's secret store on this
device") or a live claim driven by the storage status the page already
exposes.

## 4. Keychain reads and writes block the main process

`electron-keychain.ts` is the only module that calls Electron `safeStorage`,
and every method it wraps, `isEncryptionAvailable`, `encryptString`,
`decryptString`, and `getSelectedStorageBackend`, is synchronous and runs on
the main process. Each credential read or write therefore blocks the main
process while the OS keyring is consulted. This is pre-existing and not
introduced by PR 68, and Electron offers no asynchronous `safeStorage` API, so
the honest options are to move credential work off the critical path or to
measure how long the keyring calls actually take before optimizing. Recorded
as the deep review's low finding rather than fixed here because it predates
the PR and has no observed symptom.

## 5. The credential ledger's `generations` map is never cleaned, on purpose

The deep review logged this as a low finding: `runtime/credential-ledger.ts:53`
keeps a module-level `generations` map keyed by session id that
`beginCredentialTurn` grows (`:97-98`) and nothing deletes. Checked against the
code and the earlier review record, this is deliberate, not a leak to fix. A
generation number must never be handed out twice: a release from an older turn
can be queued after the same session's newer turn has already written its keys,
and a reused number would make that stale release match the newer keys and
clear them. Pruning the map is what would reintroduce the defect the numbering
exists to prevent. One short string and one number per session for the process
lifetime is the stated price of that guarantee, and the comment at `:47-53`
records it. This finding was already declined on 2026-09-21 for exactly this
reason. No action; do not prune.

## 6. The release retry in `runtime/credentials.ts` stays an E4 audit item

The retry path imports `../db`, which `node --test --experimental-strip-types`
cannot load, so it has no binary-free test. Either rework the import or move
the case into the vitest suite; the handoff is labelled unshipped until a
jcode release carries it, but the seam should still be tested. The deep review
flags the same spot as its fire-and-forget retry finding: a release that fails
once is retried without a durable record, so a gap between the last attempt and
process exit is not surfaced.

## 7. Eleven error boxes sit on `text-destructive` at about 3.4:1

Seven `*-login-content.tsx` boxes at `text-xs`, `claude-login-modal.tsx`,
`onboarding-error.tsx`, and two setup-error boxes at `text-sm` all use
`border-destructive/20 bg-destructive/10 text-destructive`. The credential
tab already proved the alternative (`text-red-600 dark:text-red-400`). The
decision to record in DESIGN.md is between extending that pattern surface by
surface and lifting the `destructive` token itself to a 700/400 step pair the
way the status pill did.

## 8. Two older status pills still sit on the 600 step

`all-projects-page.tsx:96` at 11px and `agent-diff-view.tsx:142` use the
600-step wash the pill decision measured as failing (2.95:1 to 4.23:1). The
sanctioned values from `decisions/2026-09-22-status-pill-step.md` are 700
light and 400 dark with the mute at `text-foreground/60`; these two are the
only surfaces left short of it.

## 9. The memory-only handoff protects nothing until a runtime release adopts it

The vendored Rust patch is additive and capability-negotiated, the upstream
`set_api_key` disk semantics stay intact for other clients, and the key
registry holds one value per provider variable rather than per session
(`docs/protocol.md` 3.1). The residual risk is stated in the PR; the action is
coordination with whichever jcode release lands first, not more code here. The
Rust change cannot be compiled in this sandbox, so the `cargo check` it needs
remains owned by the human or a toolchain that has one.

## 10. The manual keyring-disabled pass still needs a running app

Connect, restart, and disk inspection on Linux with the keyring disabled were
always human- or running-app-owned; static gates cannot exercise them. This is
the verification the step file asks for and the sandbox cannot provide.

## 11. Done: the Claude refresh single-flight is keyed by the token it rotates

CodeAnt's scan of `df2b0d4` called the shared `refreshInFlight` promise a
cross-account race. The rebuttal stands as a fact about the data model: this
OS user holds one Claude credential and there is no account selector in the
path. The owner's call on 2026-09-23 was to make the property structural
anyway, because a guard that does not depend on its assumptions is worth more
than the argument that the assumptions hold. The singleton in
`claude-token.ts` is now a map keyed by the source and the refresh token
being rotated. Callers holding the same token still share one in-flight
refresh, which is the guard against rotating one token twice, and callers
holding different tokens can no longer share a slot even in principle. An
entry leaves the map the moment its refresh settles. Two regression tests
drive concurrent refreshes through the real path against a stubbed token
endpoint and hold both properties; the second test fails against the old
singleton, so it pins the change. Landed in the same commit as this record.

## 12. Optional polish: the Claude custom-config save gives no visible message on refusal

`agents-models-tab.tsx`'s blur save for `customClaudeConfigAtom` does not
await the write result, so a refusal reverts the fields (the storage puts the
confirmed value back, landed in `fc6bcae`) without a toast. Honest, but
silent; a `whenRendererSecretSaved` await with the same toast pattern the
codex and openai flows use would finish it.
