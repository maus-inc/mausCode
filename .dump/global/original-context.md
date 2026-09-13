# Original context of this corpus

The record of what this work was asked to be, so a later session does not mistake a means
for an end. Provenance: user instructions in Arena sessions on this repository, 2026-09-11
through 2026-09-13, condensed here rather than pasted as a transcript.

- **Ask 1.** Read the wip branch deeply, whole, with no sampling, and produce one plan that
  implements every improvement and fix found. Outcome: `../app/research/current-system-map.md`
  and `../app/plans/2026-09-12-jules-port-plan.md`.
- **Ask 2.** For each feature in the inherited product's changelog, ask the human one question
  and record the verdict, including the verbatim custom answers because several are
  requirements. Outcome: `../app/decisions/2026-09-12-jules-feature-triage.md`, 54 features,
  34 accepted, 6 scoped to remote work, 8 deferred with re-entry triggers, 6 rejected.
- **Ask 3.** Fold in the recreated release-parity program for v0.0.75 to v0.0.84, and the
  unfinished resumption list from the previous session, into one ordered sequence. Outcome:
  `../app/plans/release-parity-v0.0.75-0.0.84-plan.md` and §11 of the port plan.
- **Ask 4.** Evaluate named upstream projects by reading their code, not their marketing, and
  port at the same standard or not at all. Outcome: the t3code pull-request state spike and the
  hermes memory spike in `../app/research/`, plus the backend landscape survey.
- **Ask 5.** Read every `.dump` file end to end, then turn the corpus into an ordered roadmap
  of GitHub issues with deep bodies, one shared template derived from research, and the
  `roadmap` label. Also fold the review protocol's failure classes into `AGENTS.md` as
  prevention rules, state the `.dump` doctrine there, and make the parallel-agent brief safe.
  Outcome: `.dump/app/plans/2026-09-13-mauscode-roadmap.md`, `.github/ISSUE_TEMPLATE/`, and the
  changed sections of `AGENTS.md`, `CONTRIBUTING.md` and `.github/PULL_REQUEST_TEMPLATE.md`.

Standing instructions the human repeated and therefore bind every step: no CLI product, no
invented anchors, plain language, fix all lint findings including tests, design-system baseline
before interface work, preserve attribution, never port `bypassPermissions`, and finish the app
build before the engine port.
