# Handoff — Fork-Network Harvest + T3 Code Port Base

> For the next agent taking over the upstream-harvest work. Read this whole file first; then read the
> live ledger `.dump/ci/research/fork-network-harvest-catalog.md` (which in point of fact this brief
> mirrors, keeps the full per-file maps and ledgers). All commits pushed; no code changed besides docs.

## 1. Where you are (repo state)
- Repo: `maus-inc/mausCode` — our fork of the frozen `21st-dev/1code` (upstream froze at
  v0.0.72; main tip `9f1bc76`; their CDN pipeline shipped v0.0.85–.88 binaries whose
  source was NEVER published — effectively unrecoverable publicly; documented)
- Our default working branch: `init` (HEAD = `171438207` = the catalog doc commit)
- Active arena branch: `arena/01a08de4-mauscode` (now includes our catalog commit as
  `fb4776169`, pushed 88987b561..fb4776169; contains the siblings' .dump/openspec engineering-
  memory commits: endpoint-config, mcp-passthrough, session-init, codex-native-support analyses).
- Our product direction: rebrand to **mausCode/1Code** (`.dump/rebrand/`); the app-architect agents
  scaffolded OpenSpec change proposals (openspec/changes/): add-codex-native-support, add-runtime-
  permissions, add-native-endpoint-config, add-native-mcp-passthrough, add-native-session-init.

## 2. What this branch of work was (the "harvest")
User asked us to:
1. Figure out what's actually ahead of the dead upstream — including the CDN-pipeline versions and the fork network
2. Go through candidate repos deeply to find cherry-pickable things (user named: erenbertr/1code, aadivar/1code,
    lupanpan1030/agent-code-for-me ("Locus"), jhckevin/1code, ningzhaoxing/1code, sylvaindiv/1code,
    ken-jo/1code, SamSammanne/1code-ui. And then asked us to scan the ENTIRE 618-fork network
3. Push the findings to the arena branch (done, commit `fb4776169`) and leave a context-rich handoff (this file)

## 3. Findings — the candidates, in one breath
(Full ranking + per-fork file maps in harness-catalog doc.)
- **lupanpan1030/agent-code-for-me ("Locus")**: the big one — 1,174 commits; a mature parallel
  product (local-first workbench + runtime boundary for Claude Code/Codex: sessions, capability
  truth, audit, handoff; SAME OpenSpec workflow as ours). Category-B: **domain mine**, do NOT
  wholesale-merge
- **erenbertr/1code** (89 commits): USER-APPROVED cherry-pick base — everything EXCEPT kanban +
  mind-map AI builder (feat/build) + feature removals. Real payload: feat/agents (gemini/
  openrouter/acp/ipc/remote chat transports, agent-tool UI, sub-chat, model selectors), main
  backend (tRPC routers, codex 0.137 bump, codex-tool-normalizer), drizzle schemas
  automations, sidebar/QoL. File map + order + conflicts in the doc (Category A)
- **aadivar/1code** (77 sync commits): only the Claude Code **usage-stats widget** (4 files:
  claude-usage.ts router, usage-widget.tsx, widget-settings-popup tweak, atoms +9) — APPROVED

- **ningzhaoxing/1code** (30 commits): skills install core + tooling-management + security-mining PoC
  + vuln-research workbench (+zh-annotated UI) — REVIEW first (license/paths/zh strings)	
- **sylvaindiv/1code** (1 commit, 65 files): agents-sidebar **dnd-reorder + sub-chat archive +
  emoji picker** — LINEAGE CONFLICT: pick ONE of sylv vs erenbertr's sub-chat sidebar line; do not
  merge both blindly	
- **jhckevin/1code** (4 commits): OpenCodex replatform — TAKE standalone files only:
  `opencodex-backend-route.ts`(+test), `release-config.mjs`(+test), `banner-model.ts`/
  `changelog-url.ts`(+tests“, `wor44-branding.test.mjs` — NOT its auth-manager/sandbox-import
  deletions (—453 lines), not its CLI renames to opencodex
- **ken-jo**: REJECT (removes auth — we want our login)**PsyberKadi**: optional doc (freeze-recovery
  snapshot)**SamSammanne/1code-ui**: CLOSED — repo Not Found (renamed/deleted; git auth-blocked.
  It had listed web/desktop parity + Cursor CLI work — reopen only if you find the new name/access
- **Stale-flag exclusions**: forks whose tip == old upstream tags (v0.0.52/.53 et al) — not ahead;
  aletc1 tip==upstream — not ahead. All documented


## 4. T3 Code (`pingdotgg/t3code`) — the optional-backend port base (deep-researched)
- What: "agent harness control surface" — separate 3,833-commit monorepo (NOT a fork;
  active nightly (v0.0.41-nightly.20260911); apps desktop/web/mobile/server/marketing;; packages
  client-runtime, contracts, effect-acp, effect-codex-app-server, shared, ssh, tailscale;
  supports Claude Code/Codex/Cursor/Grok Build/OpenCode/Antigravity. **MIT-licensed** (verified)
- Why port it: pieces we'd otherwise build blind, already built+tested:
 `packages/contracts`(67-file
  shared contract layer: agentSessions, auth, device, environment, git, editor, model…)
  <-> feeds our add-native-* scaffolds;; `packages/effect-codex-app-server`(Codex app-server protocol,
  generated from Codex's official schema, test+mock+probe) <-> fills our add-codex-native-support;
  `apps/server/src`(auth pairing/, EnvironmentAuth, PairingGrantStore, RpcAuthorization,
  ServerSecretStore, device/, orchestration/ + provider adapters, integration-tested;, 26 mcp-*
  branch surfaces) <-> the "optional backend for external CLIs" whole
- Port plan (in the doc): 1 contracts <-> our shared pkg; 2 effect-codex-app-server <-> our codex-native
  impl; 3 server auth pairing; 4 orchestration+provider adapters; 5 mcp surface (by dep
  order); 6 app concepts only (transfer budgets, previews, remote pairing) Care flags: single-
  Electron-app vs monorepo (port files/features, not tooling); Effect de-ps decision (keep their
  effect for contract/adapter layers, our app core stays as-is); MIT attribution; port their tests
  along; one package per branch; don't boil ocean





## 5. What's approved / pending (DO NOT start unapproved code)
- APPROVED (documented plans only, no code yet): aadivar usage-widget 4 files;
 the geral
  Category-A harvest from erenbertr (file map in the doc; user approved scope: everything except kanban+
  mind-map+removals);-t3code port plan (README-as-approval? — user said "we can directly port + refactor"
  as the direction; treat as approved-in-principle, still per-package review)
- PENDING / needs review: ning (skills/security-mining), sylv sidebar (lineage decision first),
  jhckevin standalone files, Locus domain mines (individual files/features, not wholesale	
- NEVER: take deletions from any fork (their removals = the "AI-bro feature removal" user explicitly
  wants away; we keep our kanban/claude-login/sub-chats-sidebar.; and merge migrations verbatim
  (re-sequence against our maus drizzle journal)), and take README/CLAUDE/branding from forks (ours
  stays ours



## 6. Where everything lives (quick index
- LIVE LEDGER: `.dump/ci/research/fork-network-harvest-catalog.md` (166 lines: method, ranked
  table, A/B/C/D ledger, care flags, Category-A file map, Category-C maps, t3code deep-research,

  action log) THIS is the source-of-truth for per-file detail
- This brief: `.dump/ci/research/HANDOFF-fork-harvest-context.md` (you're reading it)
- Our OpenSpec scaffolds: `openspec/changes/` (add-codex-native-support et al)
- Rebrand: `.dump/rebrand/` CI-memory: `.dump/ci/` (research/, plans/, decisions/…)
- Remote refs already fetched locally (no need to re-fetch): forkup/* (erenbertr), lupan/*
  (Locus+antigravity et al., aadivar/main, ning/main, sylv/main, kevin/main, kenjo/main,
  t3code/main, psyber/main, aletc/main. Tip SHAs per the doc


## 7. Suggested next steps (in order, each needs its own branch + review
1. (Easiest win) Port the **aadivar usage-stats widget** (4 approved files) onto a fresh branch off arena;
   keep maus branding; re-check its atoms merge
2. Start **Category-A backend core** from erenbertr (src/main tRPC + src/shared/codex-tool-
   normalizer.ts + codex 0.137 bump) — the biggest standalone win; then agent chat transports
   (gemini/openrouter/acp), then UI components, then drizzle (port-manual), sidebar final
   (after lineage decision) Exclusions: no feat/build, no kanban, no deletions
3. **t3code contracts package** as a separate branch — port to our shared layer (adapt ids/
   names to maus), port tests along; feeds all add-native-* scaffolds afterward
4. Defer: Locus domain mines, ning/security, sylv sidebar (resolve lineage first), jhckevin
   standalone files, SamSammanne re-check (if access appears)
5. Any transplant: file/hunk-level re-apply (never blind git cherry-pick into our diverged tree);
   re-sequence drizzle migrations manually; keep maus branding + CI ratchets intact; review with owie
   per step

## 8. Constraints / house rules (carry these forward
- NO code changes to the harvested features yet (plans + docs only; actual porting needs per-piece
   go-ahead from user/owie. Our init + arena branch now carry the catalog + handoff docs)
- Commit style: keep messages detailed; co-author with `openhands <openhands@all-hands.dev>`
  as done so far
- Push credentials: use `https://x-access-token:${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/
  maus-inc/mausCode.git` (the stored remote token is stale — the PAT is the working one)
- The harness-catalog doc is LIVE — update the action log + checkboxes as you port things, not
  silently go stale 