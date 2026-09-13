## 0. Meta

| Field | Value |
| --- | --- |
| Step | 22 of 42, wave W7 |
| Area | main, renderer, db |
| Risk | high, because one entry point is a remote trigger |
| Depends on | {{S10}}, {{S14}}, {{S16}}, {{S21}} |
| Blocks | {{S25}} |
| Estimate | medium |

## 1. Outcome

A local inbox of proposed work. An incremental scanner mines `TODO` and `FIXME` markers and a performance pass files findings, both as promotable items a user can approve into a session. A GitHub issue carrying the project's trigger label becomes an item in the same inbox, not a second feature.

## 2. Why it matters

Triage row 6 and row 7 asked for the suggestion surface, and row 10 was answered "Both", meaning a generic promotable inbox item plus a label adapter on top, because an issue is just another way a task arrives. Without the abstraction the feature becomes a GitHub integration, which is the posture the local-only promise rejects.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| An inbox surface already exists and is hosted-shaped | `src/renderer/features/automations/inbox-view.tsx`, plus `inbox-styles.css` | E1, this session |
| No scheduler, so items arrive without a clock to hand work to | step 21 creates `src/main/lib/scheduler/` | by contract |
| No agent-trigger workflow is configured in this repository | `.github/workflows/` contains `ci.yml` and `lock-regen-temp.yml` only | E1, this session |
| `gh` is the only GitHub surface, and the read path exists | `src/main/lib/git/github/github.ts` | E1, this session |
| The default trigger label is a decided product identity choice | triage note in `.dump/app/decisions/2026-09-12-jules-feature-triage.md`, `mauscode`, configurable per project | recorded |

## 4. Read first, and what already exists

`docs/design-system-baseline.md` for list and badge treatment. `inbox-view.tsx` is the UI to re-point. `src/renderer/features/details-sidebar/` already hosts widgets, which is where a per-project toggle belongs, per triage row 6's "same surface, perf detector class".

## 6. Implementation plan

1. One table, `suggestions`: `id`, `projectPath`, `kind`, `title`, `body`, `file`, `line`, `severity`, `source`, `sourceRef`, `status`, `fingerprint`, `createdAt`, `dismissedReason`.
2. The fingerprint is a hash of project, kind, file and line, and it is what makes re-scanning idempotent, so a scanner that runs every minute cannot duplicate a finding.
3. `suggestions.mineTodos` walks the repository with the existing ignore rules, reads only matching lines with context, and caps files per pass. The store keeps only open and dismissed rows, so a resolved marker disappears rather than lingering as stale work.
4. `suggestions.perfFindings` reuses the diagnostics already exposed by `src/main/lib/trpc/routers/debug.ts`, which carries an offline-simulation flag at `:9-13` and `:107-114` plus the system and database queries the CI audit inventoried. Read that router first and write the perf detector against what it actually returns, not against this sentence.
5. Promote is one action for every kind: create a session with the item as the prompt, set `status: "promoted"` and store the run id, so a suggestion is never a second task system.
6. A GitHub label adapter writes into the same table, `source: "github-issue"`, with the issue URL as `sourceRef`. It reads with `gh`, polls on the schedule's cadence rather than on a webhook, and never installs or trusts a workflow.
7. Per-project toggles for each kind, and one switch that stops all promotion from unattended sources.
8. Tests: idempotent re-scan, a marker removal clearing a row, promotion creating exactly one run, adapter mapping a labelled issue, and the same issue arriving twice producing one row.

## 8. Boundaries

- Always: local-first for the inbox; a remote trigger may only create an item, never start a run by itself.
- Ask first: auto-promotion of anything, and any label set beyond the configured one.
- Never: an agent-trigger workflow added to `.github/workflows`, a webhook receiver, promotion without a recorded source, or a scanner reading files the repository ignores.

## 10. Acceptance criteria

- [ ] A file with three `TODO` markers yields three items, and re-scanning yields still three.
- [ ] Deleting the marker removes the item on the next pass.
- [ ] Promoting opens a session with the item text as the first prompt and links the run.
- [ ] An issue labelled `mauscode` appears in the inbox with a link, and a second poll does not duplicate it.
- [ ] With the master toggle off, no poll runs, proven by a mock call-count test.
- [ ] The scanner pass is off the render path and its cost is a recorded number.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual: label a throwaway issue, wait one poll, promote it, and read the run's evidence bundle.

## 12. Benchmark record

Repository scan wall time and bytes read at a fixed file count, plus the incremental pass cost, in `.dump/app/benchmarks/`. A scanner that reads a monorepo twice per second is the failure mode to disprove here.

## 13. Rollback

The table is additive and every producer is behind a toggle, so a revert disables the feature without orphaning runs.

## 14. Out of scope

Slack, Linear and Jira adapters, rejected in triage row 17. Task modals and the composer work that consumes suggestions, {{S25}}. The immutable activity log stays deferred until third-party consumers exist.

## 15. Handoff notes

Write the suggestion schema and the fingerprint rule into `.dump/app/plans/2026-09-13-suggestions.md`, and record in `.dump/app/decisions/` that the label trigger is deliberately poll-based, since the next reader will ask why there is no webhook.
