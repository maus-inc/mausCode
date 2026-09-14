# Open questions for the human

One entry per question that only a person can settle, because it needs money, an account, a
public promise, or a product taste the code cannot express. Each entry carries the measurement
that bears on it, so an answer is cheap to give and expensive to get wrong. Answered entries
move to `decisions.md` with the date.

## Blocking a roadmap step

Answered 2026-09-13 and moved to `decisions.md`, the SDK line, the drag and drop library, the Codex default, and the memory owner, plus the sign-in scope at item 18. The remaining items below are still open.

5. **Package identity drift.** `package.json` on this branch reads `name: mauscode`,
   `version: 0.0.72`, while `rebrand/audits/ui-rebrand-audit.md` and `ci/second-brain.md`
   record `mauscode-desktop` and `0.1.0`. Confirm the target values before step 31 changes them,
   because a rename of the npm name touches `bun.lock` and the packaged userData path.

## Not blocking, but owned by a person

6. **App id label.** `dev.mausinc.mauscode` is what the tree and the naming system agree on,
   verified this session in `package.json` `build.appId` and `rebrand/decisions/naming-system.md`.
   Two records disagree: `app/decisions/provisional-assumptions.md` PA-1 writes
   `com.maus-inc.mauscode`, and `naming-system.md` calls the `dev.` domain a placeholder pending
   D4. A reverse-domain label may not contain a hyphen, which is why `io.github.maus-inc.mauscode`
   was rejected, so the `com.maus-inc.mauscode` note is stale rather than an alternative. Confirm
   `dev.mausinc.mauscode` and mark PA-1 spent.
7. **Release channels and distribution identity.** Stable plus beta, or releases only. Also
   the product domain for the update feed. Blocks step 32 from being more than an unsigned build.
8. **Apple signing and notarization.** A developer account and a re-provisioned keychain, the
   inherited `21st-notarize` identity is gone. Blocks step 32 for macOS artifacts.
9. **Demo media.** `assets/worktree.gif`, `assets/plan-mode.gif` and `assets/cursor-ui.gif` are
   1Code footage with the old name burned into the frames. Re-record, or drop them from the
   README until the interface settles.
10. **`scripts/generate-icon.mjs`.** It imports `sharp`, which is not a dependency, so
    `bun run icon:generate` cannot run. Add the dependency, or retire the script and generate
    icons the way `rebrand/second-brain.md` records.
11. **`npm run ts:check`.** It runs `tsgo`, which no CI job uses, and it disagrees with `tsc` by
    a handful of errors. Wire it as a second gate or delete the script.
12. **Vendored contracts.** Adopt per use, recommended, or delete `src/shared/contracts/`.
    Measured: 24,860 lines, zero importers outside the directory. Step 13 wires the two pull
    request files either way; the rest is a policy question.
13. **Stray root artifacts in the repository.** `geist-pixel-circlefont.zip`,
    `neue-haas-grotesk-display-pro.zip`, `pathway-extreme-latin-100-normal.ttf`,
    `package-lock.json` and the `new mauscode branding/` masters. Keep in git, move to
    `assets/`, or move out of the repository. `package-lock.json` is the dangerous one: it is
    what made an npm install resolve `@pierre/diffs@1.4.x` and break the renderer build.
14. **`.github/workflows/lock-regen-temp.yml`.** Delete it, or keep it as the documented escape
    hatch for lockfile regeneration.
15. **1Code data auto-migration.** Read-only detection is ratified. If a migration prompt is ever
    wanted, it needs its own design and tests, per the rejected list in `decisions.md`.
16. **`.dump/ci/research/HANDOFF-fork-harvest-context.md` instruction hygiene.** That handoff
    tells an agent to push with a token embedded in the remote URL and to co-author with a bot
    identity. Both are wrong here. `AGENTS.md` now forbids them; confirm the handoff file should
    be marked superseded rather than edited, since it is a dated record.

17. **Does mausCode model its user?** hermes-agent integrates Honcho for a dialectic user model,
    an evolving picture of preferences and working style. Porting that means holding a persistent
    profile of the human on disk. Options: no user model, local-only profile fields the user can
    read and edit in settings, or a full dialectic model. Recommendation, the middle one, and it
    gates any future personalisation step. Blocks nothing yet, and step 44's decay rules assume
    the answer stays local.
