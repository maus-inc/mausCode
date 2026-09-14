# Open questions for the human

One entry per question that only a person can settle, because it needs money, an account, a
public promise, or a product taste the code cannot express. Each entry carries the measurement
that bears on it, so an answer is cheap to give and expensive to get wrong. Answered entries
move to `decisions.md` with the date, and their number stays here with a one-line answer so a
citation by item number never rots.

## Answered

Batch 1, 2026-09-13, recorded in `decisions.md` and folded into the roadmap plan §4a: the Claude Agent SDK
line (item 1), the drag and drop library (2), the Codex default constant (3), the memory store owner (4),
and the built-in sign-in scope (18).

Batch 2, 2026-09-14, recorded in `decisions.md`, plan §4a, and the six step bodies it moved:

5. `name` `mauscode` and `version` `0.1.0` are the target values, and the stale `mauscode-desktop` and
   `0.0.72` records are corrected by step 31 rather than the other way round.
6. `dev.mausinc.mauscode` is canonical, PA-1 is corrected to call `com.maus-inc.mauscode` stale, the display
   name is `mausCode`, and step 31 adds a CI branding guard so the label cannot drift again.
7. Alpha and stable channels are defined by step 32, with the update feed on GitHub Releases and no CDN.
10. `sharp` is declared as a devDependency by step 12, the only step allowed to change dependencies. The
    script stays.
12. Keep `src/shared/contracts/` and absorb it per use, verified by the ledger at
    `app/plans/contracts-adoption.md`, which records lines, importer counts and the step that owns each file.
16. The handoff convention is stated in `AGENTS.md`; nothing is committed at the root, and
    `.dump/ci/research/HANDOFF-fork-harvest-context.md` is marked superseded rather than rewritten, since a
    dated record stays truthful.
17. No user model and no user-derived profile, local storage included. The data-egress doctrine in
    `AGENTS.md` is the rule, and step 27's egress policy is where it is enforced.

## Still open

Only two items need a person and neither is a code decision.

8. **Apple signing and notarization.** Needs a developer account and a re-provisioned keychain; the
   inherited `21st-notarize` identity is gone. This is money and an admin seat, not code, so step 32 ships
   the workflow with a placeholder that fails loudly until this is settled.
9. Answered 2026-09-14: left in place. The three GIFs stay in `assets/` unreferenced, and re-recording is
   deferred to the README pass that happens after the interface settles.
11. Answered 2026-09-14: wired. Step 02 lands `tsgo --noEmit` as a second CI gate after the disagreement
   with `tsc` is measured and each case justified; `tsc` remains the blocking gate.
13. Answered 2026-09-14: moved to `assets/branding/` in git, labelled design inputs, never build inputs.
   `package-lock.json` is already gone from the root, verified this session, and stays gone.
14. Answered 2026-09-14: kept and made legitimate. Step 31 renames it to a supported manually dispatched
   workflow with the conditions for its use written in the file.
15. **1Code data auto-migration.** Read-only detection is ratified. If a migration prompt is ever wanted,
   it needs its own design and tests, per the rejected list in `decisions.md`.
