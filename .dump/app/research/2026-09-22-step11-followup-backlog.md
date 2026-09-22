# Step 11 follow-up backlog, 2026-09-22

Everything here was deliberately kept out of pull request 68. The PR merged the
storage policy, the settings page, and the runtime mitigation; these are the
items recorded along the way as real but out of scope, plus the one conditional
fix waiting on a review decision. Order is suggested priority, not commitment.

## 1. Four login pages say "stored encrypted" when the store may hold plaintext

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

## 2. The daemon's supervised crash-restart skips the credential-file clear

`RuntimeManager` restarts a crashed daemon with backoff
(`runtime/manager.ts`, the `restarts` path around the `start()` recall) and
that restart never passes the two clear points: manager creation
(`runtime/index.ts:59`) and shutdown (`:86`). A plaintext provider file the
crashed daemon wrote can therefore stay on disk until the app quits, which is
the known gap the PR body names. The fix belongs in the manager's restart
seam, before it calls `start()` again: run the same fail-closed
`clearPrivateCredentialFiles` the creation path runs, because the app
re-applies credentials for every turn and nothing needs to survive.

## 3. Eleven error boxes sit on `text-destructive` at about 3.4:1

Seven `*-login-content.tsx` boxes at `text-xs`, `claude-login-modal.tsx`,
`onboarding-error.tsx`, and two setup-error boxes at `text-sm` all use
`border-destructive/20 bg-destructive/10 text-destructive`. The credential
tab already proved the alternative (`text-red-600 dark:text-red-400`). The
decision to record in DESIGN.md is between extending that pattern surface by
surface and lifting the `destructive` token itself to a 700/400 step pair the
way the status pill did.

## 4. Two older status pills still sit on the 600 step

`all-projects-page.tsx:96` at 11px and `agent-diff-view.tsx:142` use the
600-step wash the pill decision measured as failing (2.95:1 to 4.23:1). The
sanctioned values from `decisions/2026-09-22-status-pill-step.md` are 700
light and 400 dark with the mute at `text-foreground/60`; these two are the
only surfaces left short of it.

## 5. `removePlaintextCompanion` failures are log-only

`file-secret.ts` reports a companion it could not remove with `console.error`
and nothing else. A plaintext companion that survives an encrypted write is
the kind of remnant step 11 exists to eliminate; the failure should surface
in the storage status or the sign-out warnings the auth store already
collects, so the user learns the file is still there.

## 6. The release retry in `runtime/credentials.ts` stays an E4 audit item

The retry path imports `../db`, which `node --test --experimental-strip-types`
cannot load, so it has no binary-free test. Either rework the import or move
the case into the vitest suite; the handoff is labelled unshipped until a
jcode release carries it, but the seam should still be tested.

## 7. The memory-only handoff protects nothing until a runtime release adopts it

The vendored Rust patch is additive and capability-negotiated, the upstream
`set_api_key` disk semantics stay intact for other clients, and the key
registry holds one value per provider variable rather than per session
(`docs/protocol.md` 3.1). The residual risk is stated in the PR; the action is
coordination with whichever jcode release lands first, not more code here.

## 8. The manual keyring-disabled pass still needs a running app

Connect, restart, and disk inspection on Linux with the keyring disabled were
always human- or running-app-owned; static gates cannot exercise them. This is
the verification the step file asks for and the sandbox cannot provide.

## 9. Conditional: a credential-keyed single-flight, only if the rebuttal is rejected

CodeAnt's scan of `df2b0d4` called the shared `refreshInFlight` promise a
cross-account race. The rebuttal stands: this OS user holds one Claude
credential and there is no account selector in the path. If the reviewer
rejects that argument anyway, the insurance is cheap: replace the singleton
with a `Map` keyed by the credential the refresh belongs to, so a shared slot
is impossible by construction.

```ts
const refreshesInFlight = new Map<string, Promise<string | null>>()

const key = `${source}:${creds.refreshToken}`
const existing = refreshesInFlight.get(key)
if (existing) return existing
const promise = refreshLocalClaudeToken(creds, source).finally(() => {
  refreshesInFlight.delete(key)
})
refreshesInFlight.set(key, promise)
return promise
```

Same token, same slot, so two different credentials can never share a
refresh; the refresh token as a key is already held in memory by the same
structure. Do not implement this unless the rebuttal is rejected, because
implementing it now would concede a point the code does not owe.

## 10. Optional polish: the Claude custom-config save gives no visible message on refusal

`agents-models-tab.tsx`'s blur save for `customClaudeConfigAtom` does not
await the write result, so a refusal reverts the fields (the storage puts the
confirmed value back, landed in `fc6bcae`) without a toast. Honest, but
silent; a `whenRendererSecretSaved` await with the same toast pattern the
codex and openai flows use would finish it.
