Nine commits, 94 files, +2634/-576 against `init`.

The work follows from the SonarCloud and DeepSource findings catalogued in `.dump/ci/audits/`.

## Security

`e17e2ad` validates renderer-supplied input at the main process boundary. Path containment now lives in one place (`src/main/lib/security/path-containment.ts`, used through `ipc-guards.ts`) instead of three inline copies, and the signed-fetch and stream-fetch handlers reject any URL that is not same-origin with the base URL the main process resolves.

`fe74af6` removes HTML injection points in code and diagram rendering. Base had 8 `dangerouslySetInnerHTML` usages across 6 files. Six are gone, replaced by token rendering or the new `HighlightedCode` component. The two that remain are in `mermaid-block.tsx`, where DOMPurify sanitizes the SVG and mermaid's `securityLevel` is pinned to `strict`. Both carry a `skipcq: JS-0440` with the reason, since that check flags every occurrence syntactically and cannot follow the sanitization.

## Reliability

`c997f21` stops mutating caller inputs and makes sorts deterministic. One of these was a live bug rather than a style issue. `port-scanner.ts` built its cache key with `pids.sort()`, which both mutates the caller's array and sorts lexicographically, so pid 10 sorted ahead of pid 9 and two different pid sets could share a cache key. It now copies before sorting and uses a numeric comparator.

## Two bugs found while reviewing this branch's own diff

`0fe64c5`. The changelog popover hardcoded `https://21st.dev` into `signedFetch`. It was the last renderer call site still doing that, and the origin gate added in `e17e2ad` would have rejected it in development whenever `MAIN_VITE_API_URL` is set. The popover would have shown no release highlights, with the failure swallowed by its existing `.catch(() => {})`. It now resolves the base through `getApiBaseUrl()` like every other caller.

`90f2e35` fixes a regression that `c997f21` introduced on this branch. That commit turned the synchronous `GitWatcher` constructor into an async `create()` factory, which moved the registry's `watchers.set()` to after an `await`. Two subscribers arriving for the same worktree then both missed the cache, each built a chokidar watcher, and the second overwrote the first. `dispose` and `disposeAll` only walk the map, so the first watcher's handles were never closed. The registry now shares one in-flight creation promise per path and drains it before disposal.

Base had no such race. Its `getOrCreate` constructed the watcher and registered it synchronously with no `await` between the two, so the first caller was always visible to the second. This is worth stating plainly: the leak is something this branch caused and then caught, not a pre-existing defect.

## Not fixed

`src/renderer/index.html` sets a CSP with `'unsafe-inline'`, `'unsafe-eval'`, `https://unpkg.com`, and a broad `img-src ... https:`. Tightening it needs nonce or hash handling for the inline styles mermaid emits, and I could not verify that headlessly. Recorded in `.dump/` rather than guessed at.

## Why this targets `init` and not `main`

`init` (`19666d0af`) and `main` (`9f1bc76fa`) are two unrelated root commits. Neither has a parent, and `git merge-base` between them returns nothing, so there is no common ancestor to diff against.

```
$ git rev-list --max-parents=0 19666d0
19666d0af65fd7206a56525af4230ddf1005a0c4
$ git rev-list --max-parents=0 9f1bc76
9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e
```

`git diff origin/main 19666d0 -- src/` is empty, so the two carry identical `src/` trees and differ only in 30 added files under `.dump/`, `.agents/`, and the branding folder. Targeting `main` would show those 30 files as noise. Reconciling the two roots is separate work from this PR.

## Checks

This repo has no `.github/` directory at all, no eslint, biome, or prettier config, and no `.deepsource.toml` or `sonar-project.properties`. The only gates defined in the repository are `npm test` (`tsx --test "src/**/*.test.ts"`) and `npx tsc --noEmit`. Neither runs automatically, so both results below are from running them by hand.

`npm test` passes 28 of 28. That includes two new tests in `src/main/lib/git/watcher/git-watcher.test.ts`. The second drives a real `.git/index` write, which is the only path the watcher watches, and asserts both subscribers receive it.

The first pins the single-watcher invariant. It does not fail against base, because base never had the race. I checked it against both relevant states by swapping the file and running it directly: at `c997f21` it reports two distinct watchers, and at this commit it reports one. Its value is as a guard against reintroducing the leak, not as a reproduction of a base defect.

`npx tsc --noEmit` reports 110 errors, all pre-existing. I normalized both the base and head output by stripping line and column numbers and diffed the sorted sets. They are identical, so this branch adds no type errors. I checked the set rather than the count because a count can hold steady while the errors underneath change.

Third-party GitHub Apps are configured outside the repository and do report on this PR. Current status: Buoy Design Review pass, Socket Security pass, CodeRabbit pass, Sourcery skipping, Kilo Code Review pending. These are review bots rather than a build or test pipeline, so they do not stand in for the two gates above.
