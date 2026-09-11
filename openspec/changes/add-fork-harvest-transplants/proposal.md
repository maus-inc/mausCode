# Change: add-fork-harvest-transplants

## Why

Upstream `21st-dev/1code` is archived at v0.0.72, but its 618-fork network
contains ahead-of-upstream work worth transplanting: provider transports
(Gemini/OpenRouter/ACP), Codex adapter upgrades (CLI 0.137, ACP repair, tool
normalizer), a Claude usage-stats widget, sidebar QoL, plus T3 Code's tested
`contracts` and `effect-codex-app-server` packages that feed the native
scaffolds. The survey is done and lives in the live ledger
`.dump/ci/research/fork-network-harvest-catalog.md` (+ handoff brief
`.dump/ci/research/HANDOFF-fork-harvest-context.md`). This change consumes that
ledger — it never duplicates the file maps — and turns the approved scope into
ordered, reviewable transplants.

## What changes (phased; each phase needs its own go-ahead)

- Phase 1: aadivar usage-stats widget (4 files: `claude-usage.ts` router,
  `usage-widget.tsx`, widget-settings-popup tweak, atoms +9). Smallest,
  approved, first.
- Phase 2: erenbertr backend core (agent/provider/sub-chat tRPC routers,
  `src/shared/codex-tool-normalizer.ts`, Codex CLI 0.137 bump, ACP adapter
  repair). CORRECTION to the ledger's mapping: these Codex items strengthen
  the Codex **adapter**, not Codex-on-native — consistent with the
  `add-codex-native-support` WONTFIX recommendation, which the harvest does
  not reopen (nothing in it provisions OAuth through the harness).
- Phase 3: erenbertr transports (Gemini/OpenRouter/ACP) + tool UI + model
  selectors + automations inbox + QoL; sidebar last, after the lineage
  decision below.
- Phase 4: T3 `contracts` port (needs explicit approval including the Effect
  decision below).
- Phase 5 (evaluation, not committed): T3 `effect-codex-app-server` as a
  Codex-adapter protocol upgrade.

Method (non-negotiable): file/hunk-level transplant re-applied onto **arena
HEAD** — the ledger's file map was diffed against the harvester's `init` tree,
so every pickup is re-mapped at transplant time; never blind `git cherry-pick`;
drizzle changes re-sequenced manually against our journal; maus branding kept;
license attribution preserved (1Code forks: Apache-2.0; T3: MIT — both
verified, repos + key paths spot-verified 2026-09-11); per-transplant
verification (tsc baseline-compare, tests, no-secret scan — some forks ship
`.claude/settings.local.json`, always skipped).

## Non-goals

- No wholesale merges (especially Locus — domain mine only, per feature).
- No fork deletions ("AI-bro feature removal" stays out; we keep our
  kanban/login/sub-chats sidebar), no verbatim migrations, no fork
  branding/docs, no vendored binaries or secrets.
- Pending items stay pending until reviewed: ning (skills/security-mining),
  sylv sidebar (lineage decision first), jhckevin standalone files, Locus
  mines, T3 server-auth/orchestration/MCP port, SamSammanne (repo confirmed
  Not Found 2026-09-11 — reopen only with access).

## Pending user decisions (gates, not assumed)

- Sidebar lineage: erenbertr's sub-chat line OR sylv's dnd/archive line —
  pick ONE before any sidebar transplant.
- Effect adoption for ported contract/adapter layers (T3 Phases 4–5).
- Per-phase go-ahead (this change's convention + the harvest's own rule).
- Codex SUPPORT/WONTFIX re-ask: the deferral condition (fork list provided)
  is now satisfied; the harvest answers the adapter side and leaves the
  native decision substantively unchanged (recommendation still WONTFIX).

## Impact

- Additive, review-per-phase; no legacy/native behavior changes except the
  transplanted features themselves.
- House rules from the harvest NOT adopted: foreign co-author trailers and
  PAT-based push (sandbox auth is used; credentials never touched). The
  harvester's `init` branch stays theirs; all work here stays on the arena
  branch. Their remote refs (`forkup/*` etc.) don't exist in this checkout —
  sources are fetched from GitHub as needed.
