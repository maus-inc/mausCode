## 0. Meta

| Field | Value |
| --- | --- |
| Step | 40 of 45, the fork harvest, `jhckevin` standalone files |
| Area | shared, main, scripts |
| Risk | medium |
| Depends on | {{S31}}, {{S32}} |
| Blocks | {{S42}} |
| Estimate | small |

## 1. Outcome

One module owns the release feed, the update banner and the changelog link, and a release configuration decides channel, artifact naming and publish target in one place. The fork's deletions stay out.

## 2. Why it matters

The catalog says to take four standalone pieces from `jhckevin/1code`, `release-config.mjs`, a banner model, a changelog URL builder and an app-server launch-profile model, and specifically not its `auth-manager` or `sandbox-import` deletions. The reason these matter here is measurable drift in our own tree: `RELEASES_URL` lives in `src/shared/app-identity.ts` and three call sites build the changelog anchor differently, `src/renderer/components/update-banner.tsx:129` opens the bare URL, `src/renderer/features/agents/components/agents-help-popover.tsx:108` opens the bare URL and `:112` opens `${RELEASES_URL}#${version}`, which is the anchor shape that was already fixed once in `src/renderer/lib/hooks/use-just-updated.ts`. A `changelog-url` module is what ends that family. There is also no `CHANGELOG.md` in the tree, verified by a `git ls-files` scan, which is why the feed is the only source.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Three different changelog-link shapes for the same destination | `update-banner.tsx:129`, `agents-help-popover.tsx:108`, `:112` | E1, this session |
| One of them was already fixed once, in the other direction | `src/renderer/lib/hooks/use-just-updated.ts:50-56`, with the comment naming the `##` defect | E1, this session |
| `release-config.mjs`, `banner-model` and `changelog-url` do not exist here | `git ls-files` scan for `release`, `changelog` and `banner` returns nothing outside `runtime/jcode` and `.dump` | E3, this session |
| Artifact naming is derived from product and version in one script today | `scripts/generate-update-manifest.mjs:13-14`, `:79-81` | E1, this session |
| Publish target is GitHub Releases with no channel | `package.json` `build.publish` | E1, this session |
| Provider launch arguments are assembled ad hoc per router | `src/main/lib/trpc/routers/codex.ts:1150` for the `-c key=value` override comment, `:1233` for the argv build | E1, this session |
| The fork's forbidden half | `.dump/ci/research/fork-network-harvest-catalog.md`, Category C row and Category D rows for the auth and sandbox deletions | E1, this session |

## 4. Read first, and what already exists

`src/shared/app-identity.ts` is where `RELEASES_URL` lives, so the URL builder belongs beside it, and `FULL-REVIEW.md` §6.2 governs every `openExternal` call site this step touches. Read `docs/backend-porting-recipe.md` §0 before taking anything from the fork, because the intent transfers and the file does not.

## 6. Implementation plan

1. `src/shared/release-feed.ts`: `changelogUrl(version?)`, `releasesUrl()`, `anchorFor(version)` and a `normalizeVersion` that never emits a doubled fragment or a fragment missing the `v` prefix. Replace all three call sites and delete their local string building.
2. A banner model in the same module, a plain data shape with channel, version, notes URL and whether an update is available, so `update-banner.tsx` renders data instead of deriving policy in the component, and a test for each state, available, current, feed unreachable, and local-only with no feed configured.
3. `release-config.mjs`, written to our conventions rather than copied, exporting the channel matrix, artifact naming, and the publish target, consumed by `scripts/generate-update-manifest.mjs` and by step 32's workflow so neither hardcodes a name again.
4. Launch profiles: one module that turns provider plus mode into argv, replacing scattered argument assembly in the provider routers, with a test per provider profile from `src/main/lib/providers/`. Refusal copy stays per step 10's rules, and a profile that cannot be honoured fails loudly.
5. Take the intent, not the files, from the fork, and record in the PR which of its four pieces were adopted, adapted or refused, which is what the catalog's care flags ask for.

## 8. Boundaries

- Always: one builder for the changelog anchor, and a test per state a banner can be in.
- Ask first: any release channel beyond what step 32 ships, and the naming of a published artifact, because both are promises to users.
- Never: the fork's auth or sandbox removals, a hardcoded host in a component, or an `openExternal` call that skips the URL validation step 10 requires.

## 10. Acceptance criteria

- [ ] `grep -rn "RELEASES_URL" src` shows the shared module and no component building a fragment by hand.
- [ ] A version string ending in `-beta.1` yields a valid link, proven by a test, and no call site produces `##`.
- [ ] The banner renders correct copy in all four states, with the feed unreachable and local-only cases tested rather than asserted in prose.
- [ ] `scripts/generate-update-manifest.mjs` and the release workflow read the same config, shown by the diff.
- [ ] The PR lists the adopted, adapted and refused pieces with the reason for each.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test
node scripts/generate-update-manifest.mjs --dry-run   # if the script grows the flag, else run it and read the output
```

## 13. Rollback

The shared module can keep its shape while call sites revert, so roll back per piece. The launch-profile change is the only one with a behaviour risk, so keep it in its own commit.

## 14. Out of scope

A hosted update service, the CDN question the release decisions still owe, and any release automation beyond what step 32 ships.

## 15. Handoff notes

Check the four rows off in `.dump/ci/research/fork-network-harvest-catalog.md` and add the refusal note for its deletions, since {{S42}} closes the ledger against exactly these annotations.
