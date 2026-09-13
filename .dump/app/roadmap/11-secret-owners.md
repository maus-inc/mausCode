## 0. Meta

| Field | Value |
| --- | --- |
| Step | 11 of 45, wave W2 second track |
| Area | main, db |
| Risk | critical |
| Depends on | {{S01}} |
| Blocks | {{S12}}, {{S16}}, {{S22}}, {{S27}}, {{S28}}, {{S33}} |
| Estimate | medium |

## 1. Outcome

One module owns every secret the app holds, encryption is attempted in one place, and the unencrypted fallback is a decision the user sees rather than a `console.warn` nobody reads.

## 2. Why it matters

`src/main/auth-store.ts:56-57` falls back to plaintext storage when `safeStorage` is unavailable, logging a warning to the console. That path is verified this session. Five provider tables already hold credentials, `claude_code_credentials`, `qwen_credentials`, `cline_credentials`, `openclaw_credentials` and `roo_credentials`, at `src/main/lib/db/schema/index.ts:105-145`, and a second helper `src/main/lib/token-crypto.ts` exists beside it. So there are two encryption paths and five stores, and a user with an unlocked keyring has secrets on disk that no UI ever mentioned.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Plaintext fallback with only a console warning | `src/main/auth-store.ts:22-23`, `:36`, `:53-57` | E1, this session |
| A second crypto helper of our own alongside it | `src/main/lib/token-crypto.ts`, 35 `safeStorage` references across `src/main` | E3, this session |
| Five provider credential tables | `src/main/lib/db/schema/index.ts:105-145` | E1, this session |
| Provider config is held rather than written to the CLI's own file, which is why these tables exist | `.dump/app/decisions/{qwen,cline,openclaw}-provider-adoption-2026-09-11.md` | recorded |
| `FULL-REVIEW.md` §6.4 says read the fallback before copying the pattern | `FULL-REVIEW.md` §6.4 | E1 |

## 4. Read first, and what already exists

`FULL-REVIEW.md` §6.4 and `docs/backend-porting-recipe.md` §0, which already forbids a per-backend credential store. `token-crypto.ts` and `auth-store.ts` are the two existing owners; one of them becomes the wrapper and the other becomes the implementation, so do not add a third.

## 6. Implementation plan

1. Inventory first: every read and write of a secret, the table or file it lives in, and whether it goes through `safeStorage`. Put the table in the PR and in `.dump`.
2. Pick the owner, `src/main/auth-store.ts` per `AGENTS.md`, and make `token-crypto.ts` a thin re-export so provider routers keep one import path. Delete duplicated encrypt and decrypt logic rather than keeping both.
3. Change the fallback: when encryption is unavailable, the store records the state, surfaces it in settings with a concrete reason, and refuses to persist anything marked `secret: true` unless the user accepts plaintext explicitly. Refusing by default and allowing by opt-in, never the reverse.
4. Keep the schema as is, add a `storage` marker column only if step 1 shows a need. A migration for a metadata flag is not worth the upgrade risk.
5. Add redaction at the log boundary so nothing writes a token, and a test that asserts the string form of every credential record is redacted.
6. Test the unavailable-keyring path on Linux with a temp `HOME`, and the round trip when available.

## 8. Boundaries

- Always: nothing logs a token, secrets are references at every boundary, and no provider gets its own store.
- Ask first: any change that stops persisting an existing credential, because it disconnects a working setup.
- Never: treat the plaintext path as safe by default, write a key into a provider's own config file, or store a key in `localStorage`.

## 10. Acceptance criteria

- [ ] One import path for credential encryption, provable by a grep showing no direct `safeStorage` use in provider routers.
- [ ] Unavailable encryption surfaces in settings and blocks new `secret: true` writes without consent.
- [ ] A test asserts a credential record serialises redacted.
- [ ] `grep -rn "safeStorage" src/main --include=*.ts` shrinks, and the record says where each remaining call lives and why.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual, on Linux with the keyring disabled: connect a provider, restart, and confirm what is on disk matches what the settings screen claims.

## 13. Rollback

The change is additive to the storage path. Revert restores the old behaviour for new writes only, so record that anything written under a consented plaintext state stays on disk until the user removes it.

## 14. Out of scope

OAuth flows and device-auth UX, the MCP client secret handling in {{S28}}, and any hosted token exchange, which does not exist yet.

## 15. Handoff notes

The inventory table becomes the reference every later step cites for "where does a secret live". Write it into `.dump/app/research/2026-09-13-secret-owners.md`.
