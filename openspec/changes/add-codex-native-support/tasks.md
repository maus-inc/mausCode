# Tasks: add-codex-native-support

## Decision (gate for everything below)

- [x] Human approves this proposal's decision step — approved 2026-09-11 (scope: all)
- [ ] Human records the decision: SUPPORT Codex on native vs WONTFIX with
      rationale (technical recommendation supplied at review time)
      — DEFERRED 2026-09-11: human will supply a list of upstream forks with
      cherry-picks first; the decision waits for that list. Analysis complete
      in `analysis.md` (recommendation: WONTFIX, revisit-gated).
- [ ] Run `openspec validate add-codex-native-support --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## If SUPPORT: implementation

- [ ] Daemon provider plumbing for Codex-backed sessions (no exportable key)
- [ ] Credential resolution for the Codex auth mechanism (ref-only, audited)
- [ ] Engine-toggle availability for codex chats + selection-order update
- [ ] Unit + live tests for Codex-backed native turns
- [ ] Update second-brain + task states

## If WONTFIX: records only

- [ ] Record decision + rationale in `decisions/` and second-brain
- [ ] Accurate disabled-state copy for the codex engine toggle
- [ ] Strike (don't silently drop) the SUPPORT tasks above, close the change
