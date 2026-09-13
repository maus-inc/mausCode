## 0. Meta

| Field | Value |
| --- | --- |
| Step | 10 of 42, wave W2, the permission floor |
| Area | main, shared, db |
| Risk | critical |
| Depends on | {{S01}}, {{S07}} |
| Blocks | {{S16}}, {{S19}}, {{S20}}, {{S21}}, {{S22}}, {{S27}} |
| Estimate | large |

## 1. Outcome

Every agent action passes one gate in the main process, that gate reads one policy file, and the default policy denies destructive, network and exfiltration classes rather than allowing everything. The current non-plan fallback stops being `bypassPermissions`.

## 2. Why it matters

This is the one verified security defect in the roadmap. `src/main/lib/trpc/routers/claude.ts:1778` reads `input.mode === "plan" ? ("plan" as const) : ("bypassPermissions" as const)`, confirmed by reading that line this session. Four of the five accepted modes therefore run the SDK with permissions bypassed, and the app is the only thing between an agent and `rm`. The whole unattended half of this roadmap, steps {{S16}} to {{S27}}, is unsafe to build on that, which is why the plan puts the floor before the fan-out. The triage also recorded the standing instruction that `bypassPermissions` is never portable.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Non-plan mode maps to `bypassPermissions` | `src/main/lib/trpc/routers/claude.ts:1778` | E1, this session |
| Plan mode is special-cased again later in the same router | `claude.ts:1847`, `:2397` around `ExitPlanMode` | E1, this session |
| The app already reads and writes the user's own Claude settings file, so a policy added there would collide with the user's editor | `src/main/lib/claude-config.ts`, `~/.claude/settings.json` both directions | E1, recorded in the plan |
| No policy file for mausCode exists yet | `~/.mauscode/permissions.toml` absent; grep for `permissions.toml` in `src` returns nothing | E3 |
| The native runtime has its own permission surface, and the engine port is gated behind this step | `.dump/app/plans/2026-09-12-jules-port-plan.md` §6, `.dump/app/research/competitive-capabilities.md` C5 | recorded |

## 4. Read first, and what already exists

`docs/backend-porting-recipe.md` §7, the capability manifest, because approvals change through it and not around it. `AGENTS.md` forbids silent widening. `src/shared/local-only.ts` shows how an allow-list shaped policy lives in `src/shared`. The Turbo mode label from the ratified five-mode taxonomy, `.dump/app/decisions/user-decisions-2026-09-11.md` item 1, is the mode whose behaviour this step changes, so read it before touching the copy.

## 6. Implementation plan

1. Write the policy design in `.dump/app/plans/2026-09-13-permission-floor.md`: the rule classes, precedence, file location, and the two-track approach the plan names, Rust engine track plus app-side read-only track.
2. Define `~/.mauscode/permissions.toml` with a schema in `src/shared/permissions/`: deny by default for the destructive, network and exfiltration classes, allow-with-approval as the middle tier, and allow only for read-only classes. Unknown keys are an error, not ignored.
3. One evaluator, one entry point, in main, taking the resolved action and returning allow, deny or ask. Every provider router goes through it. The engine path keeps its own enforcement so it stays usable standalone, invariant I-3 in `.dump/app/second-brain.md`.
4. Replace `claude.ts:1778`. Agent maps to the SDK's accept-edits posture, Turbo maps to accept-edits plus an explicit allow-list from the policy file, never to bypass. If a mode cannot be honoured, refuse loudly rather than widening, which is the ratified PA-8 behaviour.
5. Ship the read-only enforcement track first so the floor exists before the engine work lands, and record which classes are app-enforced versus engine-enforced in the capability manifest.
6. Approval UX: the existing permission cards are the surface, so wire the ask decision to them rather than inventing a dialog. Denials carry the rule that produced them.
7. Stop writing `~/.claude/settings.json` from this path; mausCode policy lives in mausCode's file, and reading the user's file stays read-only.
8. Tests, one per allow rule as the plan demands, plus traversal, absolute path, and denial-propagation cases. A rule with no test is not shipped.

## 8. Boundaries

- Always: deny by default, every allow rule tested, the rule that denied shown to the user.
- Ask first: any new rule class, any change to what `canUseTool` receives, and any change to the engine's own enforcement.
- Never: `bypassPermissions`, `allowDangerouslySkipPermissions`, a wildcard added to silence a finding, or a policy file written into a user's provider config.

## 10. Acceptance criteria

- [ ] `grep -rn "bypassPermissions\|allowDangerouslySkipPermissions" src` returns nothing outside tests that assert its absence, and nothing at all in a router.
- [ ] A run that attempts a destructive action in Agent mode produces a denial naming the rule, with a screenshot in the PR.
- [ ] Unset policy file yields the deny-by-default behaviour, not the old bypass.
- [ ] `~/.claude/settings.json` is never written by this path, proven by a test with a temp HOME.
- [ ] One test per allow rule, plus the traversal and symlink cases from `FULL-REVIEW.md` §6.3.

## 11. Verification

```sh
npm run test && npm run test:node
bun x biome check . && npm run typecheck
```

Manual: run an agent turn that tries `git push --force` in a scratch worktree, and confirm the approval card appears.

## 12. Benchmark record

Gate evaluation cost per tool call, before and after, in `.dump/app/benchmarks/`.

## 13. Rollback

Behind a flag for one release is not acceptable here. Rollback is a revert of the router mapping, and the record must say that the revert restores a bypass path, so it needs a human decision, not an agent one.

## 14. Out of scope

Managed policy distribution, remote placement scoping, and the MCP allowlist posture, which arrives with {{S28}} per triage row 48. The engine's Rust track work is scoped here but sequenced with the engine port.

## 15. Handoff notes

Record the shipped rule classes and their precedence in `.dump/app/decisions/2026-09-13-permission-floor.md`. Steps {{S16}}, {{S19}}, {{S20}}, {{S21}}, {{S22}} and {{S27}} may not start before that file exists, because each one's unattended behaviour is defined by it.
