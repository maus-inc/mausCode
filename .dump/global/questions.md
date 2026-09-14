# Open questions for the human

One entry per question that only a person can settle, because it needs money, an account, a
public promise, or a product taste the code cannot express. Each entry carries the measurement
that bears on it, so an answer is cheap to give and expensive to get wrong. Answered entries
move to `decisions.md` with the date, and their number stays here with a one-line answer so a
citation by item number never rots. A new question is appended here before it goes anywhere else,
and a question that can be answered by measurement is not a question, it is a task.

Eighteen items were answered between 2026-09-13 and 2026-09-14, in four batches, each recorded in
`decisions.md` with the rejected option named. One item has since been added, because it is a configuration
choice on your side of a tool the code cannot see.

## Open

19. **Automatic review or planning on these issues while the bodies lag.** `gh api` shows CodeRabbit posted an
   implementation plan on #3 through #14 within minutes of filing, with a revision on #4 the next morning. Two of
   those plans are now wrong on their face: #7 proposes the hardcoded Codex constant the human replaced with a
   runtime resolver, and #14 contains none of the ratified dependency work. Worse, #34's plan says its checkout has
   no `.dump/` tree, no `scripts/ci/*` and no `packages/runtime-client`, so whatever branch that bot reads, it is
   not `arena/01a097c4-mauscode`. Options: (a) pause issue-triggered planning until the twelve bodies are synced
   and the bot's base branch is set to this one; (b) sync the bodies now with the loop in
   `.dump/app/plans/2026-09-14-issue-drift-notices.md` §3 and accept that plans written from the old base stay
   wrong; (c) let it run and treat bot plans as drafts an agent must re-derive from the files. Recommendation (a)
   then (b), because a confident wrong plan costs more than a missing one. Blocking nothing in the roadmap itself.

## Answered 2026-09-13, batch 1

1. Claude Agent SDK `0.3.270` with Claude CLI `2.1.270`, not the changelog note's `0.2.63`. Step 12 lands it.
2. `@dnd-kit` approved as an explicit exception to the no-new-dependency rule, added by step 12 with exact
   pins and a recorded bundle delta.
3. Codex default read from the pinned CLI at runtime, static fallback, loud refusal when neither answers.
4. Memory ownership hybrid: the runtime proposes, mausCode stores, the user accepts.
18. Built-in sign-in scope: gate and login modal out, provider OAuth and the credential switcher kept.
   Ratified as PA-20, which step 45 now executes.

## Answered 2026-09-14, batch 2

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

## Answered 2026-09-14, batch 3

9. Left in place. The three demo GIFs stay in `assets/` unreferenced, and re-recording is deferred to the
   README pass that happens after the interface settles.
11. Wired. Step 02 lands `tsgo --noEmit` as a second CI gate after the disagreement with `tsc` is measured
   and each case justified; `tsc` remains the blocking gate.
13. Moved to `assets/branding/` in git, labelled design inputs, never build inputs. `package-lock.json` is
   already gone from the root, verified this session, and stays gone.
14. Kept and made legitimate. Step 31 renames `.github/workflows/lock-regen-temp.yml` to a supported,
   manually dispatched workflow with the conditions for its use written in the file.

## Answered 2026-09-14, batch 4

8. Not wanted. No signing and no notarization anywhere: unsigned artifacts plus checksums, documented
   Gatekeeper bypass, and auto-update off by default. Step 32's notary placeholder is deleted rather than
   left to fail.
15. Never. 1Code data stays read-only detection permanently, with no import button and no migration, so
   nothing a user has is ever written by us.
