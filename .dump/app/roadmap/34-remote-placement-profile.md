## 0. Meta

| Field | Value |
| --- | --- |
| Step | 34 of 35, wave W14, parked behind the human's channel decision |
| Area | main, runtime, settings |
| Risk | critical, it moves execution and its credentials off the laptop |
| Depends on | {{S10}}, {{S25}}, {{S27}}, {{S32}}, {{S33}} |
| Blocks | nothing, it is the last step |
| Estimate | large, and gated |

## 1. Outcome

A workspace says where it runs, local by default, and the environment machinery for remote work exists behind that choice: setup script, snapshot, toolchain pins and a disk budget, all off unless a placement is selected. Nothing in this step is reachable from a local session.

## 2. Why it matters

Triage rows 26 to 30 were all scoped to remote work with the same words from the user: "for like remote work, /make optional (i'm still trying to get to a stable state", and the plan places all five behind the placement profile, off by default. The competitive record's two most valuable imports are exactly this, a placement-agnostic execution interface and the serve, connect and relay shape, both marked native in `competitive-capabilities.md`. Parked, not rejected, is the ratified status.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Five environment features are scoped to remote and optional | `.dump/app/decisions/2026-09-12-jules-feature-triage.md` rows 26-30 with the verbatim custom answer | E1, read this session |
| The placement abstraction and its security notes are already designed | `.dump/app/research/competitive-capabilities.md` C1 and C3, including the `home_mode` credential-visibility rule and the explicit preview for teardown sync | E1, read this session |
| The runtime model already assumes one handle per workspace with placements differing only in launcher | `.dump/app/second-brain.md` architecture section, invariants I-1 to I-6 | E1, read this session |
| No placement or node surface exists in the app | `git ls-files src/renderer/features` has no placement directory, and the only device-named file is `src/renderer/features/agents/ui/device-presets-bar.tsx`, which is a terminal presets bar, not a placement picker. Read it before naming anything "device" | E3, this session |
| Nothing in main binds a wildcard address | `grep -rn "0.0.0.0" src/main` returns only `src/main/lib/terminal/port-scanner.ts:117`, `:154-167`, which parse `netstat` output rather than listen | E3, this session |
| Loopback-first networking has a precedent to follow | `src/main/index.ts:285` auth callback server, and step 26's port-file decision | E1, this session |
| Signing and update channels are unresolved human decisions | items 7 and 8 in `.dump/global/questions.md` | recorded |

## 4. Read first, and what already exists

`docs/daytona-vnc-from-scratch.md`, which is the closest working record of a remote environment in this repository, and the CI plan's note about never putting sandbox workarounds into committed config. Read `docs/protocol.md` before inventing any registry message, and extend through `maus.*` minor kinds rather than a fork, which is invariant I-3.

## 6. Implementation plan

1. `workspace_placement` on the project row, nullable, meaning local, plus a `placements` table for a device record: label, kind, host, port file, last seen, version, capabilities.
2. A launcher interface with two implementations, local process and SSH, and nothing else in the app branching on placement. `home_mode` and an env allow-list, never a block-list, are per-placement options.
3. Connection management, minimal: add, test, revoke. Tailscale and relay are documented alternatives rather than dependencies, per the competitive record's verdict.
4. The five environment features, each off unless a placement is chosen: setup script run once per environment, snapshot of the environment state, toolchain pinning, a multi-runtime note, and a disk budget with a disk-full path that stops work rather than corrupting it.
5. Teardown sync is opt-in and previewed, per the record's warning that automatic sync-back is too magic for a default.
6. Credential visibility is a per-workspace choice with a printed consequence, and no placement ever receives the laptop's key material unless the user explicitly routes it.
7. Tests: SSH known-hosts refusal on an unknown key, which the runtime already does, so assert it stays; allow-list default; disk-full abort leaving the tree clean; a local session that cannot see any placement field.

## 8. Boundaries

- Always: local remains a real local process with no container tax, and a placement is a trust boundary that carries its own policy.
- Ask first: any relay or hosted component, and any automatic sync of remote state onto a laptop.
- Never: `bypassPermissions` in a remote session, a wildcard bind, an environment block-list as the security model, or a remote path that reaches the laptop's `~/.ssh` by default.

## 10. Acceptance criteria

- [ ] With no placement selected, no code in this step runs, and no new setting appears beyond the picker.
- [ ] A workspace on an SSH host runs a turn, and `home_mode` set to real versus profile changes what the agent can see, demonstrated in the PR.
- [ ] An unknown host key is refused with the exact remediation, not a generic failure.
- [ ] A snapshot restores in less time than a rebuild, with both numbers recorded.
- [ ] Disk full stops the run, leaves the tree usable, and reports the budget it hit.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
npm run test:node
```

Manual, on a spare Linux box: pair it, run one turn, revoke it, and confirm nothing remains.

## 12. Benchmark record

Startup, per-turn added latency and idle memory for a remote placement against the local baseline from step 03, in `.dump/app/benchmarks/`. The claim that placement is free locally is what this file has to prove.

## 13. Rollback

Placement is a column and a table. Revert the launcher selection and every workspace reads as local, which is what it was before.

## 14. Out of scope

A public hosted control plane, mobile clients, multi-account device management beyond the minimal list, and repository-level environment variables for local use, deferred in triage row 25 to whatever this step decides.

## 15. Handoff notes

Write the shipped placement contract, the launcher interface and the honest limits into `.dump/app/plans/2026-09-13-placement.md`. This is the step a later reader will want a working session for, so record the exact commands that paired and unpaired a device.
