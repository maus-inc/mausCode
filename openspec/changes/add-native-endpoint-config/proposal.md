# Change: add-native-endpoint-config

## Why

P1 refuses custom provider endpoints on native (`NativeCredentialError`): the
daemon is launched once per app with fixed env, so a per-chat `baseUrl` has
nowhere to go. Users on proxies, gateways, and self-hosted endpoints cannot
use the native engine at all. This change gives the daemon host a real endpoint
configuration story and retires the refusal for configured endpoints.

## What changes

- Daemon-level endpoint configuration: named routes (endpoint URL + which
  requests use it) applied at daemon start from app settings, plus a
  per-session route selection where the harness supports it.
- App settings UI (minimal): manage endpoint routes (add/edit/remove, test
  connection). Secrets stay ref-only — routes carry URLs, credentials keep
  flowing through `set_api_key`.
- `NativeCredentialError` for `customBaseUrl` is retired for endpoints covered
  by a configured route; uncovered endpoints keep a clear error (never silent
  fallback to a different endpoint than the user selected).
- Design decision for proposal review: per-chat override vs workspace-level
  routes. Recommendation: workspace-level routes with per-chat selection,
  matching the BYOK model (workspace route → device default → env).

## Non-goals

- No BYOK redesign (this change consumes the existing credential stores).
- No per-request routing or load balancing.
- No changes to the legacy customConfig path.

## Impact

- Additive: new settings surface + daemon-launch env/route plumbing.
- Secret audit repeated for the new config path (URLs are not secrets, but the
  test-connection flow must not log credentials).
- Approval requested before implementation.
