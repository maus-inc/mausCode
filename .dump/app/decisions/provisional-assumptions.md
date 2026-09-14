# Provisional assumptions (app track)

The human skipped the naming/identity questions (2026-09-11), so work proceeds on
these safe, easily-reversed assumptions. Each is recorded here so it can be confirmed
or overturned without code archaeology. PA-1..PA-6 predate implementation (research/docs
only); PA-7+ are P1 user-facing provisionals already shipped behind the Native
opt-in — overturning any of them is a small, localized change.

- PA-1. (SPENT 2026-09-11: user decision #4 locked mausCode/maus-inc and the
  rename was executed — package `mauscode`, appId `com.maus-inc.mauscode` as written then, which the tree never used: `build.appId` reads `dev.mausinc.mauscode` and that value was ratified 2026-09-14 as canonical, so read `com.maus-inc.mauscode` below as stale,
  productName `mausCode`, CLI shim `mauscode`.) Was: CLI command will be
  `mauscode`; no renames until confirmed.
- PA-2. Canonical wordmark undecided; no logo committed to product surfaces by this
  track. Branding PNGs stay in `new mauscode branding/` untouched.
- PA-3. (RATIFIED 2026-09-11 by explicit human decision: scope=all + PA-3
  ratified.) JCode is vendored as a copied tree under `runtime/jcode/` with
  `UPSTREAM.md` (pinned SHA, MIT license + Jeremy Huang attribution, patch
  list). First behavioral patch authorized: `add-runtime-permissions`.
  Original rationale: mausCode refines the runtime deeply, so a subtree/
  submodule tracking fast-moving upstream creates more churn than value; a
  pinned copy with an explicit patch list keeps history honest and rebases
  deliberate.
- PA-4. Harness-api v1 is the integration surface (not the legacy internal protocol,
  not the TUI crates). If v1 proves insufficient, extend via `maus.*` minor kinds
  before considering any fork.
- PA-5. (SPENT 2026-09-11: protocol proposal approved, P0 complete, P1 approved.)
  Was: no `src/` behavior changes until approval.
- PA-6. Benchmark environment: CI (bun + full matrix). Sandbox numbers (node-only,
  no bun, no Electron run) will be labeled as such and never presented as releases.
- PA-7. Engine toggle labels: "Legacy" (Claude SDK path) / "Native" (mausCode
  runtime), with "Engine: …" in tooltips. Overturn: rename labels/copy only.
- PA-8. Native refuses plan mode, offline/Ollama, and unconfigured custom
  endpoints with a visible error instead of silent fallback, because silent
  fallback would run turns under different credentials/safety than the user
  selected. (Amended 2026-09-11 by `add-native-endpoint-config`: a chat's
  custom endpoint is now ACCEPTED when the daemon will honor it — explicit
  setting or ambient env — and refused loudly otherwise.) Overturn any
  remaining refusal into support only when the capability genuinely exists.
- PA-9. Native stays opt-in per sub-chat (switchable on empty chats only; choice
  persisted) until the benchmark gate decides the default. Overturn: flip the
  atom default after gate numbers exist.

- PA-20. (2026-09-13, RATIFIED by the human the same day, sign-in removal scope. Option C stays refused; an override to it is a follow-up change with its own migration note.)

  Ratified by the human: remove the built-in app sign-in, the behaviour `ken-jo/1code` had. The three-way
  scope question on roadmap step 45 has not been answered, and the human has twice told the work to proceed,
  so the implementation proceeds on the middle option and this record is where that is written down.

  Assumed unless the human overrides: option A, the app-level gate and `claude-login-modal.tsx` go away;
  option B's keep-list survives, provider OAuth, `auth-store.ts`, `auth-manager.ts`, and the `anthropicAccounts`
  router renamed to credential management for users who hold more than one provider token; option C is refused,
  because removing Anthropic OAuth strands every Pro and Max user who has no API key to paste. The loopback
  callback server at `src/main/index.ts:285` stays, MCP OAuth depends on it, verified by reading its importers.

  Consequence if the human chooses C later: a second change that deletes the OAuth path and leaves API keys, and
  it must carry a migration note for users whose only credential is an OAuth token. Nothing in this assumption
  makes that irreversible, which is why the assumption is allowed at all.
