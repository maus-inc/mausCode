# Tasks: add-runtime-permissions

## Gates (all must pass before any implementation)

- [ ] Human approves this proposal
- [ ] PA-3 vendor form ratified (copied tree under `runtime/jcode/` + UPSTREAM.md
      + MIT notice, or the overturned form — implementation follows the ratified
      form, not this scaffold's assumption)
- [ ] Capability-shape decision recorded (Option A `maus.*` vs Option B
      upstream-aligned, see design.md)
- [ ] Run `openspec validate add-runtime-permissions --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## Runtime patch (`runtime/jcode/` — untouched until gates pass)

- [ ] Advertise `permissions` capability at handshake
- [ ] Bridge pauses gated tool execution and emits `permission_request` with
      the fully-resolved operation
- [ ] Honor `respond_to_permission` (allow resumes, deny fails the tool call
      with a typed error the agent can see)
- [ ] Deny-by-default: timeout→deny, detach→deny, unknown/expired id→reject
- [ ] Session policy input (`standard` | `read-only`) + machine-readable
      `policy.describe`
- [ ] UPSTREAM.md patch-list entry (what/why/rebase notes); minimal diff, no
      unrelated formatting

## Client + protocol docs

- [ ] `packages/runtime-client`: typed permission APIs if the patch's shape
      needs them (respond path already exists); parity suite stays green
- [ ] `docs/protocol.md`: document the capability + new kinds (minor version
      per extension rules if `maus.*`)

## App activation + verification (live, against the patched vendor)

- [ ] Verify dormant P1 wiring live: card appears, allow/deny round-trips
- [ ] Timeout-deny, detach-deny, unknown-id rejection exercised (not code-read)
- [ ] Plan mode on native: enforce read-only via session policy if supported;
      else explicitly re-confirm the refusal with rationale
- [ ] Benchmarks: approval latency (request→card→resume) recorded in
      `.dump/app/benchmarks/`; regressions block
- [ ] Update second-brain + task states
