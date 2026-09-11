# Change: add-native-endpoint-config

## Why

P1 refuses custom provider endpoints on native (`NativeCredentialError`): the
daemon is launched once per app with fixed env, so a per-chat `baseUrl` has
nowhere to go. Users on proxies, gateways, and self-hosted endpoints cannot
use the native engine at all. This change gives the daemon host a real endpoint
configuration story and retires the refusal for configured endpoints.

## What changes

- Daemon-level endpoint configuration: two explicit settings (OpenAI-compatible
  base URL, Anthropic base URL) stored in a `nativeEndpointSettings` singleton
  row, applied as daemon-process env (`JCODE_OPENAI_API_BASE` /
  `JCODE_ANTHROPIC_API_BASE` — explicit names so settings win over ambient
  shell env) at launch. Unset leaves ambient `*_BASE_URL` env untouched.
- Honored-endpoint credential matching: a native chat's `customBaseUrl` is
  accepted iff it normal-equal-matches a configured URL or an ambient env URL;
  anything else keeps a loud `NATIVE_INVALID_REQUEST` refusal (never silent
  fallback to a different endpoint than the user selected).
- Settings UI: a Native Engine Endpoints section (two URL fields, save on blur,
  per-field Test/probe, restart note). Saving validates, aborts in-flight
  native turns, and restarts the daemon; sessions persist via the stable
  jcodeHome. Added probe + credentialless GET so Test never sends secrets.
- Incidental live-test fixes in the same flow: attach-before-`set_api_key`
  ordering (the bridge rejects stateful requests pre-subscribe) and `setModel`
  retry (the account model list loads async after `set_api_key`).

## Scope decision (recorded, evidence-backed)

**Daemon-level only.** The stock daemon honors endpoint overrides ONLY via
process env; `RouteSelection` is model-routing, not URLs; no per-session
endpoint surface exists. Per-chat *different* endpoints on one daemon need a
Rust session-scoped override — recorded as a future Rust phase, not here.
The earlier named-routes / per-chat-selection sketch is superseded by this.

## Non-goals

- No BYOK redesign (this change consumes the existing credential stores).
- No per-request routing or load balancing.
- No changes to the legacy customConfig path.
- No Rust changes (session-scoped endpoint override is a future phase).

## Impact

- Additive: settings table + migration, pure endpoint module + DB accessors,
  facade launch-env + `restartRuntime()`, nested `runtime.endpoints` router,
  settings UI section.
- Secret audit: URLs are not secrets; the probe sends a bare GET with no
  auth headers and never logs credentials.
- Verification: 6 pure-logic tests + a live stub-E2E regression test (full
  native turn against a localhost Responses-API stub); tsc baseline-identical.
