# Analysis: Codex on native (2026-09-11)

Decision input for the SUPPORT vs WONTFIX gate. All claims verified against
the repo + vendored JCode sources; no live Codex credentials were available.

## How Codex is served today

- App spawns the Codex CLI as a subprocess (`src/main/lib/trpc/routers/codex.ts`,
  `spawn(codexCliPath, args, { env: process.env })`) over the ACP transport.
- Two auth modes (onboarding `billing-method-page.tsx`):
  - `codex-subscription` (**recommended**): "Use your Codex ChatGPT login" —
    OAuth owned by the CLI (`~/.codex/auth.json`), invisible to the app.
  - `codex-api-key`: "app-managed OpenAI API key for Codex" — a plain OpenAI
    key the app holds (`codexApiKeyAtom`) and passes to the CLI env.

## What the daemon can do

- The daemon's OpenAI provider runtime speaks **both** Codex OAuth and API key
  (`jcode-provider-openai-runtime/src/lib.rs`: "Codex OAuth + API key,
  Responses API over SSE and persistent WebSocket"), hitting
  `https://chatgpt.com/backend-api/codex` for codex models.
- OAuth credential chain (`auth/codex.rs:load_oauth_credentials`): jcode auth
  file → legacy `~/.codex/auth.json` (only when `JCODE_ALLOW_CODEX_LEGACY_AUTH`
  is set) → external OAuth tokens. Trust in the legacy file is granted by an
  interactive login flow (`trust_legacy_auth_for_future_use`).
- API-key mode needs only `set_api_key("openai-api", key)` + `set_model(id)`.

## The provisioning gap (decisive)

- The v1 harness `set_api_key` arm (`jcode-harness-api-server/src/translate.rs:720`)
  accepts ONLY `claude-api, openai-api, openrouter, cursor, gemini, jcode`.
  There is **no arm to provision Codex OAuth** (no token/refresh fields, no
  trust gesture, no login initiation).
- Workarounds and why they fail the app's bar:
  - `JCODE_ALLOW_CODEX_LEGACY_AUTH=1` + letting the daemon read the user's
    real `~/.codex/auth.json`: pierces the `inheritLogins: false` instance
    isolation the manager deliberately enforces, and still needs the
    interactive trust write.
  - Copying/linking OAuth refresh tokens into the instance dir: moves
    long-lived subscription secrets across a new boundary with no refresh-error
    UX on the native path.
- A clean fix (harness credential arm for OAuth) is a Rust patch: allowed by
  PA-3 but not compilable/verifiable in this environment (no Rust toolchain,
  documented) — CI/dev-owned, unplannable from here.

## The split-brain problem

SUPPORT for the API-key mode alone is small and TS-only (resolve
`codexApiKeyAtom` → `openai-api`, key the toggle off billing method, reorder
selection). But it would fork the engine rules by billing method — native
allowed for `codex-api-key` chats, forbidden for the *recommended*
`codex-subscription` chats — with no in-session way to verify that API keys
can actually invoke codex models through the daemon's route validation
(`set_model` checks the account `/models` list; needs a real key + network).

## Recommendation: WONTFIX (revisit-gated)

- WONTFIX because: the recommended Codex auth cannot be provisioned through
  the v1 harness without violating instance isolation or shipping an
  unverifiable Rust patch; key-only SUPPORT forks the toggle rules for the
  minority auth mode; and Codex-via-CLI loses nothing by staying
  adapter-served (no Codex-only capability exists in the daemon).
- Revisit when either: (a) the harness gains an OAuth credential arm (then
  SUPPORT both modes uniformly), or (b) usage evidence shows key-based Codex
  demand on native (then reconsider key-only SUPPORT with CI-verified live
  tests).
- WONTFIX cost: one accurate disabled-state string on the codex engine toggle
  + decision records (this file, tasks.md, second-brain).

## Verdict: WONTFIX (decided 2026-09-11)

Human decision after the fork-harvest intake: WONTFIX, following the
recommendation. Decisive additions from the harvest: the Codex adapter has a
concrete upgrade path (erenbertr 0.137 bump + ACP repair + tool normalizer;
T3 `effect-codex-app-server` evaluation) that keeps Codex well-served without
native. Revisit condition stands: a harness OAuth credential arm. Codex stays
on the CLI adapter; the engine toggle's codex-disabled copy now says so.
