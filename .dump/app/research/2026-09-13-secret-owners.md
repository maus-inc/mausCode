# Secret owners

Status: verified against commit `8a77cb2a70d9f6a55bea9d822ef87b6641f2d79b` on branch `arena/01a0c097-mauscode`.

## Decision

`src/main/auth-store.ts` owns all Electron `safeStorage` calls and the plaintext consent gate. `src/main/lib/token-crypto.ts` re-exports that surface so provider routers keep their existing import path. Consent lives in `secret-storage-settings.json` under Electron's user data directory. No database migration is required because the existing credential columns remain encoded text and consent is app-level state.

## Inventory

| Secret | Readers and writers | Storage | Encryption path |
| --- | --- | --- | --- |
| Desktop auth token, refresh token and user blob | `AuthStore.save`, `AuthStore.load`, `auth-manager.ts` | `auth.dat`, `auth.dat.json`, legacy `auth.json` | `safeStorage` for `auth.dat`; consent-gated plaintext fallback |
| Anthropic OAuth tokens | `anthropic-accounts.ts`, `claude-code.ts`, `claude.ts`, runtime credentials | `anthropic_accounts.oauth_token`, `claude_code_credentials.oauth_token` | `auth-store.ts` through `token-crypto.ts` |
| Qwen API key | `qwen.ts` | `qwen_credentials.api_key` | `auth-store.ts` through `token-crypto.ts` |
| Cline API key | `cline.ts` | `cline_credentials.api_key` | `auth-store.ts` through `token-crypto.ts` |
| OpenClaw API key | `openclaw.ts` | `openclaw_credentials.api_key` | `auth-store.ts` through `token-crypto.ts` |
| Roo API key | `roo.ts` | `roo_credentials.api_key` | `auth-store.ts` through `token-crypto.ts` |
| Gemini API key | `gemini-auth-store.ts` | `data/gemini-auth.dat` or `gemini-auth.json` | `auth-store.ts` through shared helpers |
| GitHub token | `github-auth-store.ts` | `data/github-auth.dat` or `github-auth.json` | `auth-store.ts` through shared helpers |
| OpenRouter API key | `openrouter-auth-store.ts` | `data/openrouter-auth.dat` or `openrouter-auth.json` | `auth-store.ts` through shared helpers |
| Per-call Codex API key | Codex router and runtime call | memory only | no persistence |
| MCP OAuth tokens | `mcp-auth.ts`, OAuth helpers | `~/.claude.json` | plaintext, out of scope for step 11 and owned by step 28 |
| Claude CLI credentials | `claude-token.ts` | OS keychain or `~/.claude/.credentials.json` | external store, out of scope |

## Direct call inventory

After consolidation, `safeStorage` appears only in `src/main/auth-store.ts`. Provider routers use `token-crypto.ts`, which is a re-export and does not call Electron. The three file-backed provider stores use the shared owner helpers and retain their existing file names.

## Evidence

- `src/main/lib/db/schema/index.ts:105-145` and `:282-286` define the five provider tables plus Anthropic account storage.
- `src/main/auth-store.ts` and `src/main/lib/token-crypto.ts` were read at E1 before implementation.
- `FULL-REVIEW.md` section 6.4 and `docs/backend-porting-recipe.md` sections 0 and 7 were read before changing the fallback.
- `npx skills find "Electron TypeScript secure credential storage testing"` returned no matching skill. No external skill was installed.
