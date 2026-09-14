# mausCode roadmap, 2026-09-13

**Status:** active sequence, 45 steps, issued to GitHub. **Supersedes nothing:** it consumes `2026-09-12-jules-port-plan.md` (waves W0-W14), `release-parity-v0.0.75-0.0.84-plan.md` (P0-P8), and `mauscode-architecture-plan.md` (invariants I-1 to I-6, phases P0-P9). This file is the order and the issue index; those three stay the reasoning.

**Method.** Every `.dump` file was read end to end on 2026-09-13, 59 files, 5,522 lines, 451,615 bytes, and every path or line cited below was opened in the same session at HEAD `d5bdf69`. Where a corpus claim did not survive that check, it is corrected in §5 rather than repeated.

## 1. Reading order

1. `AGENTS.md` at the repository root. Binding rules, verification gates, parallel-agent lanes.
2. `docs/design-system-baseline.md` before interface work, `docs/backend-porting-recipe.md` before provider work, `docs/ci-gotchas.md` before gate work, `FULL-REVIEW.md` before claiming anything is done.
3. `.dump/app/second-brain.md`, then the specific `research/` file named by your step.
4. `.agents/skills/find-skills/SKILL.md`, which you run before designing, as described next.
5. Your issue, which is self-contained by design. Its body opens with `AGENTS.md` verbatim, then the step. `.github/ISSUE_TEMPLATE/roadmap-step.md` is the format, and each body carries evidence, plan, boundaries, acceptance criteria, verification and out-of-scope.
6. Run `find-skills` before you write anything, as `AGENTS.md` requires, and name in your report which skills you loaded. For any user-facing layout, copy or motion, research how the best tools in the category solve it, prototype the screen in HTML under `.dump/<domain>/research/`, and put two or four options to the human before implementing. The human owns design taste, and a weaker option chosen for convenience is a finding, not a shortcut.

## 4a. Decisions ratified 2026-09-13

The four §11.3 decisions and the sign-in scope were answered in one batch the same day and are recorded in `.dump/global/decisions.md`. They change the plan in three visible ways.

| Decision | Answer | Effect on this plan |
| --- | --- | --- |
| SDK line | Claude Agent SDK `0.3.270`, Claude CLI `2.1.270` | Step 12 is the land, gated by its own spike; 13, 19, 20, 23, 24 and 35 unblock behind it |
| Drag and drop | `@dnd-kit`, an approved exception to the no-new-dependency rule | The three packages are added by step 12, the only dependency step. Steps 17, 18 and 37 share one `DndContext` at the agents layout root, and step 30 records the bundle delta they cost |
| Codex default | Read the model catalog from the pinned CLI at runtime, static fallback, loud refusal when neither answers | Step 05 grows from a constant swap into a resolver with a cache and an offline path, and the divergence at `codex.ts:146` against `acp-chat-transport.ts:41` ends |
| Memory owner | Hybrid, the runtime may propose and mausCode stores | Step 24 and step 43 share one proposal queue and one accept surface, and the engine's own memory store stays dark |
| Sign-in scope | Gate and login modal out, provider OAuth and the credential switcher kept | Step 45 proceeds from an assumption to a ratified scope, recorded as PA-20 |

A third batch the same day closed four hygiene items, and two of them move steps: step 02 now also lands `tsgo --noEmit` as a measured second CI gate, and step 31 moves the root font and branding archives into `assets/branding/` while keeping the demo GIFs and turning `lock-regen-temp.yml` into a documented escape hatch. `questions.md` is down to its last two items, both of which need money or a design rather than code.

A second batch was answered 2026-09-14 and is recorded in the same file, `.dump/global/decisions.md`. Five of its answers move steps: `sharp` is declared as a devDependency by step 12 rather than retiring the icon script, package identity is closed at `dev.mausinc.mauscode` with the display name `mausCode` and a CI branding guard in step 31, the data-egress doctrine is the acceptance test for step 27 and now a rule in `AGENTS.md`, the vendored contracts are kept and absorbed per use with the ledger at `.dump/app/plans/contracts-adoption.md`, and step 32 defines alpha and stable channels with a notary placeholder while signing waits on the human's Apple account. The sixth closes handoff-document hygiene as a convention in `AGENTS.md`, with no root `HANDOFF.md` tracked.

## 4b. Known drift between the issues and these files

GitHub issue bodies were written from these files, and the integration this session runs under can create issues and repo-level labels but cannot edit an issue, comment on one, or add a label to one; every one of those calls returns 403 `Resource not accessible by integration`. That leaves three kinds of drift the human must clear in about a minute of UI work, and every agent must know about them.

- Steps 02, 03, 04, 05, 12, 17, 24, 27, 31, 32, 43 and 45 have a body behind their file, because the ratifications above landed after the bodies were written. `NN-<slug>.md` is the truth, the issue is a pointer.
- Six bodies, for steps 04, 05, 12, 17, 24 and 43, resolve cross-references as `step {{SNN}}` tokens instead of issue numbers, because `PATCH` was unavailable when the numbers were back-filled. Read `{{SNN}}` as issue `#NN+2`.
- No issue carries the `roadmap` label. The label exists in the repository, and creating an issue with `--label roadmap` silently produced `labels: []`. Bulk-apply `roadmap` to #3 through #48 in the web UI. The `roadmap` label is also the trigger named in step 22's issue adapter, so that step is blocked until the labels exist.
- Probe issue #49, "zz-probe-write-test", was created while testing what the integration could write and cannot be deleted or closed from here. Close it in the UI.

## 2. The sequence

`Estimate` is small, medium or large. `Risk` follows `FULL-REVIEW.md` §3.2. Nothing in the second half of the table may start before its `Depends` column is merged.

| # | Step | Wave or phase | Risk | Depends | Milestone |
| --- | --- | --- | --- | --- | --- |
| 01 | Make the instruction files describe the tree that exists | W0, P0-4 | medium | none | M1 |
| 02 | Write the gate policy down so baselines cannot drift silently | P0-3 | medium | 01 | M1 |
| 03 | Prove the app builds end to end and record the numbers | build gate | high | 01, 02 | M1 |
| 04 | Answer the four program decisions that gate later steps | §11.3, **answered 2026-09-13, see §4a** | high | 01 | M1 |
| 05 | Give Codex one default model constant | P1-5 | medium | 04 | M1 |
| 06 | Wire or delete the shortcuts that do nothing | P4 | medium | 01 | M1 |
| 07 | Record run state in the database so runs stop lying | W1 | high | 01, 03 | M1 |
| 08 | Move the queue out of React and onto the run record | W1 | high | 07 | M1 |
| 09 | Map the harness events that vanish today | W1, P2 | high | 07 | M1 |
| 10 | Put a permission floor under every agent action | W2 | critical | 01, 07 | M2 |
| 11 | Keep every secret in one store and make the fallback loud | W2 | critical | 01 | M2 |
| 12 | Move the SDK and binary pins together and register the missing tools | P1-1 to P1-3, P2 | high | 04, 11 | M2 |
| 13 | Persist pull request state as a snapshot with provenance | P6 | high | 03, 12 | M2 |
| 14 | Ship a real changeset, export and pull request | W5 | high | 10, 13 | M2 |
| 15 | Detect repo, branch and pull request state in the sidebar | W6, P6 | high | 06, 13 | M2 |
| 16 | Fix failing CI from the app, bounded, with PR feedback | W6 | critical | 07, 09, 10, 14, 15 | M3 |
| 17 | Make sub-chat creation instant and ordering real | P3, P4 | medium | 04, 07, 08 | M3 |
| 18 | Make multi-pane behaviour correct | P5 | medium | 04, 17 | M3 |
| 19 | Let sub-chats fan out, be supervised and report back | W3 | high | 07, 08, 10, 17, 18 | M3 |
| 20 | Add critics for plans and patches, with bounded rounds | W4 | high | 07, 09, 10, 19 | M3 |
| 21 | Run scheduled tasks locally and own commit authorship | W9 | high | 10, 14, 16, 19 | M3 |
| 22 | Mine TODOs and performance findings into an inbox, with a label trigger | W7 | high | 10, 14, 16, 21 | M4 |
| 23 | Load instructions so they survive the context budget | W10 | high | 01, 09, 12 | M4 |
| 24 | Give the agent a memory it can show and audit | W10 | high | 04, 07, 09, 11, 23 | M4 |
| 25 | Improve the review and composer surfaces users touch hourly | W11, P7 | medium | 13, 17, 18, 22, 24 | M4 |
| 26 | Expose a loopback session API and no-repo scratch sessions | W8 | critical | 07, 10, 11, 24 | M4 |
| 27 | Add the research lane with an egress policy | W12 | critical | 10, 11, 26, 28 | M5 |
| 28 | Give MCP one source of truth | W13 | critical | 10, 11 | M5 |
| 29 | Clear the critical advisories and promote the audit gate | CI phase 4 | high | 02, 03, 12 | M4 |
| 30 | Make the renderer build fit its memory budget and hold it there | CI phase 2 | medium | 03, 29 | M4 |
| 31 | Fix identity drift and repository hygiene | rebrand tail | medium | 01, 04 | M4 |
| 32 | Ship the release workflow with unsigned artifacts and checksums | CI phase 3, P8 | high | 03, 29, 30, 31 | M5 |
| 33 | Build the environment import flow | migration thesis | high | 10, 11, 14, 24, 26, 27, 28 | M5 |
| 34 | Decide the remote placement profile, and park it until then | W14 | critical | 10, 25, 27, 32, 33 | M5 |
| 35 | Close the Codex app-server schema and parity gaps | phase 5 follow-up | high | 12 | M5 |
| 36 | Finish the harvested provider and sidebar payload | fork harvest, Category A remainder | medium | 17, 25 | M6 |
| 37 | Decide the sidebar lineage and ship reorder, archive and emoji picker | fork harvest, lineage decision | high | 17, 18, 36 | M6 |
| 38 | Install skills and manage third-party tooling | fork harvest, `ningzhaoxing` skills | medium | 23, 31 | M6 |
| 39 | Give the security boundaries a test suite and a finding record | fork harvest, security rows | high | 10, 22 | M6 |
| 40 | Add release configuration, the banner model and changelog URLs | fork harvest, `jhckevin` standalone files | medium | 31, 32 | M6 |
| 41 | Ship the run audit trail, the acceptance-record convention and i18n groundwork | fork harvest, `Locus` ops discipline | medium | 07, 25, 39 | M6 |
| 42 | Close the harvest ledger | fork harvest, close-out | low | 36, 37, 38, 39, 40, 41, 45 | M6 |
| 43 | Distil skills from finished work and load them by disclosure | the learning loop | high | 23, 24, 38 | M6 |
| 44 | Search past sessions and let memory decay | the learning loop, recall half | medium | 07, 24, 43 | M6 |
| 45 | Remove the built-in app sign-in | fork harvest, `ken-jo` behaviour, adopted | high | 04, 11, 25, 31 | M6 |

## 3. Milestones

| Milestone | Steps | Done when |
| --- | --- | --- |
| M1, trustworthy foundation | 01 to 09 | Docs match the tree, one recorded build, run state persists, the queue is not in React, no inert shortcut, and the four decisions are answered |
| M2, safe to act | 10 to 15 | Permission floor merged with a test per allow rule, one secret owner, pins moved together, PR state persisted and a real pull request openable |
| M3, safe to leave alone | 16 to 21 | CI repair and PR response run bounded, panes and ordering are correct, fan-out and critics work, and a schedule can fire |
| M4, useful when unattended | 22 to 24, 29 to 31 | Inbox with a label trigger, instructions that survive the budget, memory with provenance, gates promoted, hygiene closed |
| M6, harvested work settled | 36 to 45 | Every row of `.dump/ci/research/fork-network-harvest-catalog.md` reads adopted, refused or parked, the security suite fails when a guard is removed, and the audit trail is readable and exportable |
| M5, shippable and extensible | 25 to 28, 32 to 35 | Review surfaces polished, loopback API, MCP one truth, release artifacts, import flow, placement decided, parity verification |

## 4. Standing constraints on every step

- No new dependency unless the step says so. Only step 12 may touch dependencies and `bun.lock`, and step 31 may add one devDependency for the icon script.
- Zero new Biome findings. `biome.json` holds every rule at `error` and the tree is at 0 findings, so `biome check` exiting 0 means clean. No `biome-ignore`, no rule downgrade.
- Typecheck is a zero-error gate, because `.github/ci-baselines/typecheck.txt` is empty, verified this session.
- Provider work follows the recipe: verbatim with attribution, or not at all. No silent capability widening. `bypassPermissions` is never portable.
- Every performance-sensitive step ships a benchmark record under `.dump/app/benchmarks/`, named `YYYY-MM-DD-<slug>.md`, with baseline, after value, command and environment.
- `active-chat.tsx` at 8,527 lines and `agents-sidebar.tsx` are consumed, not rewritten. The cap the plan sets is plus 300 lines.
- Cross-backend parity: a feature that exists for one provider needs a stated answer for all ten profiles in `src/main/lib/providers/`, or it declares the capability honestly as absent.
- Secrets are references. `src/main/auth-store.ts` with `safeStorage` is the only sanctioned store, and step 11 makes its fallback visible.
- Local-first: everything works with `MAIN_VITE_API_URL` unset, and no third-party host returns.

## 5. Corrections to the corpus, measured this session

Recorded here so no later session re-derives them. The plan files carry the same notes at their own rows.

| Claim in the corpus | Measured state at `d5bdf69` | Consequence |
| --- | --- | --- |
| Changelog anchor double-hash is "open, one-line fix ready", `use-just-updated.ts:53-54` | **Fixed.** `src/renderer/lib/hooks/use-just-updated.ts:50-56` adds the fragment once and carries a comment naming the old defect | Parity P1-6 closed, no issue filed for it |
| Codex must be moved from ACP to the app-server adapter | **Already ported.** `src/main/lib/codex-app-server/` holds the client with `session.ts` at 479 lines and mock-peer tests, `codex.ts:7-9` records the ACP removal, and `@zed-industries/codex-acp` is not a dependency | Step 35 becomes schema-drift and parity verification, not a port |
| `src/main/lib/runtime/runtime.ts:108` refuses plan mode | **No such file.** That directory holds `manager.ts`, `translate.ts`, `sessions.ts`, `endpoints.ts`, `credentials.ts` and `mcp-config.ts` | Step 20 and 23 must re-locate the gate before editing it |
| `simple-git` "blockUnsafeOperationsPlugin bypass, fixed at 3.32.3" | **Unfixed here.** `package.json` carries `"simple-git": "^3.28.0"` as a direct dependency with 18 imports in `src/main` | Step 29 leads with this bump |
| Stale binary `bun.lockb` must be deleted | Already absent, and `package-lock.json` is gitignored at `.gitignore:24` | Step 29 drops that item, and npm resolution stays a local hazard only |
| `generate-update-manifest.mjs` hardcodes `Agents-{version}-*` | **Already fixed.** It derives names from `productName`, at `:13-14` and `:79-81` | Step 32 needs no manifest rename, only the workflow |
| Capability reporting is "planned, not implemented" | Ten profiles exist at `src/main/lib/providers/` with `security`, `performance` and `features` blocks, served by `src/main/lib/trpc/routers/providers.ts`; no renderer file imports the registry | Step 27 extends profiles, and the UI gap is the real work |
| `mock-api.ts` should be deleted per the architecture plan while the system map says keep | Unresolved contradiction between two `.dump` files | Step 01 resolves it in favour of the tree, as `AGENTS.md` requires |
| Vendored contracts are "available vocabulary, not a live path" | Confirmed: 24,860 lines, zero importers outside the directory | Step 13 makes two files the first importers, and records the policy |
| The harvest's erenbertr payload is largely transplanted | Confirmed at file level: twelve `*-chat-transport.ts` files, plus `auto-rename.ts`, `use-changed-files-tracking.ts`, `sub-chat-selector.tsx`, `sub-chat-status-card.tsx`, `mcp-servers-indicator.tsx`, `agent-preview.tsx` and `agent-thinking-tool.tsx`. Only two Category A rows remain open | Step 36 owns the remainder, and the `usage-widget.tsx` name in the ledger does not exist in the tree |
| `jhckevin` release configuration, banner model and changelog URL were taken | **Not taken.** `git ls-files` finds no `release-config`, `banner-model` or `changelog-url`, and three call sites build the releases anchor differently, `update-banner.tsx:129` and `agents-help-popover.tsx:108`, `:112` | Step 40 |
| The `SamSammanne` Cursor integration needs porting | **Already adopted**, `src/main/lib/trpc/routers/cursor.ts` with 11 procedures, `src/shared/cursor-model-id.ts`, `src/main/lib/cursor-agent-binary.ts`, recorded in `.dump/app/decisions/phase6-cursor-provider-adoption.md`. Its `src/web-server` parity half is absent | Step 42 records the parity decision rather than re-harvesting |
| Skills install exists because `skills.ts` exists | Half true. `src/main/lib/trpc/routers/skills.ts` has `list`, `listEnabled`, `create`, `update` and `delete`, and there is no install path, `grep -rn "installSkill" src` is empty | Step 38 |
| A bilingual surface is "orthogonal low-risk" | There is no i18n or locale infrastructure at all, verified by a `git ls-files` scan returning zero files | Step 41 does measured groundwork and refuses a half-translated UI |

## 6. Non-goals of this roadmap

A CLI product, rejected in triage rows 19 and 20. Kanban and the mind-map build surface, excluded from the fork harvest. Locus's runtime-boundary model as a transplant, refused in favour of our own permission floor, step 10, recorded in triage row 5. A hosted account or billing system, though the app-level sign-in gate itself is removed by step 45 on the human's decision. A user model of the person using the app, which needs consent, item 17 in `.dump/global/questions.md`. Any web or second-client parity build, parked by step 42 with a trigger. A hosted translation service or a half-translated UI. Metered plans, concurrency limits and account tiers, row 18. Render-deployment webhooks, row 12. Slack, Linear and Jira, row 17. Four-host pull request providers. A public `JCode` name in any user-facing surface, per D2. Anything that widens approvals, sandbox or egress outside the capability manifest.

## 7. Issue index

Bodies live in `.dump/app/roadmap/NN-<slug>.md` with `{{SNN}}` where a step number is referenced. The GitHub issue carries the same body with those tokens replaced by real issue numbers.

Each GitHub body is the step file with `AGENTS.md` prepended verbatim under a `## Starter: the
repository ground rules, verbatim` heading, so the rules travel with the work. Filed 2026-09-13,
45 issues plus the index, #48, which resolves a `{{SNN}}` reference to its issue number. Editing and
commenting on issues is blocked for this integration, so the tokens stay in the bodies and the index
issue is the resolution; the arithmetic on this board is issue number equals step number plus two.
Two consequences of that block, both recorded so nobody is misled: the `roadmap` label exists but
could not be attached to any issue, and any step body revised in this directory after filing, which
includes #45's step 43 body, is newer on disk than on GitHub, because an issue cannot be edited here.
The file is the authority, as `AGENTS.md` requires, and closing an issue against the GitHub copy
alone is a review finding.

```sh
{ printf '## Starter: the repository ground rules, verbatim\n\n'; cat AGENTS.md;
  printf '\n---\n\n'; cat .dump/app/roadmap/NN-<slug>.md; } > /tmp/body.md
```

| Step | Issue | File |
| --- | --- | --- |

## 8. How this roadmap ends

Each step closes only with its record written back to `.dump`. When 01 to 09 are merged, re-measure 10 onward against the tree rather than against this table, because the dependency graph is the durable part and the estimates are not. When 34 and 35 land, this file is superseded by a new plan for the engine port, which is where `mauscode-architecture-plan.md` picks up.

| 01 | #3 | `01-instruction-truth.md` |
| 02 | #4 | `02-gate-policy.md` |
| 03 | #5 | `03-build-gate.md` |
| 04 | #6 | `04-open-decisions.md` |
| 05 | #7 | `05-codex-default-constant.md` |
| 06 | #8 | `06-shortcut-truth.md` |
| 07 | #9 | `07-run-state.md` |
| 08 | #10 | `08-queue-in-main.md` |
| 09 | #11 | `09-event-mapping.md` |
| 10 | #12 | `10-permission-floor.md` |
| 11 | #13 | `11-secret-owners.md` |
| 12 | #14 | `12-sdk-and-pins.md` |
| 13 | #15 | `13-pr-snapshot-schema.md` |
| 14 | #16 | `14-changeset-and-real-pr.md` |
| 15 | #17 | `15-pr-state-detection.md` |
| 16 | #18 | `16-ci-autopilot.md` |
| 17 | #19 | `17-subchat-optimistic-ordering.md` |
| 18 | #20 | `18-multi-pane-correctness.md` |
| 19 | #21 | `19-subchat-orchestration.md` |
| 20 | #22 | `20-plan-and-code-critics.md` |
| 21 | #23 | `21-scheduler-and-authorship.md` |
| 22 | #24 | `22-suggestion-inbox-and-issue-trigger.md` |
| 23 | #25 | `23-instruction-loading.md` |
| 24 | #26 | `24-agent-memory.md` |
| 25 | #27 | `25-review-and-composer-surfaces.md` |
| 26 | #28 | `26-loopback-session-api-and-scratch-sessions.md` |
| 27 | #29 | `27-research-lane-and-egress-policy.md` |
| 28 | #30 | `28-mcp-one-source-of-truth.md` |
| 29 | #31 | `29-advisory-clearance-and-gate-promotion.md` |
| 30 | #32 | `30-renderer-build-and-bundle-budget.md` |
| 31 | #33 | `31-identity-and-repo-hygiene.md` |
| 32 | #34 | `32-release-workflow-and-artifacts.md` |
| 33 | #35 | `33-environment-import-flow.md` |
| 34 | #36 | `34-remote-placement-profile.md` |
| 35 | #37 | `35-codex-app-server-parity.md` |
| 36 | #38 | `36-harvest-sidebar-and-usage-closeout.md` |
| 37 | #39 | `37-sidebar-lineage-decision.md` |
| 38 | #40 | `38-skills-install-and-tooling.md` |
| 39 | #41 | `39-security-test-suite.md` |
| 40 | #42 | `40-release-config-and-banner-model.md` |
| 41 | #43 | `41-audit-trail-and-i18n-foundation.md` |
| 42 | #44 | `42-close-the-harvest-ledger.md` |
| 43 | #45 | `43-skill-lifecycle-and-disclosure.md` |
| 44 | #46 | `44-session-recall-and-memory-decay.md` |
| 45 | #47 | `45-remove-built-in-sign-in.md` |

Index issue: #48.
