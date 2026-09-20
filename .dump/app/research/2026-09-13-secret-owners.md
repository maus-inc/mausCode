# Secret owners

## Current state

Research for roadmap step 11, issue #13, updated 2026-09-20. The investigated base is `8a77cb2a70d9f6a55bea9d822ef87b6641f2d79b` on `arena/01a097c4-mauscode`. MausAgent owns the implementation on `arena/01a0c098-mauscode` after the human closed the overlapping PR #67 and reassigned the work.

The human approved preserving existing reads while gating all new, replacement, and refreshed writes. The human selected a dedicated Credential storage settings page in the [local comparison](2026-09-20-secret-storage-options.html). The human also approved keeping automatic external CLI refresh under a narrow owner-gated exception. Plaintext external-file replacements require consent before refresh starts, even when the OS keyring protects app-owned files. No new storage format or native runtime credential-contract change is approved yet.

`src/main/auth-store.ts` will own all app secret storage decisions and all Electron safeStorage calls. `src/main/lib/token-crypto.ts` will remain a thin compatibility re-export. File wrappers retain attribution and existing names, but not independent crypto or fallback decisions.

The investigation extends beyond the original six-importer grep. Renderer localStorage, native runtime secondary files, temporary provider config, persistent cookies, and external CLI refresh writes can bypass an owner that only centralizes safeStorage imports.

The [verification record](../audits/2026-09-20-secret-storage-verification.md) separates source reads, mocked reproductions, prototype browser checks, and unrun application tests. No application feature has been implemented or demonstrated yet.

## Secret inventory

This table records the investigated base. No application code has changed in this session. Items marked for further tracing prevent this record from claiming a completed inventory audit.

| Secret or path | Store and read/write evidence | Required treatment |
| --- | --- | --- |
| App access and refresh tokens | `src/main/auth-store.ts`, through `src/main/auth-manager.ts`. Existing paths are `auth.dat`, `auth.dat.json`, and legacy `auth.json` under `userData` | Preserve reads and file layouts. Loading currently migrates and deletes plaintext. Reconcile that behavior with the approved preservation policy. Check stale counterpart files after a replacement |
| Anthropic account and legacy Claude credentials | `anthropic_accounts.oauth_token` and `claude_code_credentials.oauth_token`. `anthropic-accounts.ts`, `claude-code.ts`, and `claude.ts` read or write them | Keep OAuth dual writes. Audit `setActive` and `migrateLegacy` copies as writes as well as explicit connects |
| Four API-key credential tables | `qwen_credentials`, `cline_credentials`, `openclaw_credentials`, and `roo_credentials`, with `api_key` text columns | Route all encoding through the owner. Qwen currently calls encryption twice in insert/upsert expressions |
| GitHub, Gemini, and OpenRouter credentials | `src/main/lib/{github,gemini,openrouter}-auth-store.ts`. `userData/data/{provider}-auth.dat` and `{provider}-auth.json` | These are three additional file stores, not database rows. Preserve their names and readers while removing their encryption decisions |
| Custom model key | `src/renderer/lib/atoms/index.ts:233-242`, `customClaudeConfigAtom`, browser key `agents:claude-custom-config`, field `token` | New raw localStorage writes violate the step. Settings and API-key onboarding write this atom. Existing values need a deliberate compatibility read rather than silent deletion |
| Model profile keys | `src/renderer/lib/atoms/index.ts:250-255`, `modelProfilesAtom`, browser key `agents:model-profiles`, field `config.token` | Inspect consumers and legacy usage before deleting or migrating. The offline `ollama` value is a sentinel, not a secret |
| Voice key | `src/renderer/lib/atoms/index.ts:244-247`, browser key `agents:openai-api-key`. Models settings also calls `voice.setOpenAIKey` | The main voice router holds a separate in-memory key. New persistence must use the owner and restart behavior must be tested |
| Codex API key | `codexApiKeyAtom` in `src/renderer/lib/atoms/index.ts`, browser key `onboarding:codex-api-key`. `use-codex-login-flow.ts`, models settings, and ACP transport consume it | Replace raw persistence with an owner-held credential reference. Preserve the existing saved value until a safe, confirmed replacement succeeds |
| Native runtime secondary persistence | `src/main/lib/runtime/credentials.ts:88,95` calls `client.setApiKey`. `packages/runtime-client/src/client.ts:657-658` sends `set_api_key`. `runtime/jcode/crates/jcode-harness-api-server/src/translate.rs:720-765` calls `write_credential` before notifying auth changes | The call is not memory-only. The writer at lines 2024-2058 writes raw key assignments to runtime config files such as `anthropic.env` and `openai.env`. Merely encrypting the app database does not remove this second store. An in-memory handoff or another explicit contract decision is needed |
| Refreshed external CLI credentials | `src/main/lib/claude-token.ts:291-315` refreshes near-expired credentials, then persists them. Lines 244-283 write macOS Keychain or `~/.claude/.credentials.json` elsewhere | This module is not read-only. Do not exclude its writes by calling the whole module an external reader. Preflight before rotating a remote token, preserve untouched external reads, and resolve the step's ban on provider-config writes without redesigning OAuth |
| Cline custom-endpoint temporary key | `src/main/lib/cline-print/auth-config.ts:97-145` writes `settings.apiKey` into a temporary `providers.json`. `src/main/lib/trpc/routers/cline.ts:759-765` supplies it | File mode 0600 and cleanup do not encrypt it. Investigate whether the existing per-run `-k` argument can carry the key while the temporary config holds only the endpoint. Test the CLI contract before removing the field |
| App auth cookies | `src/main/index.ts:129,921`, `session.fromPartition` and `cookies.set` | Inspect Chromium cookie persistence and whether the writes duplicate app-held credentials outside the policy. Do not infer storage semantics from the word session |
| Raw secret query results | `claudeCode.getSystemToken`, `claudeCode.getToken`, and `anthropicAccounts.getActiveToken` return raw credentials. `auth:get-token` in `src/main/windows/main.ts:574-577` returns the app token | Verify callers, remove unused exposure, and use references or presence/status where the renderer does not need the value. Do not widen preload or CSP |
| Runtime handoff values | IPC custom config, ACP `authConfig.apiKey`, native `customToken`, environment variables, provider arguments, HTTP authorization | Inventory these as transient boundaries. Trace the receiving process before claiming the handoff does not persist |
| MCP credentials | MCP OAuth/config files and copied MCP environment/header values | Record only. Step 28 owns changes. Do not use this exclusion for unrelated app-held provider credentials |

## Encoding and failure questions

The base has six direct `safeStorage` importers. They are `auth-store.ts`, `token-crypto.ts`, the three file wrappers, and `routers/claude.ts`. The exact grep has 35 matching lines including comments and schema documentation.

The base `token-crypto.ts` chooses a decoder from current encryption availability, not stored format. An unavailable keyring can turn encrypted bytes into decoded garbage. A newly available keyring can send old base64 plaintext into decryption. Both failures were reproduced with the existing TypeScript module and a fake Electron API on 2026-09-20. This is E3 mock evidence, not a real OS-keyring run. The fake produced a v10-prefixed Buffer and refused non-ciphertext input. No real credential was used.

Electron 39.4.0 checks ciphertext version prefixes `v10` and `v11`. A decrypt failure must not become a plaintext fallback. Test corrupted and truncated ciphertext, unknown encodings, plaintext whose leading bytes resemble an encryption prefix, unavailable or locked keyrings, readiness, exceptions from availability/encryption, and recovery across restart. Final encoding and compatibility decisions remain open. No marker column or migration has been justified.

The owner needs to distinguish current write policy from already stored plaintext. A last-write flag does not establish that every account row uses plaintext or that a recovered keyring re-encrypted older values.

## Logging paths

- `src/main/lib/claude/raw-logger.ts:108-117` appends `JSON.stringify` of raw message data to JSONL. A redaction helper with no call at this sink cannot protect it.
- Main uses `console`. The updater uses `electron-log`. Production error reporting and tRPC error formatting also need tracing before calling the boundary complete.
- `src/main/index.ts:103` prints the first eight authorization-code characters.
- `routers/claude.ts` logs token prefixes and lengths and previews a custom token near line 1479.
- OpenRouter has masked key logging. Remove secret-derived diagnostics rather than weakening a redaction rule to preserve them.
- `claude-token.ts:262` logs an `execFileSync` error from a command whose arguments include credential JSON. Error objects can contain command arguments.
- Redaction tests should exercise actual sinks, nested records, errors and serialized records. A standalone helper test is not proof that console, files, or exception output use it.

## Primary-source research

The prior research ran multiple searches on Electron storage, Linux keyring failures, IDE credential settings, logging exclusions, and consent accessibility. The exact earlier query count was not retained and must not be invented. This table preserves fetched sources and the decisions they inform.

| Source | Result and implication |
| --- | --- |
| [Electron 39.4.0 safeStorage documentation](https://raw.githubusercontent.com/electron/electron/v39.4.0/docs/api/safe-storage.md) | Pinned synchronous API. `basic_text` on Linux uses a hardcoded password and is not protected storage. Availability alone is insufficient. Encryption and decryption can throw and keyring access can block |
| [Electron 39.4.0 implementation](https://raw.githubusercontent.com/electron/electron/v39.4.0/shell/browser/api/electron_api_safe_storage.cc) | Confirms readiness handling, Linux plaintext override, and `v10`/`v11` ciphertext checks. Do not copy the newer async API from current documentation |
| [Electron issue #42318](https://github.com/electron/electron/issues/42318) | Both chunks read. Maintainers clarified platform-specific protection through PR #42666 and rejected a broad claim that a VS Code extension attack applies to ordinary Electron apps. Do not promise protection from every process running as the same OS user |
| [VS Code settings sync](https://code.visualstudio.com/docs/configure/settings-sync) | All chunks read. Supports a visible keyring repair path and a warning about the explicit basic fallback. This is interaction precedent, not a promise about mausCode's implementation |
| [JetBrains password storage](https://www.jetbrains.com/help/idea/reference-ide-settings-password-safe.html) | Native keychain, KeePass, and do-not-save choices are visible in settings. Warns that credentials placed in URL fields can reach plaintext config and logs. Do not add KeePass or a dependency merely to imitate it |
| [OWASP logging cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) | All four chunks read across this session. Exclude tokens and passwords at real handlers, sanitize untrusted log data, test failures and injection. Keep diagnostics about consent changes without their secret payload |
| [W3C alert-dialog example](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/examples/alertdialog/) | Names and descriptions, least-destructive initial focus, Escape, focus containment, and restoration matter. Reading the example is not accessibility testing |

No benchmark or app-flow result follows from these sources.

## Additional source findings

The cookie writers in `src/main/index.ts:129,921` provide an expiration date in the `persist:main` partition. The [pinned Electron cookies documentation](https://raw.githubusercontent.com/electron/electron/v39.4.0/docs/api/cookies.md), fully fetched, distinguishes these persistent cookies from session cookies without expiration. New persistent cookie writes are a second secret store and need removal or explicit ownership treatment. The renderer's hosted request consumers still need complete tracing before removing them. A guessed upstream `url_request_context_getter.cc` URL returned 404. Only the first chunk of `electron_browser_context.cc` was read, so that file does not establish a cookie-storage conclusion here.

The pinned runtime's `translate_tests.rs:1674` test asserts that `set_api_key` writes raw key assignments to `config/jcode/gemini.env` and `jcode-subscription.env`. It also tests owner-only permissions. This is source evidence of the upstream contract, not an executed Rust test. `AuthChanged` in `jcode-protocol/src/lib.rs:148` carries auth metadata, not an in-memory credential payload. A metadata-only notification cannot replace the file write.

The runtime's vendor form is ratified in `.dump/app/decisions/provisional-assumptions.md` PA-3. That does not approve a new step 11 protocol patch. `runtime/jcode/UPSTREAM.md` still reports an unmodified pinned tree. Preserve provenance and document any new patch explicitly.

Additional research queries were `OAuth refresh token rotation reused refresh token invalidate token family RFC 9700` and `Electron cookies session persistent partition expirationDate cookies.set session cookie stored disk`. Both chunks of the primary [Auth0 rotation documentation][4] were read. Its rotation and replay behavior demonstrates why two independent consumers must not race one refresh token or discard its replacement. It does not prove that the Claude service uses Auth0 or has identical replay behavior. Treat rotation as a compatibility risk and avoid competing refresh owners.

[4]: https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation

## Decisions still required

- External CLI refresh ownership is resolved. Preserve automatic renewal, route the external-store writer through the owner, and check plaintext consent before starting any refresh that must update a plaintext external file. This is a human-approved exception, not permission for other provider-config writes.
- Native handoff. Remove app use of the disk-writing `set_api_key` contract. Decide a memory-only handoff with compatible capability negotiation or a process-launch isolation design after tracing all runtime consumers. Do not replace one shared file race with shared mutable credentials in concurrent sessions.
- New encoded values. Preserve readable legacy encodings while never using a decryption error as proof of plaintext. Ambiguous legacy prefixes require explicit recovery behavior. No database schema change is yet justified.
- Renderer legacy data. Keep untouched legacy slots readable while ensuring new saves use owner-held references. Reading a legacy value must not silently write or delete it.
- File replacement. Specify active-version selection and recovery when encrypted and plaintext counterparts coexist. Atomic writes and cleanup must not discard an existing credential after a failed replacement.

## Scope and completion rules

OAuth screens, device-auth UX, MCP handling in step 28, and hosted token exchange remain outside this work. This exclusion does not turn a discovered app-initiated file write into a read-only path.

Every production safeStorage reference must end in the owner. Remaining test mocks and schema documentation must be listed after the final grep. Every provider, save, refresh, copy, and runtime consumer in this inventory must have a documented policy or an explicit human-approved exception.

Rollback restores prior code behavior, not the confidentiality of saved files. Consented plaintext remains on disk until the user removes it. Revocation does not delete or re-encrypt it.

## Native protocol decision evidence

The pinned `runtime/jcode/crates/jcode-harness-api/src/requests.rs:125-129` explicitly defines `SetApiKey` as persisting a key in the runtime provider store. Its comment excludes OAuth. The existing `src/main/lib/runtime/credentials.ts` nevertheless sends the active Anthropic OAuth/API token through that API. The memory-only replacement must distinguish those credential types rather than merely renaming the request.

`packages/runtime-client/src/launch.ts` supports process environment injection, but switching a credential in the current one-daemon-per-app design would require a restart. Restarting while another turn uses the daemon would interrupt it. Splitting daemons changes persistent session homes and resource use. These are not safe one-line alternatives to a memory-only runtime contract.

The proposed addition must be capability-negotiated, session-scoped, and additive. The existing upstream `set_api_key` semantics must remain intact for other clients. Scope approval is pending, and the session-provider construction path has not yet been fully traced.

## Implementation record, 2026-09-20 (`arena/01a0c098-mauscode`)

The owner is `src/main/lib/secret-storage/`, not `auth-store.ts` alone. `auth-store.ts` keeps its public surface and takes an injected writer, which keeps the Electron call in one module (`electron-keychain.ts`) and lets the policy run under test without Electron.

| Module | Owns | Evidence |
| --- | --- | --- |
| `owner.ts` | Stored-representation decoding (`v10`/`v11` prefix, legacy plaintext text, unreadable), write policy, status, Linux `basic_text` as unprotected | `owner.test.ts`, 11 tests |
| `metadata.ts` | Plaintext consent in `secret-storage.json`, atomic, 0600, malformed file preserved and reported | `metadata.test.ts`, 7 tests |
| `store.ts` | `SecretStore` facade: prepare, read, database encoding, status, consent | used directly by the keyed-store tests |
| `file-secret.ts` | Provider `.dat` plus JSON companion, verified write before replace | exercised through the provider stores |
| `keyed-store.ts` | Renderer values in `renderer-secrets.json`, per-entry recorded protection | `keyed-store.test.ts`, 7 tests |
| `redact.ts` | Log-boundary redaction and credential-record serialization | `redact.test.ts`, 5 tests |
| `electron-keychain.ts` | The only `safeStorage` call in the app | grep below |

Consumers: `auth-store.ts`, `token-crypto.ts` (thin re-export), the three provider file stores, every database credential writer already routed through `token-crypto`, `claude.ts` (its local `decryptToken` is deleted), `runtime/credentials.ts`, `claude-token.ts`, `renderer-secrets.ts`, and the new settings page.

`safeStorage` now appears only in `electron-keychain.ts` (5 call sites) plus comments in `token-crypto.ts` and the settings comment in `agents-models-tab.tsx` that name the owner. The base tree had 35 references across `src/main`, six of them importers.

### Encoding rules actually implemented

- Bytes whose first three bytes are `v10` or `v11` are ciphertext and must decrypt. A decrypt failure raises; it is never read as plaintext.
- A database column holds base64 of those bytes. A `.dat` file holds the bytes themselves. Both decode from the stored form rather than current keyring state.
- Any other readable text is a value an earlier version wrote in the clear and stays readable, with or without a keyring.
- An empty or unreadable payload raises `SecretStorageError` and the caller keeps the saved value untouched.
- Unknown: text a version wrote base64-encoded *inside* a `.dat` file is not resolved, because the same bytes could be legacy text. The file stores never wrote that shape, so only a hand-edited file can hit it, and it reports rather than guesses.

### Renderer

`agents:claude-custom-config`, `agents:model-profiles`, `agents:openai-api-key`, and `onboarding:codex-api-key` keep their atom names and consumers. Their storage is now `createRendererSecretStorage` in `src/renderer/lib/renderer-secrets.ts`: reads come from memory, then from the untouched legacy browser-storage value; writes go to `renderer-secrets.json` through tRPC and never to browser storage. A legacy value moves only after the store confirms the write, and a refusal leaves it where it is. A value that cannot be moved stays readable and is listed on the settings page.

### External Claude CLI renewal (approved exception)

`claude-token.ts` still refreshes the CLI-owned credential. The write permission is checked *before* `refreshClaudeToken` runs, so a refusal never rotates the token; the plaintext `~/.claude/.credentials.json` write goes through `getSecretStore().prepare(..., plaintextOnly: true)`, which requires plaintext consent; refreshes are single-flight in-process, so one refresh token has one owner; a failed write returns the existing token rather than a rotated one.

### Native runtime (binary finding and final scope)

The runtime the app spawns comes from `@1jehuang/jcode-<platform>-<arch>` (`packages/runtime-client/src/binary.ts:1-46`, used at `launch.ts:519`); CI has no Rust job and `electron-builder.yml` bundles no jcode binary. A vendored Rust patch therefore cannot change shipped behavior.

Executed against the bundled runtime (`.dump/app/audits/2026-09-20-native-credential-check.json`):

- `capabilities` = `api_key_provisioning, persisted_session_discovery, runtime_info, session_archive, session_files, session_retention, sessions, streaming`. No `ephemeral_api_key`.
- `set_api_key("anthropic-api", ...)` created `$JCODE_HOME/config/jcode/anthropic.env`, mode 600, containing the key.
- `set_ephemeral_api_key` answered `unknown_request: unknown request: set_ephemeral_api_key` and the connection stayed alive.
- `clearPrivateCredentialFiles` removed the file.

Final scope: the app clears the private instance's plaintext provider files before the daemon starts and after it stops; `applyNativeCredentials` uses `setEphemeralApiKey` only when the daemon advertises `ephemeral_api_key`, and releases those keys at turn end; the vendored protocol reserves the two requests and the registry that prefers a held key over the file (`jcode-provider-env/src/ephemeral.rs`, `docs/protocol.md` 3.1). The bridge-to-daemon forwarding and capability advertisement stay with a runtime release, and no cargo build ran here.

### Cookie store (secondary plaintext write, resolved)

`src/main/index.ts` wrote `x-desktop-token` into the `persist:main` partition with an `expirationDate`, and the pinned Electron cookie docs say that partition keeps such a cookie on disk (flushed every 30 seconds or 512 operations). That made it a second plaintext copy of the session token, outside the owner.

Resolution: session cookie only. `setDesktopTokenCookie(token, expiresAt)` at `src/main/index.ts:111` omits `expirationDate`, skips a token that has already expired, and logs a failure without aborting. Login removes any cookie an earlier version persisted and then writes, so an upgrade clears the on-disk copy. The refresh callback and a new startup path (`isAuthenticated()` then `getValidToken()` and `getTokenExpiry()`) both go through the same helper, and `getTokenExpiry()` was added to `auth-store.ts:204` and `auth-manager.ts:176`. No test can drive Electron's cookie store here; the behavior rests on the pinned API documentation and the three call sites, which the inventory records.

### Unreadable ciphertext handling

A ciphertext file left behind by a keyring that is gone would keep winning on read and hide a newer, consented plaintext value. `stashUnreadableCiphertext` (`owner.ts:45`) renames such a file to `<name>.unreadable-<timestamp>` before a plaintext write, in both the sign-in store and the provider file stores, and logs the new name. Nothing is deleted, and the stashed bytes stay encrypted. Tests cover the rename, the new value winning, and the stashed file keeping its `v10` prefix.

### Grep reduction

```
rg -n "safeStorage" -g '!*.md' .   # after
./src/main/lib/secret-storage/electron-keychain.ts (5 call sites, the only importer)
./src/main/lib/token-crypto.ts:3      (comment naming the owner)
./src/main/lib/secret-storage/index.ts:3 (comment naming the pinned API)
./src/renderer/.../agents-models-tab.tsx (comment naming the owner)
```

The base tree imported `safeStorage` in `auth-store.ts`, `token-crypto.ts`, the three provider stores, and `claude.ts`.
