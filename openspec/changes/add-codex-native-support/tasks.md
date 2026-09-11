# Tasks: add-codex-native-support

## Decision (gate for everything below)

- [x] Human approves this proposal's decision step — approved 2026-09-11 (scope: all)
- [x] Human records the decision: SUPPORT Codex on native vs WONTFIX with
      rationale (technical recommendation supplied at review time)
      — DECIDED 2026-09-11: **WONTFIX**. Rationale: the recommended Codex
      Subscription/OAuth auth cannot be provisioned through the v1 harness
      (no Codex arm in `set_api_key`; trust flow is interactive; token
      tunneling would pierce instance isolation); key-only SUPPORT would fork
      the toggle rules by billing method; and the fork harvest gives the
      Codex adapter a real upgrade path (0.137 bump, ACP repair, tool
      normalizer, T3 app-server protocol) without native. Revisit if the
      harness gains an OAuth credential arm. Full record in `analysis.md`.
- [ ] Run `openspec validate add-codex-native-support --strict --no-interactive`
      in an environment with the OpenSpec CLI and resolve findings

## If SUPPORT: implementation (STRUCK — WONTFIX decided 2026-09-11)

- [ ] ~~Daemon provider plumbing for Codex-backed sessions (no exportable key)~~
- [ ] ~~Credential resolution for the Codex auth mechanism (ref-only, audited)~~
- [ ] ~~Engine-toggle availability for codex chats + selection-order update~~
- [ ] ~~Unit + live tests for Codex-backed native turns~~
- [ ] ~~Update second-brain + task states~~

## If WONTFIX: records only

- [x] Record decision + rationale in `decisions/` and second-brain
- [x] Accurate disabled-state copy for the codex engine toggle
- [x] Strike (don't silently drop) the SUPPORT tasks above, close the change
      — CLOSED 2026-09-11 as WONTFIX. Codex adapter upgrades continue under
      `add-fork-harvest-transplants` (Phases 2–3, 5).
