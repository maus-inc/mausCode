# Verification gaps and how to reach the analyzers

Findings from trying to verify changes in this repository on 2026-09-11.

## There is no working verification command

Before this branch, `package.json` declared `"ts:check": "tsgo --noEmit"`.
`tsgo` is the binary from `@typescript/native-preview`, which is not in
`dependencies` or `devDependencies`. Running the script fails immediately with
`sh: 1: tsgo: not found`. There is no other check script, no test script, and no
`.github` directory, so nothing in the repository could be run to validate a
change.

`ts:check` now runs `tsc --noEmit`. `typescript` was already a devDependency and
`node_modules/.bin/tsc` was already present, so this adds no dependency.

## The type baseline is 110 errors

`npx tsc --noEmit` on commit `19666d0` reports 110 type errors. That is the
starting point, not a target introduced by any change. Distribution by code:

| Code | Count | Meaning |
| --- | --- | --- |
| TS2339 | 32 | Property does not exist on type |
| TS2322 | 28 | Type not assignable |
| TS7006 | 12 | Implicit `any` parameter |
| TS2307 | 10 | Cannot find module |
| TS2554 | 6 | Wrong argument count |
| TS2551 | 5 | Property does not exist, similar name suggested |
| TS2345 | 4 | Argument type mismatch |
| TS2353 | 3 | Object literal may only specify known properties |
| TS2578 | 2 | Unused `@ts-expect-error` |
| TS2352 | 2 | Conversion may be a mistake |
| TS18048 | 2 | Possibly `undefined` |
| others | 4 | TS7053, TS2571, TS2386, TS2344 |

Worst files: `src/renderer/features/agents/main/active-chat.tsx` (30),
`src/renderer/features/agents/main/new-chat-form.tsx` (16),
`src/renderer/features/agents/ui/agents-content.tsx` (11),
`src/main/lib/credential-manager.ts` (11),
`src/main/lib/trpc/routers/claude.ts` (10).

TS2307 includes `src/renderer/lib/remote-trpc.ts:6`, which imports
`../../../../web/server/api/root`. That path is outside this repository. The
renderer imports its tRPC types from the hosted backend's source tree, so the
desktop app cannot be typechecked on its own. Fixing this means publishing the
router types as a package or generating a type-only contract, and it is a
prerequisite for a meaningful CI gate.

Because of these 110 errors, `npm run ts:check` exits 2 on a clean tree. A CI
job wired to it would fail on day one. The realistic sequence is: fix or
`@ts-expect-error` the 110 with a justification each, then turn the job on.

## No tests existed

There is no test runner in `devDependencies` and no test file in the tree.
`npm test` now runs `tsx --test "src/**/*.test.ts"` using Node's built-in test
runner. `tsx` was already present in `node_modules` as a transitive dependency
of `drizzle-kit` at version 4.23.13, so it is now declared explicitly in
`devDependencies` at `^4.23.13` rather than relied on by accident. No new
package was downloaded.

The first test file is `src/main/lib/security/security.test.ts`, 10 cases over
`isPathWithinRoot`, `isPathWithinRoots`, `isSameApiOrigin`, and
`isSafeIpcToken`.

## Install and build behaviour in a Linux sandbox

`npm install` fails with ERESOLVE because `@anthropic-ai/claude-agent-sdk@0.2.45`
declares `peer zod@"^4.0.0"` while the project pins `zod@^3.24.1`. Bun tolerates
this, npm does not. `--legacy-peer-deps` installs 1106 packages. The peer
conflict is a real issue for anyone not on bun and should be resolved by moving
to zod 4 or pinning the SDK.

`npm run build` builds the main and preload bundles successfully
(`out/main/index.js` 867.96 kB) and then fails in the renderer bundle with
`Missing "./ayu-light" specifier in "@shikijs/themes" package`. This reproduces
on a clean tree with all local changes stashed, so it is a consequence of npm
resolving `shiki` and `@shikijs/themes` differently than `bun.lockb` does. It is
not a code defect. Renderer bundle verification needs a bun install.

## Reaching SonarCloud

`sonarcloud.io` is not reachable from the sandbox shell. `curl` to it fails
during the TLS handshake with `SSL_ERROR_SYSCALL` after Client Hello, which is
an egress block, not a certificate problem. `api.github.com` and
`registry.npmjs.org` both return 200 from the same shell.

The web fetch tool does reach it. All issue data in
`.dump/ci/audits/sonarcloud-2026-09-11.md` was pulled from
`https://sonarcloud.io/api/issues/search` without authentication, because the
project is public.

Two API details worth remembering:

- `facets` accepts `cleanCodeAttributeCategories`, not `cleanCodeAttribute`.
  Requesting the latter returns a 400 listing the valid names.
- `ps` maxes out at 500, and the response embeds full taint `flows`, so a
  500-issue page is large. Filtering by rule or by
  `impactSoftwareQualities` plus `impactSeverities` and paging in tens keeps
  responses readable.

## Reaching DeepSource

`app.deepsource.com` is reachable. The overview and the security category list
render without a session. Filtered issue lists redirect to login. There is no
public API. Cross-checking DeepSource counts against `grep` is the reliable
method, and it matched exactly for `JS-0440`.

## The workspace resets git history between turns

Work on 2026-09-11 lost three commits when the sandbox reset the branch to its
base commit, `19666d0`, between turns. The working tree kept every file edit,
so nothing was lost in substance, but the commit history was not preserved and
the commits had to be recreated. `node_modules` is also wiped between turns
because it is excluded from snapshots, so any verification step needs
`npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps` first.

Two consequences for how to work here:

- Re-verify after a gap instead of trusting a result from an earlier turn. The
  type baseline was rebuilt from a `git worktree` at `19666d0` with a symlinked
  `node_modules` rather than by stashing, because stashing risks losing
  uncommitted work if another reset lands mid-command.
- Compare type errors as a set of file-plus-message pairs, not as a count, and
  normalise the absolute root path out of the messages. Two `TS2322` errors in
  `agents-custom-agents-tab.tsx` embed the directory `tsc` ran from, so a
  baseline produced in a different directory shows as a false difference.

## Pushing is blocked

`gh auth status` reports `The github.com token in GH_TOKEN is no longer valid`,
and `git push` fails with `could not read Username for 'https://github.com'`.
The remote is `https://github.com/maus-inc/mausCode.git` with no credential
helper configured. Commits stay local until the GitHub connection is refreshed.
