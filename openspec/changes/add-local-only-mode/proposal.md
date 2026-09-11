# Add local-only mode (opt-in, default off)

## Why
Some users want a guarantee that mausCode never talks to product-hosted
services (remote sandbox backend, analytics). User-approved 2026-09-11 as
an OPT-IN setting, default off. Locus's env-gated default-ON guard is the
reference; ours is a persisted user setting with our own wording and
enforcement points.

## What changes
- New persisted setting `preferences:local-only-mode` (default `false`),
  toggle in Settings → Privacy section, synced to main via
  `local-only:set` IPC (mirrors the analytics opt-out sync).
- `src/shared/local-only.ts` (pure, both processes): official-cloud
  hostname/URL match (21st.dev, 1code.dev, 21st.sh, e2b.app, csb.app,
  codesandbox.io) + blocked message.
- `src/main/lib/local-only.ts`: process flag, `LocalOnlyBlockedError`,
  `assertRemoteAllowed(operation, url?)`.
- Enforcement (product-hosted services only; user-owned endpoints such as
  provider APIs, Ollama, git remotes, and auth flows are untouched):
  1. Remote/sandbox chats: renderer pre-check in `remote-chat-transport`
     (clear toast) + main `api:stream-fetch` guard returning 451 for
     official-cloud URLs.
  2. Analytics: skipped in both processes when local-only.
  3. `shell:open-external` to official-cloud hosts is refused.

## Non-goals
- Air-gap mode (provider APIs/Ollama still reachable by design).
- Blocking auth, auto-updater, git, or provider endpoints.
- Env-var control (setting only).
