# Design: runtime permissions patch

## Context

System map §17 (seams), protocol v0, P1 approval wiring (translator synthesis +
`runtime.respondApproval`, currently dormant). This is the first change to the
vendored tree, so it also sets the patch-workflow precedent.

## Why the runtime must ask (not the app polling)

Only the executor knows the exact operation about to run (resolved paths,
effective shell command, target host). A poll/check-then-act design races with
the executor; the pause must happen inside the tool call, with the request
carrying the fully-resolved operation. Hence: bridge pauses → emits
`permission_request` → resumes only on an explicit allow. Deny (or timeout, or
no attached answerer) fails the tool call with a typed error the agent sees,
so the agent can replan instead of hanging.

## Capability shape (decision for proposal review)

Option A: `maus.*`-namespaced kinds (`maus.permissions/*`) — zero risk to I-3,
follows the extension rules, but diverges from any future upstream shape.
Option B: upstream-aligned `permissions` kinds — cleaner long-term, but bets on
upstream's eventual design and touches the shared v1 surface. Recommendation:
A now (reversible, contained), with a convergence note if upstream ships its own.
Either way the app keys off the advertised capability, never the runtime version.

## Policy surface sketch

- Gate set: destructive filesystem writes outside the workspace allowlist,
  network egress to non-allowlisted hosts, process spawn matching a denylist,
  and anything the session policy flags. Reads and workspace-local writes run
  ungated (productivity default, matches legacy UX).
- Session policy input at create/attach: `{ mode: "standard" | "read-only" }`.
  `read-only` is what lets native plan mode exist: every mutation gates.
- Machine-readable policy description (`policy.describe`) so approval-card copy
  stays accurate without the app hardcoding runtime policy text.

## Timeouts and defaults

- `permission_request` unanswered within N seconds (default 120, session
  policy-overridable) → deny + typed `permission_timeout` tool error.
- Client detached mid-request → deny immediately (fail closed).
- Unknown/expired request id in a response → rejected, logged, no state change.

## Patch-workflow precedent

Every runtime patch: (1) minimal diff in `runtime/jcode/`, (2) entry in its
`UPSTREAM.md` patch list (what/why/rebase notes), (3) parity-test impact noted
(`packages/runtime-client` suite must stay green; new live tests for the patch),
(4) no unrelated formatting. Rebase against upstream stays deliberate, never
automatic.

## Test plan (live, against the patched vendor)

- Destructive command pauses: agent attempts `rm -rf /tmp/probe-outside-root`
  (sandboxed target); card appears; deny → typed tool error → agent replans.
- Allow path: user allows; tool runs; transcript records the decision.
- Timeout: no answer within the window → deny; agent sees `permission_timeout`.
- Detach: kill the answering client mid-request → immediate deny.
- Plan mode: read-only session attempts a write → gates; reads proceed ungated.
