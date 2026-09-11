# Change: add-runtime-protocol-v0

## Why

mausCode's native execution must run through exactly one stable contract between the
application (Electron main + UI) and the runtime (refined JCode daemon). Today the
inherited 1Code tree has two independent, non-shared execution implementations
(`claude.ts` over the Claude Agent SDK, `codex.ts` over ACP) with execution authority
scattered across tRPC routers, and no remote-placement abstraction at all. Every
downstream milestone (native local execution, SSH/Docker/Daytona placements, device
model, BYOK consolidation, migration) depends on this boundary existing first.

Upstream JCode already ships a stable, versioned harness API v1 (NDJSON envelopes,
`HarnessClient`, TypeScript SDK, schema-drift tests). This change adopts it as the
mausCode runtime protocol v0 and reserves the additive extension surface, instead of
inventing a wire format.

## What changes

- New capability `runtime-protocol`: envelope, versioning/negotiation, adopted
  harness v1 request/event surface, `maus.*` extension kinds (workspace, device,
  checkpoint, taskgraph, doctor), transport rules (NDJSON local, relay/WSS remote),
  security invariants (credential refs, permission policy posture).
- `docs/protocol.md` v0 becomes the source of truth for the runtime boundary.
- `packages/runtime-client/` skeleton: harness v1 TS client (forked from
  `@1jehuang/jcode-sdk`) with `connect`/`ping`/`list_sessions` proven against a
  stock JCode daemon. No router rewiring in this change.
- Benchmark harness skeleton + first stock-JCode reproduction numbers.

## Non-goals

- No `src/main` router rewiring (that's the follow-up native-execution change).
- No PTY-in-protocol, no git-in-protocol (explicitly deferred; see design.md).
- No relay/control-plane server work (separate track owns the server side; this
  change defines only the protocol the relay must carry).
- No rebrand/rename of product strings (rebrand track).

## Impact

- New files only under `openspec/`, `docs/`, `packages/runtime-client/`,
  `benchmarks/`, `.dump/app/`. No behavior change to the shipped app.
- Coordination: CI and rebrand tracks can proceed independently; this change is the
  contract they will eventually build against. Human approval requested before the
  follow-up execution change starts.

## Decisions requiring human input

None in this change. Naming/wordmark/vendor-form questions remain open and tracked
in `.dump/app/decisions/provisional-assumptions.md`; none block this proposal.
