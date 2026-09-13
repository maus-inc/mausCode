# mausCode roadmap, 2026-09-13

**Status:** active sequence, issued to GitHub. **Supersedes nothing:** it consumes `2026-09-12-jules-port-plan.md` (waves W0-W14), `release-parity-v0.0.75-0.0.84-plan.md` (P0-P8), and `mauscode-architecture-plan.md` (invariants I-1 to I-6, phases P0-P9). This file is the order and the issue index; those three stay the reasoning.

**Method.** Every `.dump` file was read end to end on 2026-09-13, 59 files, 5,522 lines, 451,615 bytes, and every path or line cited below was opened in the same session at HEAD `d5bdf69`. Where a corpus claim did not survive that check, it is corrected in §5 rather than repeated.

## 1. Reading order

1. `AGENTS.md` at the repository root. Binding rules, verification gates, parallel-agent lanes.
2. `docs/design-system-baseline.md` before interface work, `docs/backend-porting-recipe.md` before provider work, `docs/ci-gotchas.md` before gate work, `FULL-REVIEW.md` before claiming anything is done.
3. `.dump/app/second-brain.md`, then the specific `research/` file named by your step.
4. Your issue, which is self-contained by design. `.github/ISSUE_TEMPLATE/roadmap-step.md` is the format, and each body carries evidence, plan, boundaries, acceptance criteria, verification and out-of-scope.

## 2. The sequence

`Estimate` is small, medium or large. `Risk` follows `FULL-REVIEW.md` §3.2. Nothing in the second half of the table may start before its `Depends` column is merged.

| # | Step | Wave or phase | Risk | Depends | Milestone |
| --- | --- | --- | --- | --- | --- |
| 01 | Make the instruction files describe the tree that exists | W0, P0-4 | medium | none | M1 |
| 02 | Write the gate policy down so baselines cannot drift silently | P0-3 | medium | 01 | M1 |
| 03 | Prove the app builds end to end and record the numbers | build gate | high | 01, 02 | M1 |
| 04 | Answer the four program decisions that gate later steps | §11.3 | high | 01 | M1 |
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

## 3. Milestones

| Milestone | Steps | Done when |
| --- | --- | --- |
| M1, trustworthy foundation | 01 to 09 | Docs match the tree, one recorded build, run state persists, the queue is not in React, no inert shortcut, and the four decisions are answered |
| M2, safe to act | 10 to 15 | Permission floor merged with a test per allow rule, one secret owner, pins moved together, PR state persisted and a real pull request openable |
| M3, safe to leave alone | 16 to 21 | CI repair and PR response run bounded, panes and ordering are correct, fan-out and critics work, and a schedule can fire |
| M4, useful when unattended | 22 to 24, 29 to 31 | Inbox with a label trigger, instructions that survive the budget, memory with provenance, gates promoted, hygiene closed |
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

## 6. Non-goals of this roadmap

A CLI product, rejected in triage rows 19 and 20. Kanban and the mind-map build surface, excluded from the fork harvest. Metered plans, concurrency limits and account tiers, row 18. Render-deployment webhooks, row 12. Slack, Linear and Jira, row 17. Four-host pull request providers. A public `JCode` name in any user-facing surface, per D2. Anything that widens approvals, sandbox or egress outside the capability manifest.

## 7. Issue index

Bodies live in `.dump/app/roadmap/NN-<slug>.md` with `{{SNN}}` where a step number is referenced. The GitHub issue carries the same body with those tokens replaced by real issue numbers.

| Step | File | Issue |
| --- | --- | --- |

## 8. How this roadmap ends

Each step closes only with its record written back to `.dump`. When 01 to 09 are merged, re-measure 10 onward against the tree rather than against this table, because the dependency graph is the durable part and the estimates are not. When 34 and 35 land, this file is superseded by a new plan for the engine port, which is where `mauscode-architecture-plan.md` picks up.
