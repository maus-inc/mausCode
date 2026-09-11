# Change: add-runtime-permissions

## Why

P1 (`add-native-local-execution`) wired the approval path end to end — the
translator synthesizes AskUserQuestion cards from `permission_request` events
and `runtime.respondApproval` answers them — but the stock bridge advertises no
`permissions` capability and never issues the event, so the whole path is
dormant. Until the runtime can ask, native sessions run without the interactive
safety gate the product promises, and plan mode stays refused on native (there
is no read-only enforcement without a permission decision point). This change is
the first patch on the vendored runtime and the precondition for enforcing
least-privilege native execution.

## What changes

- Vendored runtime patch (`runtime/jcode/`, recorded in its `UPSTREAM.md` patch
  list): a `permissions` capability advertised at handshake; the bridge pauses
  tool execution and emits `permission_request` for gated operations; honors
  `respond_to_permission` (allow/deny); deny-by-default on timeout, on unknown
  request, and when no client is attached to answer.
- Capability-shape decision: implement as `maus.*`-namespaced kinds if the
  stock harness-api v1 surface cannot carry it without breaking I-3 (JCode
  stays standalone-usable); otherwise align with upstream's eventual shape and
  note the convergence plan. The proposal review picks one.
- Policy surface: which operations gate (destructive fs/network/process by
  default), per-session policy input at `create_session`/`attach`, and a
  machine-readable policy description for the app's approval UI copy.
- App activation (no new UI): translator synthesis and `respondApproval` are
  already built — this change verifies them live against the patched runtime
  and flips plan mode on native from refused to enforced-read-only if the
  policy surface supports it (else plan refusal stays, explicitly re-confirmed).
- Live verification: the "destructive command pauses" scenario runs green
  against the patched vendor; timeout-deny and detach-deny are exercised, not
  asserted by reading code.

## Non-goals

- No bypass-permissions default, no "allow all" persistence without explicit
  user opt-in per session (rejected approaches stand).
- No new placements, no PTY/git in protocol, no BYOK redesign.
- No renderer redesign: existing AskUserQuestion cards are the UI.

## Impact

- First behavioral patch on `runtime/jcode/` — requires PA-3 vendor-form
  ratification BEFORE implementation (the genuinely expensive architectural
  commitment in this queue). No runtime code is touched until both this
  proposal and PA-3 are approved.
- Protocol surface may gain `maus.*` kinds (minor-versioned per the extension
  rules) — `docs/protocol.md` updated in the same change.
- Benchmark gate: approval latency (request→card→resume) measured and recorded;
  regressions block.

## Approval requested

Do not implement until the proposal is approved AND the vendor form (PA-3) is
ratified. Scaffolding only.
