# Remediation roadmap

Ordered by what unblocks what, not by issue count. 1836 SonarCloud issues at
211 hours of estimated effort will not be worked off in count order, and the
first thing needed is a gate that stops the number growing.

## Stage 1, make verification possible

Done on this branch:

- `ts:check` runs `tsc --noEmit` instead of the missing `tsgo` binary.
- `npm test` runs Node's test runner through `tsx`, already in the tree.

Still open:

- Resolve the 110 pre-existing type errors, or suppress each with a recorded
  reason, so `ts:check` can be a required check.
- Break `src/renderer/lib/remote-trpc.ts` off `../../../../web/server/api/root`.
  Until the router types arrive as a package or a generated contract, the
  desktop app cannot typecheck standalone and TS2307 will keep appearing.
- Fix the `zod@3` versus `@anthropic-ai/claude-agent-sdk` peer conflict so
  `npm install` works without `--legacy-peer-deps`.
- Add `.github/workflows` running `ts:check`, `test`, and `build`. There is no
  CI directory in the repository at all.
- Report coverage. `sonar.coverage.jacoco.xmlPath` or the equivalent for a bun
  test run. SonarCloud currently shows "No data available", which is why the
  dashboard cannot separate real regressions from untested code.

## Stage 2, security

Done on this branch: the two blocker issues and the three high-impact taint
findings in `src/main/windows/main.ts`. See
`.dump/app/audits/security-ipc-boundary.md`.

Next, in priority order:

1. Predictable temp filenames. `src/main/lib/git/sandbox-import.ts:235,286,314`
   built the git bundle and two patch files from `Date.now()` in the shared temp
   directory, so any local user could pre-create them and redirect what the app
   then applies. Fixed by following the `mkdtemp` pattern
   `src/main/lib/git/stash.ts:38` already uses.
2. Audit every `ipcMain.handle` for the assumption that broke in
   `vscode:load-theme`. The renderer is not trusted. `src/main/lib/git/security/`
   documents this threat model and enforces it for the file viewer, but the
   theme scanner, the signed fetch proxy, and the stream proxy did not follow
   it. The remaining handlers in `src/main/windows/main.ts` and
   `src/main/lib/trpc/routers/` need the same pass.
3. `postMessage` origin check, typescript:S2819, 1 issue.
4. Resolve or document the two `strict-transport-security` findings and the
   five `PATH` findings rather than editing code that is correct as written.
5. Re-audit the agent permission model. The archived upstream repository has a
   documented critical permission bypass in agent mode
   (`21st-dev/1code` issue 104), and the source document treats inherited
   execution permissions as untrusted until re-audited.

## Stage 3, reliability

Done on this branch: all eight typescript:S2871 sort findings, the
typescript:S7059 async-constructor finding in `git-watcher.ts`, and the single
shelldre:S7688 finding in `scripts/sync-to-public.sh`. That clears all ten of
the high and blocker impact reliability issues.

Next:

1. The 24 empty catch blocks, typescript:S2486. In an Electron main process a
   swallowed error is usually the reason a feature silently stops working.
2. The 23 `readonly` reassignments, typescript:S2933. These are type-safety
   holes that `tsc` will not catch because the properties are declared
   `readonly` but mutated anyway.

## Stage 4, maintainability

Only worth doing after a gate exists, because otherwise the work is not
measurable.

Cheap and mechanical, roughly 450 issues:

- typescript:S1128, 93 unused imports. Done. Running `tsc` with `noUnusedLocals`
  over a pristine worktree at `19666d0` finds 84 unused bindings across 50
  files, all of which are now removed, leaving zero. The count is lower than
  SonarCloud's 93 rather than higher; the two tools do not agree, and `tsc` is
  the one that gates the build. Both numbers were measured, not estimated.
  The removal was driven by `tsc`'s own TS6133 and TS6192 diagnostics rather
  than a regex, and the resulting type-error set is identical to the baseline.
- typescript:S1854, 95 dead stores. Remove them.
- typescript:S6594, 32 string conversions that can be template literals.
- typescript:S3863, 30 identical conditional branches.

Structural, the real work:

- typescript:S6759, 258 unread props. These are props threaded through
  components that stopped using them. Each removal changes a component
  signature, so this is a component-by-component pass, not a codemod.
- typescript:S3776, 172 cognitive complexity, and typescript:S4144, 14 duplicate
  implementations. Both concentrate in
  `src/renderer/features/agents/main/active-chat.tsx` (7800+ lines) and
  `src/renderer/features/sidebar/agents-sidebar.tsx` (3500+ lines).
  Splitting those two components is the single largest reduction available and
  it is also a prerequisite for the mausCode runtime seam, since the UI cannot
  be rewired onto a protocol while it lives in one file.
- 12.5% duplicated lines. `kanban-view.tsx` and `agents-sidebar.tsx` contained
  byte-identical eight-line referential-stability blocks before this branch
  extracted them, which is the shape of the duplication elsewhere.

## What not to do

Do not work the 1836 issues in count order. Roughly 900 are low-impact and
many are style preferences that an ESLint or Biome configuration with the
project's own opinions would resolve in one pass, once someone decides those
opinions. There is no ESLint or Biome config in the repository today.

Do not treat SonarCloud's 1836 and DeepSource's 4.7k as separate backlogs. They
overlap heavily on the React rules, and working both lists would duplicate
effort on the same renderer files.
