# Open questions for the human

One entry per question that only a person can settle, because it needs money, an account, a
public promise, or a product taste the code cannot express. Each entry carries the measurement
that bears on it, so an answer is cheap to give and expensive to get wrong. Answered entries
move to `decisions.md` with the date.

## Blocking a roadmap step

Answered 2026-09-13 and moved to `decisions.md`, the SDK line, the drag and drop library, the Codex default, and the memory owner, plus the sign-in scope at item 18. The remaining items below are still open.

5. Answered 2026-09-14: `name` `mauscode` and `version` `0.1.0` are the target values, and the stale `mauscode-desktop` and `0.0.72` records are corrected by step 31 rather than the other way round.
## Not blocking, but owned by a person

6. Answered 2026-09-14: `dev.mausinc.mauscode` is canonical, PA-1 is corrected to it, and step 31 adds a CI branding guard so the label cannot drift again.
7. Answered 2026-09-14: alpha and stable channels are defined by step 32, with the update feed on GitHub Releases and no CDN.
8. **Apple signing and notarization.** A developer account and a re-provisioned keychain, the
   inherited `21st-notarize` identity is gone. Blocks step 32 for macOS artifacts.
9. **Demo media.** `assets/worktree.gif`, `assets/plan-mode.gif` and `assets/cursor-ui.gif` are
   1Code footage with the old name burned into the frames. Re-record, or drop them from the
   README until the interface settles.
10. Answered 2026-09-14: `sharp` is declared as a devDependency by step 12, the only step allowed to change dependencies. The script stays.
11. **`npm run ts:check`.** It runs `tsgo`, which no CI job uses, and it disagrees with `tsc` by
    a handful of errors. Wire it as a second gate or delete the script.
12. Answered 2026-09-14: keep and absorb per use, verified by the ledger at `app/plans/contracts-adoption.md`, which records lines, importer counts and the step that owns each file.
13. **Stray root artifacts in the repository.** `geist-pixel-circlefont.zip`,
    `neue-haas-grotesk-display-pro.zip`, `pathway-extreme-latin-100-normal.ttf`,
    `package-lock.json` and the `new mauscode branding/` masters. Keep in git, move to
    `assets/`, or move out of the repository. `package-lock.json` is the dangerous one: it is
    what made an npm install resolve `@pierre/diffs@1.4.x` and break the renderer build.
14. **`.github/workflows/lock-regen-temp.yml`.** Delete it, or keep it as the documented escape
    hatch for lockfile regeneration.
15. **1Code data auto-migration.** Read-only detection is ratified. If a migration prompt is ever
    wanted, it needs its own design and tests, per the rejected list in `decisions.md`.
16. Answered 2026-09-14: the handoff convention is stated in `AGENTS.md` §Facts, and `HANDOFF-fork-harvest-context.md` is marked superseded rather than rewritten, since it is a dated record.
17. Answered 2026-09-14: no user model, no user-derived profile, local or otherwise. The data-egress doctrine in `AGENTS.md` and `decisions.md` is the rule, and step 27's egress policy is where it is enforced.