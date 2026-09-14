# Instruction truth: what step 01 found false and what it resolved

Step 01 of the roadmap, issue #3, executed 2026-09-14 on `arena/01a09f45-mauscode`
against the tree at `7c89af0`. This is the record the step's section 15 asks for, so
the next reader does not re-verify any claim below.

## What changed

`CLAUDE.md` and `openspec/project.md` were rewritten where they were false, and the
single system map at `.dump/app/research/current-system-map.md` gained a correction
record. No behaviour changed and no code was touched.

## The step file was itself wrong in three places

The step file is `.dump/app/roadmap/01-instruction-truth.md`. Three of its own claims
did not survive measurement, and the file is corrected in the same commit.

| Claim in the step file | Measured |
| --- | --- |
| "Both `docs/current-system-map.md` and the `.dump/app/research/` copy exist and disagree with each other in places", evidence level E1, "verified" | `docs/current-system-map.md` does not exist and never did on this branch. `git ls-files docs` returns five files and none is a system map. There is exactly one system map, so the step's task 4 and its "One system map exists, not two" acceptance criterion were already satisfied. No document was deleted, because there was never a second one |
| Step 6, "Decide `ts:check`", and the criterion "`ts:check` is either in a CI job or gone" | `.dump/global/questions.md` item 11 is already answered and assigns the wiring to step 02, as a second gate, only after `tsgo` and `tsc` are compared and each disagreement justified. Step 01 must not pre-empt that |
| "The mode list in the docs matches the mode union in `src/shared`, with the same five names" | The five-name union is not in `src/shared`. It is `AgentMode` in `src/renderer/features/agents/atoms/index.ts`. The docs now cite that path, which is what the criterion was reaching for |

The `.dump` corpus claim that 36 routers exist was also wrong. `ls
src/main/lib/trpc/routers | wc -l` returns 37 files and `createAppRouter` mounts 36
routers. Both numbers are now stated, separately, so the file count and the mount
count cannot be confused again.

## The `ts:check` decision is a handoff, not a deletion

`.dump/global/questions.md` item 11, ratified 2026-09-14: `npm run ts:check` runs
`tsgo --noEmit` and becomes a second typecheck gate, landed by step 02 after the
disagreement with `tsc` is measured and every case justified. `tsc` stays the blocking
zero-error gate and `.github/ci-baselines/typecheck.txt` stays its record. No CI job
calls `tsgo` today, verified in `.github/workflows/ci.yml`, whose `quality` job runs
`ratchet:typecheck` and nothing else for typechecking.

Deleting the script would have destroyed work step 02 owns, and wiring it here would
have skipped the measurement the human asked for. `CLAUDE.md` now states what the
script is, that CI does not call it, and that step 02 owns the rest.

## The file naming convention was inverted in both docs

Both instruction files said components are PascalCase and utilities are camelCase.
The tree does the opposite. Measured:

- 228 kebab-case `.tsx` files against 4 PascalCase ones
- `src/renderer/features/agents/main/active-chat.tsx` exports `ChatView`
- `src/renderer/features/sidebar/agents-sidebar.tsx` exports `AgentsSidebar`
- `src/renderer/features/agents/hooks/use-changed-files-tracking.ts` is kebab-case
- The former examples `ActiveChat.tsx`, `AgentsSidebar.tsx`, `useFileUpload.ts` and
  `formatters.ts` are not tracked at all

The four PascalCase files are `src/renderer/App.tsx` as the entry point,
`src/renderer/contexts/TRPCProvider.tsx`, `src/renderer/contexts/WindowContext.tsx`
and `src/renderer/features/terminal/TerminalSearch.tsx`. Both docs now state the
rule the tree follows. The human confirmed this direction on 2026-09-14 rather than
renaming 228 files.

## Stale versions and counts, measured from `bun.lock` and the tree

Both docs carried Electron 33.4.5 and TypeScript 5.4.5. `bun.lock` resolves Electron
to 39.4.0 and TypeScript to 5.9.3 from a declared `^5.4.5`. There is no lockfile
mismatch, so the docs were simply stale. The corrected rows now read Electron 39.4.0,
React 19.2.1, Tailwind CSS 3.4.19, electron-vite 3.1.0 and electron-builder 25.1.8,
with TypeScript shown as the declared range and the resolved version, because an agent
reading a caret range as a pin would be wrong in the other direction.

`CLAUDE.md` claimed `src/main/lib/providers/` publishes a capability profile for every
provider with a router. Thirteen providers have a router. Ten have a profile:
`claude`, `cline`, `codex`, `cursor`, `grok`, `hermes`, `openclaw`, `opencode`, `qwen`
and `roo`. `gemini`, `openrouter` and `ollama` have a router and no profile. The file
now says that, and names writing the missing profile as the prerequisite for a step
that needs a capability answer from one of the three.

`CLAUDE.md` also presented `npm run typecheck` as the gate CI runs. CI runs
`npm run ratchet:typecheck`, which compares against
`.github/ci-baselines/typecheck.txt`. That file holds one byte, a newline, so the
baseline permits zero errors either way. The file now names the ratchet as the gate
and states the rule for editing the baseline.

The JCode pin at `ce4e789` was the one claim this step could not confirm from the
tree alone, until `runtime/jcode/UPSTREAM.md` and `packages/runtime-client/UPSTREAM.md`
both recorded it. `CLAUDE.md` now cites that file instead of asserting the SHA bare.

## Sections deleted or replaced

`CLAUDE.md` carried two dead sections. The human approved both removals on
2026-09-14.

The Debug Mode section told an agent to run `bun packages/debug/src/server.ts`,
instrument against `http://localhost:7799` and read `.debug/logs.ndjson`.
`packages/` holds `runtime-client` alone, and `.debug` does not exist, so every path
in that section was dead. Deleting it is the correct fix for a docs step. Vendoring
`packages/debug/` is behaviour work and belongs to its own step if the workflow is
wanted back. Recovery is `git show 7c89af0:CLAUDE.md`.

The Releasing a New Version section documented a notarization procedure with a
`mauscode-notarize` keychain profile, plus `bun run release`,
`./scripts/upload-release-wrangler.sh`, `./scripts/sync-to-public.sh`, `RELEASE.md`
and an R2 CDN. None of those scripts or that file exist, `release:dev` is the only
release script in `package.json`, and `.dump/global/decisions.md` records the human
refusing signing and notarization outright on 2026-09-14. The section now states the
ratified decision, keeps `SHA256SUMS` as the integrity story, and points at roadmap
step 32, issue #34, which owns the workflow. Restating a procedure that cannot run is
the drift this step exists to remove.

## Rejected

Creating `docs/current-system-map.md` to make the step's "two copies" premise true.
The premise was false, and `AGENTS.md` puts research notes in `.dump`. Adding a second
map would have manufactured the duplicate the step was written to delete.

Freezing the system map and writing a fresh one beside it. That also produces two
maps. The human chose in-place correction with a dated record, which keeps the
`9f1bc76` provenance and keeps one citable file.

Renaming the tree to PascalCase component filenames to match the docs.

## Finding left unowned, recorded rather than fixed

The five agent mode names are written out in 38 places beside the declaration: 14
inline `z.enum(["plan", "ask", "edit", "agent", "turbo"])` literals across 12 routers
in `src/main/lib/trpc/routers`, and 24 TypeScript unions across 11 chat transports,
6 print adapters, 2 analytics modules, the kanban card, the sub-chat store and the
deprecated `mock-api.ts`. `src/main/lib/db/schema/index.ts` repeats them in a comment.

This is a real duplication and it is not a docs problem, so a docs step does not own
it. Roadmap step 06 is about hotkey ids and does not cover it. `AGENTS.md` forbids
opening an issue outside the step list, so it is recorded here and in the pull request
for whoever picks it up. `CLAUDE.md` names it so the next agent does not add a 39th
copy.

## Gate results, and two gate scripts that report the wrong thing

The sandbox has no `node_modules`, no `bun` and no `packages/runtime-client/dist`, and
this step may not run an install because it does not own dependencies. So three gates
ran and the rest did not, and each is reported with its real status rather than a claim.

What ran:

- The step's own path loop over `CLAUDE.md` and `openspec/project.md` prints nothing
- `npx @biomejs/biome@2.5.13 check .` and `ci .`, both over 861 files, 0 findings, exit 0
- `npm run test:node`, 23 pass and 4 fail, and all four failures are
  `Cannot find package '@maus-inc/runtime-client'`, which the missing workspace build
  explains. No code file changed in this step, so no failure can be attributed to it

What did not run, because its tool is absent: `npm run typecheck`, `npm run test`,
`npm run test:contracts`, `npm --prefix packages/runtime-client run typecheck`,
`bun run build:runtime-client`, `bun run build` and `bun run package:mac`.

Two gate scripts have a failure mode worth recording, and neither is fixed here
because gate policy belongs to roadmap step 02.

`scripts/ci/typecheck-ratchet.mjs` runs its check through `npx tsc --noEmit`. When
`tsc` is not installed, `npx` prints `This is not the tsc command you are looking for`
and exits 1. The catch block treats any exit of 1 or 2 with output as "tsc printed
diagnostics", the parser finds no `error TS####:` lines in that text, and the script
reports `typecheck ratchet passed: 0 errors <= 0 baseline` with exit 0. Reproduced in
this sandbox. In CI the install step makes `tsc` resolvable, so this is a local-run
trap rather than a CI defect, and it is exactly the class of thing that makes a green
gate meaningless. A guard that fails loudly when `tsc` cannot be resolved fixes it.

`scripts/ci/lint-changed.mjs` shells out to `bun x biome ci`. With `bun` absent it
exits 1 and prints nothing at all beyond its file count, so a reader cannot tell a lint
failure from a missing tool. The equivalent `npx @biomejs/biome@2.5.13 ci .` passed
here, which is how this step knows the lint gate is genuinely clean.

## One observation about the binding document

`AGENTS.md` states "No `any`, no `as any`, no `biome-ignore`, and no rule downgrade."
The tree holds 107 `biome-ignore` comments across `src/`, and Biome reports 0 findings
over 861 files, which means those suppressions are doing the work. The rule text is out
of scope for this step by its own section 14, so it is unchanged. Read as "do not add
one", it is consistent with the tree. Read as an absolute, it describes a tree that does
not exist. Worth one clarifying clause in whichever step next touches `AGENTS.md`.

`docs/ci-gotchas.md` is stale in the same area. It says the `agents-sidebar.tsx` chat
row case is handled by "the rule is demoted to `warn` via a `biome.json` override", and
`biome.json` has no such override. The tree handles it with a
`biome-ignore lint/a11y/useSemanticElements` comment at `agents-sidebar.tsx:2430` and
`:2676`, inside a `ContextMenuTrigger asChild` slot, which is the same pattern the same
document's second trap says cannot work. Its third trap, the
`noAssignInExpressions` regex loop, is still accurate. Fixing the first two means
deciding which mechanism the repository wants, and that is gate policy, so step 02 or
the step that adds the unowned finding above should own it. Recorded, not fixed.

## Later steps that are now unblocked

Steps 04, 07, 19, 23 and 24 quote these documents. Every path in `CLAUDE.md` and
`openspec/project.md` resolves, verified with the loop in step 01 section 11. The two
paths step 20 and step 23 were told to gate on, `src/main/lib/runtime/runtime.ts` and
a plan-mode refusal, still need locating against `src/main/lib/runtime/`, which holds
`manager.ts`, `translate.ts`, `sessions.ts`, `endpoints.ts`, `credentials.ts` and
`mcp-config.ts`. That correction is already recorded in roadmap section 5.
