## 0. Meta

| Field | Value |
| --- | --- |
| Step | 41 of 45, the fork harvest, `Locus` ops discipline and bilingual surface |
| Area | main, renderer, docs |
| Risk | medium |
| Depends on | {{S07}}, {{S25}}, {{S39}} |
| Blocks | {{S42}} |
| Estimate | medium |

## 1. Outcome

Two harvest items reduced to what fits a local-first app. A run's audit trail is readable and exportable in the app, every roadmap step leaves an acceptance record in the repository, and the user-facing string surface is measured and prepared for translation without a dependency.

## 2. Why it matters

`.dump/ci/research/fork-network-harvest-catalog.md` lists three Locus domains we do not otherwise cover: "Audit/trace/ops discipline (acceptance-record + archive workflow)", "bilingual-UI (i18n surface, orthogonal low-risk)", and "Headless app server + jobs", the last of which this roadmap already owns as steps 26 and 34. The audit item is the one that makes this repository's own method verifiable, an acceptance record per step, and it is currently a stub: `.dump/app/audits/` contains only `.gitkeep`, verified this session. The i18n item is honest groundwork, because there is no translation layer at all today, verified by a `git ls-files` scan for `i18n` and `locale` returning zero files.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The audits directory is an empty stub | `ls -a .dump/app/audits/` prints `.`, `..`, `.gitkeep` | E3, this session |
| Locus rows worth mining and their one-line verdicts | `.dump/ci/research/fork-network-harvest-catalog.md` Category B, and `.dump/app/research/competitive-capabilities.md` C2 and C4 | E1, this session |
| There is no i18n or locale infrastructure in the repository | `git ls-files` scanned case-insensitively for `i18n` and `locale`, zero hits | E3, this session |
| The trail this step exposes already exists as data | `run_events` from step 07, and the `translate.ts` mapper at `src/main/lib/runtime/translate.ts` whose meta events today produce no chunks | E1 for the file, by contract for the table |
| Wipe and export enumerate tables, so a trail export must register | `src/main/lib/db/`, the pattern `FULL-REVIEW.md` §16 records | E1 |
| No dependency may be added for a translation layer without the human | `AGENTS.md` dependency policy, and step 12 as the only dependency step | E1 |

## 4. Read first, and what already exists

`AGENTS.md` on `.dump` being durable memory, since the acceptance record is that doctrine given a file format. Read the details sidebar's widget registry from step 15 before adding a panel, and `docs/design-system-baseline.md` for the export affordance.

Known gap from PR review of the run record this step exposes: the run handle guards log a database transition failure and continue, so a run can reach a terminal status while a required event or approval state was never persisted. That is deliberate, because recording must never break the live turn, but an audit trail that presents `run_events` must detect or display such gaps rather than showing an incomplete log as complete.

## 6. Implementation plan

1. Acceptance record convention: `.dump/app/audits/YYYY-MM-DD-step-NN-<slug>.md`, one per roadmap step, holding the acceptance criteria as written, each with the command or the manual scenario that proved it, the evidence level, what could not be verified, and the follow-up it created. Write the template into the same commit so it is not folklore.
2. Backfill the records for the steps already merged when this one runs, and mark any that cannot be reconstructed as unverified rather than inventing a proof.
3. Audit view in the app, one read-only panel per run showing the event sequence, `run_events`, the permission decisions with the rule that denied, the tools run, and the byte and record counts, with a copy and a save-to-file action.
4. Export path: register the trail with the existing export flow so a user can hand a developer one file, and redact at that boundary using step 11's redaction, never the raw payload of a tool result.
5. i18n groundwork, measured and documented, not half-built: run the count of user-facing string literals in `src/renderer`, list the surfaces that need plural or gender handling, and write the decision, a message-key convention plus a tiny loader in `src/shared`, or a reasoned refusal to do it before the interface settles.
6. Prototype the audit panel and the record's placement in HTML before any React, and put the layout and the copy to the human with two or three options.
7. Tests: the panel renders an event sequence from a fixture run, the export is redacted, and an acceptance record missing a proof fails a check you add to `scripts/ci/`, keeping the enforcement mechanical rather than aspirational.

## 8. Boundaries

- Always: the trail is read-only, exports are redacted, and a record states what could not be verified.
- Ask first: adding a translation dependency or a locale picker, and any new panel in the details sidebar rather than a widget in the existing registry.
- Never: a second event store duplicating `run_events`, logging tool payloads verbatim, or shipping a half-translated UI to look like support for another language.

## 10. Acceptance criteria

- [ ] Every merged step at the time this lands has a record or a line saying it is unverifiable, and the count matches `gh issue list --label roadmap --state closed`.
- [ ] The audit view shows the sequence, the permission decisions and the counts for a completed run, with a screenshot in the PR.
- [ ] An exported trail contains no token and no file body, proven by a test on a fixture.
- [ ] `src/shared/` either gains a documented message layer or a written refusal with the string count that justified it.
- [ ] No new dependency, and the record template exists in the repository.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
node scripts/ci/acceptance-records.mjs      # the check you add here, exit 0
```

## 12. Benchmark record

Render cost of the audit panel on a run with 5,000 events, virtualised or paginated, in `.dump/app/benchmarks/`.

## 13. Rollback

The panel and the export are additive reads over an existing table, and the records are documents, so a revert costs nothing.

## 14. Out of scope

Bilingual shipping UI, which this step prepares and does not promise, telemetry or any hosted trace, and Locus's runtime-boundary model, which the plan rejected wholesale in favour of our own permission floor, recorded in triage row 5 and step 10.

## 15. Handoff notes

Note in `.dump/app/second-brain.md` that `.dump/app/audits/` is now the acceptance-record home, and check the two Locus rows in the harvest catalog, since {{S42}} closes the ledger on those annotations.
