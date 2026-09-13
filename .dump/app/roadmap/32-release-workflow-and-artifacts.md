## 0. Meta

| Field | Value |
| --- | --- |
| Step | 32 of 45, CI phase 3, plus parity P8 release mechanics |
| Area | ci, packaging |
| Risk | high, it produces what other people run |
| Depends on | {{S03}}, {{S29}}, {{S30}}, {{S31}} |
| Blocks | {{S34}} |
| Estimate | medium |

## 1. Outcome

A manually dispatched release workflow that builds every target, produces unsigned artifacts with a checksum file and an updater manifest, publishes them to GitHub Releases as a draft, and stops there until a human promotes it.

## 2. Why it matters

There is no release automation at all: `.github/workflows/` contains only `ci.yml` and the temporary `lock-regen-temp.yml`, verified this session, while `package.json` already points electron-updater at `provider: github`, `owner: maus-inc`, `repo: mausCode`, also verified. So today a release means someone running `bun run package:mac` locally and uploading by hand, with no checksum and no record of which commit produced the binary. The manifest generator is already product-name driven, verified at `scripts/generate-update-manifest.mjs:13-14` and `:79-81`, which is the piece the inherited audit called stale, so the remaining work is the workflow and its inputs.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| No release workflow exists | `ls .github/workflows/` | E3, this session |
| Publish target is GitHub Releases, no CDN | `package.json` `build.publish` | E1, this session |
| Artifact naming derives from `productName` and `version`, mac zip plus arm64 zip | `scripts/generate-update-manifest.mjs:13-14`, `:79-81` | E1, this session |
| The manifest generator is the only place the feed format is written | `npm run dist:manifest`, and no other writer of `latest*.yml` | E3, this session |
| Native modules need the full install for packaging, which the `package` job already does | `.github/workflows/ci.yml` `package` job, `postinstall` running `electron-rebuild` | E1, this session for the script |
| Bundled agent binaries are downloaded per platform at release time | `package.json` scripts `claude:download` and `codex:download`, pins read this session | E1 |
| Auto-update stays off unless a feed URL is set, so an unsigned release cannot hijack anything | `src/main/lib/auto-updater.ts`, `AGENTS.md` local-only bullet | E1, this session |

## 4. Read first, and what already exists

`.dump/ci/plans/initial-ci-plan.md` phase 3, which specifies exactly this shape including the draft step, and `.dump/ci/second-brain.md` for the runner constraints worth respecting, including that a renderer build needs 4 GB and that `api.github.com` anonymous limits bite on shared runners. The `package` job in `ci.yml` is the packaging recipe; reuse it rather than writing a second one.

## 6. Implementation plan

1. `.github/workflows/release.yml` on `workflow_dispatch` with inputs for version bump, target matrix, and a dry run that builds without publishing.
2. Matrix mac x64 and arm64, windows x64, linux x64, each doing full install, the two binary downloads for that platform, `build:runtime-client`, the build with the heap flag, then `electron-builder` for that target.
3. Write `SHA256SUMS` next to the artifacts, run `dist:manifest`, and attach both to a draft GitHub Release. Publishing stays a human click, and the workflow must not promote its own draft.
4. Verify before upload: recompute each checksum in the job, and fail if a file size or hash disagrees with what the manifest names, so a truncated artifact cannot be published.
5. Keep signing behind secrets that are absent by default, and document that a missing identity yields an unsigned artifact rather than a red build, which is what the `package` job already proves.
6. Record per-artifact size in the release body, since a size regression on a shipped binary is the one performance metric a user can see.
7. `gh release view` the draft as the acceptance check, and print the exact commands the job ran, per the CI plan's note that a review should cite real output.

## 8. Boundaries

- Always: manual dispatch, unsigned by default, checksums published, draft release only, `contents: write` scoped to the one step that needs it.
- Ask first: any notarization or signing secret, which is the human's account decision, item 8 in `.dump/global/questions.md`, and any change to `dist:manifest` output shape, which is a release-trust change.
- Never: publishing on a push event, an update host hardcoded in a workflow, a token in a URL, auto-promoting a draft, or an artifact without a checksum.

## 10. Acceptance criteria

- [ ] A dry-run dispatch produces all four artifacts, a `SHA256SUMS` file and a manifest, and publishes nothing.
- [ ] A real dispatch leaves a draft release whose body lists each artifact with its size and checksum.
- [ ] Two consecutive runs on the same commit produce identical checksums, which is the reproducibility claim.
- [ ] `shasum -c` against the published file passes on a downloaded artifact.
- [ ] A truncated artifact fails the verification step rather than publishing, proven by a forced test.
- [ ] With no signing secret, the job is green and says unsigned in the release notes.

## 11. Verification

```sh
gh workflow run release.yml -f dryRun=true
gh run list --workflow release.yml --limit 1
gh run view --log-failed
```

## 12. Benchmark record

Per-platform build wall time and artifact bytes, recorded per release in `.dump/ci/benchmarks/`, which is the file the CI plan already reserves.

## 13. Rollback

Delete the workflow. Nothing else depends on it, and no state lives outside the release.

## 14. Out of scope

A product domain or CDN mirror for the feed, deferred to the control-plane decision, and the changelog automation that would consume `dist:manifest`. Release channels stay an open question rather than an assumption here.

## 15. Handoff notes

Record the artifact naming, the manifest inputs and the checksum contract in `.dump/ci/plans/2026-09-13-release-workflow.md`, and mark the CI plan's phase 3 item done there.
