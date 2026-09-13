## 0. Meta

| Field | Value |
| --- | --- |
| Step | 31 of 45, rebrand follow-through and repo hygiene |
| Area | branding, docs, assets |
| Risk | medium, high for the identity fields |
| Depends on | {{S01}}, {{S04}} |
| Blocks | {{S32}} |
| Estimate | small to medium |

## 1. Outcome

The identity fields the rebrand decided are the identity fields in the tree, the records that disagree are corrected, and the loose ends a rename left behind are closed: a broken icon script, duplicate font archives at the repository root, re-record marks on demo media, and one audit of the legacy-name classification so nobody re-audits it.

## 2. Why it matters

Two verified drifts that affect a shipped artifact. `package.json` reads `"name": "mauscode"` and `"version": "0.0.72"` while `rebrand/decisions/open-decisions.md` D6 ratified a restart at `0.1.0` and `rebrand/audits/ui-rebrand-audit.md` records the package name as `mauscode-desktop`, both verified this session. Version and product name drive the userData directory, the About panel, the installer name and the update manifest, so a mismatch between the record and the tree is how a release gets a version that contradicts its own changelog.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| `name` `mauscode`, `version` `0.0.72`, `description` and `homepage` and `author` already maus-branded, `build.appId` `dev.mausinc.mauscode`, `productName` `mausCode`, `publish.provider` github with owner `maus-inc` | `package.json`, read this session | E1 |
| D6 decided `0.1.0`, and the audit records `mauscode-desktop` | `.dump/rebrand/decisions/open-decisions.md` D6, `.dump/rebrand/audits/ui-rebrand-audit.md` manifests row | E1 |
| PA-1 in the assumptions record writes an app id of `com.maus-inc.mauscode`, which matches nothing in the tree | `.dump/app/decisions/provisional-assumptions.md` | E1, this session |
| `scripts/generate-icon.mjs` imports `sharp`, and `sharp` is in neither dependencies nor devDependencies, so `bun run icon:generate` cannot run | `scripts/generate-icon.mjs:21`, `package.json` dependency scan | E3, this session |
| 17 remaining `21st` occurrences in `src`, all of them comments or read-only legacy detection, including `LEGACY_APP_DATA_DIRNAME = ".21st"` and the block-list entries in `src/shared/local-only.ts` | `grep -rn "21st" src --include=*.ts --include=*.tsx` | E3, this session |
| Root-level font archives duplicate shipped fonts: 104 KB, 600 KB and 40 KB tracked, against `src/renderer/assets/fonts` at 2.1 MB across 20 files | `du -sh`, `git ls-files` | E3, this session |
| The capability manifest is described as planned while ten profiles exist and a router serves them | `.dump/app/decisions/provider-agnostic-backends-upstream-policy-2026-09-11.md` versus `src/main/lib/providers/*.ts` and `src/main/lib/trpc/routers/providers.ts` | E3, this session |
| `.dump/app/audits/` contains only `.gitkeep` | `ls -a .dump/app/audits/` | E3, this session |
| `bun.lockb` is already gone and `package-lock.json` is gitignored at line 24, so neither needs a hygiene fix | `ls bun.lockb`, `.gitignore:24` | E3, this session |

## 4. Read first, and what already exists

`.dump/rebrand/second-brain.md` for what was deliberately not changed, which is the list to respect rather than "finish": attribution in `src/main/lib/cli.ts`, the two CDN-warning comments, the legacy detection paths, and the `1code` config-format enum. `.dump/global/naming.md` for the casing rule, including the reason identifiers are lowercase.

## 6. Implementation plan

1. Confirm the target identity values with the human, item 5 in `.dump/global/questions.md`, then set `package.json` `name` and `version` to them in one commit and regenerate `bun.lock` in the same commit, since the package name appears there.
2. Sweep every place the old version or name is asserted: `README.md`, `UPSTREAM.md`, `.env.example`, and any test that snapshots an app name. Grep for `0.0.72` and for `mauscode-desktop` and reconcile each hit deliberately.
3. Correct `.dump/app/decisions/provisional-assumptions.md` PA-1 to record the shipped app id and mark the item spent, and update the capability section of `.dump/app/decisions/provider-agnostic-backends-upstream-policy-2026-09-11.md` to state what exists now, naming `src/main/lib/providers/` and the fact that no renderer file imports the registry yet.
4. Decide the icon script: add `sharp` as an exact devDependency, or rewrite `scripts/generate-icon.mjs` to use the tooling already in the repository, or delete it and record that icons are generated from the masters as `.dump/rebrand/second-brain.md` describes. Do not leave a script that cannot run.
5. Move `geist-pixel-circlefont.zip`, `neue-haas-grotesk-display-pro.zip` and `pathway-extreme-latin-100-normal.ttf` into the branding masters directory or out of git, and state which in the commit, since step 30 handles the shipped fonts.
6. Write the legacy-name classification result into `.dump/app/audits/2026-09-13-legacy-identity-sweep.md` so the audit directory has content and the next reader has a verified list instead of a grep to redo, including the rule for each surviving string.
7. Handle the demo media per `assets/RE-RECORD.md`, either replaced or documented as deferred with the reason, and check `src/renderer/icons/framework-icons.tsx` for the placeholder artwork the identity audit flagged.

## 8. Boundaries

- Always: attribution stays, and the identity constants in `src/shared/app-identity.ts` stay the single source for user-facing names.
- Ask first: any change that moves a userData directory or a persisted theme id, because that orphans a real user's settings.
- Never: a blind search-and-replace of `21st` or `1code`, deleting the legacy detection paths, touching `LICENSE` or `NOTICE`, or claiming the strip is finished without the sweep record.

## 10. Acceptance criteria

- [ ] `package.json` identity fields match the ratified values, and `bun.lock` was regenerated in the same commit.
- [ ] `grep -rn "0.0.72" README.md package.json UPSTREAM.md` returns nothing outside a provenance note about the inherited baseline.
- [ ] `bun run icon:generate` either works or the script and its npm script are gone.
- [ ] `git ls-files "*.zip" "*.ttf" | grep -v src/renderer/assets` prints only what the plan decided to keep.
- [ ] The three `.dump` corrections landed, and PA-1 reads as spent.
- [ ] The legacy-name sweep file exists with one classified row per hit, and the hit count in it equals a fresh grep.

## 11. Verification

```sh
bun install --frozen-lockfile
bun x biome check . && npm run typecheck && npm run test
bun run build:runtime-client && NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

## 12. Benchmark record

Repository weight moved by the font decision, and the packaged app's resource size before and after, in `.dump/app/benchmarks/`.

## 13. Rollback

A version or name revert is one commit, but it must include `bun.lock` and the records that cite it, so roll forward rather than back out a field.

## 14. Out of scope

The temporary lockfile workflow, which step 29 owns. Runtime naming in UI, which does not exist yet and is reserved in `naming-system.md`. Any visual redesign.

## 15. Handoff notes

Add a line to `.dump/rebrand/second-brain.md` marking the identity sweep closed with the audit path, since that file is the entry point a future rebrand reader starts from.
