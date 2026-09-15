# Drift notices for the 12 lagging issues plus the index

Dated operational record, 2026-09-14. This file exists because the planning session could create GitHub
issues but not edit them: `PATCH`, comment posting and label assignment all return 403 `Resource not
accessible by integration`, verified by probe the same day. The human accepted the drift as the steady state
and chose comments over rewriting bodies, which keeps every issue number stable, so `step NN` still means
`#NN+2` and step 22's label adapter is unaffected.

Each block below is the exact comment text for one issue. **Nothing in this file has been posted.** The planning
integration was asked to run the loop on 2026-09-14 and every write it attempted returned 403 `Resource not
accessible by integration`: `gh issue comment` (GraphQL), `POST /repos/maus-inc/mausCode/issues/4/comments` (REST),
`PATCH` on the same issue, and, new since the filing of #3 to #48 an hour earlier, `POST /repos/.../issues` itself,
which is how the 46 issues were created in the first place. Reads on the same endpoints succeed, and repo-level
`POST /labels` still works, which is why this pack exists as a file rather than as thirteen comments. Posting is
therefore a human action: run §1 from a clone with your own `gh`.

**Update, 2026-09-15: the wall is issue-scoped, not global.** Probed on branch `arena/01a0a08a-mauscode`,
`POST /repos/maus-inc/mausCode/issues/54/comments` and `PATCH /repos/maus-inc/mausCode/pulls/54` both succeed,
while `gh issue comment 20`, `POST /repos/maus-inc/mausCode/issues/20/comments` and `PATCH` on that issue still
return 403. So the installation carries pull-request write and issue read-only, which is a narrower and more
useful statement than the 2026-09-14 note above. PR review replies and body edits can be written from an agent
session; the thirteen notices below still cannot, and §1 still needs a human, or an `Issues: write` grant.

## 0a. Why this is now urgent rather than cosmetic

`gh api repos/maus-inc/mausCode/issues/N/comments` on #3 through #14 shows an automatic reviewer already acting on
these issues: **CodeRabbit has posted an implementation plan on them**, one comment on most and two on #4 and #11,
all dated 2026-09-13T22:2x, i.e. within minutes of filing, with a follow-up revision on #4 at
2026-09-14T07:53Z. Those plans were written from the bodies, so they encode the decisions the human has since
reversed. Three verified examples:

| Issue | What its generated plan proposes | What was ratified instead |
| --- | --- | --- |
| #7, step 05 | "Replace the duplicated `DEFAULT_CODEX_MODEL` literals … with imports of the shared constants", with a hardcoded model id value of `gpt-5.3-codex` | A runtime resolver: read the model catalog from the pinned Codex CLI, static fallback, loud refusal when neither answers. The plan ships exactly the bug the step exists to kill |
| #14, step 12 | No mention of `@dnd-kit`, `sharp`, or the SDK and CLI pins | This step is the only dependency step: `0.3.270` and `2.1.270`, three drag-and-drop packages, and `sharp` as a devDependency |
| #34, step 32 | "Upload artifacts, checksums, and manifest to a draft GitHub Release with … an unsigned marker", and it reports that its checkout is **missing** `.github/workflows/ci.yml`, `scripts/ci/*`, `packages/runtime-client`, `src/shared/app-identity.ts` and the whole `.dump/` tree | Unsigned is now correct by decision rather than by accident, but the missing-files note is the real signal: the bot is planning against a base that is not `arena/01a097c4-mauscode`, so it cannot read the step files at all |

That third row changes the recommendation. Syncing the twelve bodies fixes drift against decisions; it does not
fix a reviewer whose checkout lacks the corpus. Both need doing, and the second is a configuration call, filed as
`questions.md` item 19.

## 0. Which issues and why

| Issue | Step | Why its body is behind |
| --- | --- | --- |
| #4 | 02 | gained the `tsgo` second typecheck gate, batch 3 |
| #5 | 03 | contracts ledger rule, and signing moved from "needs the human" to refused outright |
| #6 | 04 | its four questions were answered, so it is a record now, not a request |
| #7 | 05 | the constant became a runtime resolver with a cache, a fallback and a refusal path |
| #14 | 12 | SDK and CLI target versions ratified, plus three drag-and-drop packages and `sharp` |
| #19 | 17 | native HTML5 drag dropped for a shared `DndContext` owned across steps 17, 18 and 37 |
| #26 | 24 | memory ownership ratified as hybrid, sharing one proposal queue with step 43 |
| #29 | 27 | the data-egress doctrine is now the acceptance test, and no user model is stored |
| #33 | 31 | identity settled, `assets/branding/` destination, demo GIFs kept, lockfile workflow kept |
| #34 | 32 | no signing at all, four targets kept, alpha and stable channels |
| #45 | 43 | skill proposals merge into step 24's single accept surface |
| #47 | 45 | scope ratified as PA-20 rather than assumed |
| #48 | index | label work verified done, drift accepted, section numbering for the plan recorded |

## 0b. What roadmap step 04 needs from this file

Step 04's third acceptance criterion asks for one comment each on #14, #19, #20 and #26, saying the step is
unblocked and naming the answer that unblocks it. Three of those four are blocks in this file, at `#14 · step 12`,
`#19 · step 17` and `#26 · step 24`, and they already name the answer.

The fourth, #20, is not here and should not be turned into a drift notice: its body already reads
`| Depends on | {{S04}} decision 2, {{S17}} |`, so nothing about it is stale. Its comment text lives in
`.dump/app/roadmap/04-open-decisions.md` §15 with its own one-line command. Posting that plus this file's loop is
everything step 04 owes, and no separate comment pack is needed.

All four were re-attempted on 2026-09-15 and all four returned 403, so the state is unchanged from the date above.
The extractor's block numbers are positional: `005`, `006` and `007` are the notices for #14, #19 and #26, which
§15 puts in one loop for whoever runs the four commands.

## 1. Posting them

From the repository root, with your own `gh` auth. It extracts the fenced blocks in order and maps them to the
issue numbers in the table above.

```sh
nums=(4 5 6 7 14 19 26 29 33 34 45 47 48)
out=$(mktemp -d)
awk -v out="$out" '
  /^```markdown$/ { n++; f = 1; fn = sprintf("%s/%03d.md", out, n); next }
  /^```$/ { f = 0; next }
  f { print > fn }
' .dump/app/plans/2026-09-14-issue-drift-notices.md
i=0
for n in "${nums[@]}"; do
  i=$((i+1))
  gh issue comment "$n" --repo maus-inc/mausCode --body-file "$(printf '%s/%03d.md' "$out" "$i")"
done
echo "posted ${i} comments from $out"
```

Check the result with `gh issue view 34 --comments --repo maus-inc/mausCode | head -30`.

## 1b. Alternative, if you want exact bodies rather than comments

A comment tells a reader the body is stale; it does not fix the body. GitHub's own editor can, and the loop below
regenerates the twelve bodies with `AGENTS.md` prepended exactly the way they were filed, so each one can be
pasted into the issue's edit box in the browser. Nothing is pushed to GitHub by the script; it only writes files.

```sh
mkdir -p /tmp/bodies
for n in 02 03 04 05 12 17 24 27 31 32 43 45; do
  { printf '## Starter: the repository ground rules, verbatim\n\n'; cat AGENTS.md;
    printf '\n---\n\n'; cat ".dump/app/roadmap/$n-"*.md; } > "/tmp/bodies/$n.md"
done
ls -l /tmp/bodies
```

Then edit issue `#NN+2` in the browser and paste the matching file.

One thing to know before you do it: the step **files** keep `{{SNN}}` tokens on purpose, 77 of them across these
twelve, counted 2026-09-14, because a token lets the plan be resequenced without editing prose, while the filed GitHub bodies
were written with the real numbers substituted. So resolve the tokens as you generate, or you will put the token
form back into GitHub. The loop below does the substitution inline, and it is exact because the rule is arithmetic:
`step {{SNN}}` is issue `#NN+2`.

```sh
mkdir -p /tmp/bodies
for n in 02 03 04 05 12 17 24 27 31 32 43 45; do
  { printf '## Starter: the repository ground rules, verbatim\n\n'; cat AGENTS.md;
    printf '\n---\n\n'; cat ".dump/app/roadmap/$n-"*.md; } \
    | perl -pe 's/\{\{S(\d\d)\}\}/"#".($1+2)/ge' > "/tmp/bodies/$n.md"
done
grep -c "{{S" /tmp/bodies/*.md | grep -v ":0" || echo "no tokens left"
```

Twelve pastes, about ten minutes, and the issue list then matches the files exactly. Do it and §4b of the roadmap
plan can be marked spent rather than carried forever, and the drift comments in this file become unnecessary.

## 2. The comment texts

### #4 · step 02

```markdown
**Body drift, 2026-09-14. Read this before the body.**

This body was written before the decision batches landed, and the step gained work since. The truth is
`.dump/app/roadmap/02-gate-policy.md` on `arena/01a097c4-mauscode`.

What changed: `npm run ts:check` runs `tsgo --noEmit` and no CI job uses it, and the human ratified it as a
**second typecheck gate** rather than a deleted script. So this step now also measures the disagreement between
`tsgo` and `tsc` on the current tree, lists every case in the PR with a one-line reason, and adds the job only
when that diff is empty or every line of it is justified. `tsc` stays the blocking zero-error gate and
`.github/ci-baselines/typecheck.txt` stays its record. If the delta cannot reach zero in one change, ship the
measurement and the policy text and hold the wiring as a follow-up on this issue rather than landing a red gate.

Where this body and the file disagree, the file wins. A `step {{SNN}}` reference in this body is issue `#NN+2`.
```

### #5 · step 03

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/03-build-gate.md` on `arena/01a097c4-mauscode`. Two additions:

- Out of scope changed. This body says signing and notarization are out of scope because they "need the human".
  They are out of scope because the human **refused them outright** on 2026-09-14, so no later step waits on a
  certificate decision. Recorded in `.dump/global/decisions.md`.
- Handoff notes grew a rule. If this step adopts any type under `src/shared/contracts/`, its row in
  `.dump/app/plans/contracts-adoption.md` is updated in the same commit. The measured baseline for that tree,
  re-taken at `f5506b9` on 2026-09-14, is 44 source files at 19,395 lines plus 23 ported test files at 5,465
  lines, 24,860 total, with zero external importers; the 23 test files do run under `npm run test`. The ledger
  carries these rows and a note recording that its first pass read 19,439, 5,488 and 24,927, each one line per
  counted file too high. `wc -l src/shared/contracts/*.ts | tail -1` reproduces the total.

Where this body and the file disagree, the file wins. A `step {{SNN}}` reference in this body is issue `#NN+2`.
```

### #6 · step 04

```markdown
**Answered. Read this before the body.**

This issue asked four questions and the human answered all four on 2026-09-13, plus the sign-in scope question
from the same list. The answers are in `.dump/global/decisions.md` and folded into
`.dump/app/plans/2026-09-13-mauscode-roadmap.md` §4a; the record form of this step is
`.dump/app/roadmap/04-open-decisions.md`, which now documents decisions rather than requesting them.

Summary: Claude Agent SDK `0.3.270` with Claude CLI `2.1.270`, not the changelog note's `0.2.63`. `@dnd-kit`
approved as an explicit exception to the no-new-dependency rule, added by step 12 with exact pins and a recorded
bundle delta. Codex default read from the pinned CLI at runtime with a static fallback and a loud refusal when
neither answers. Memory ownership hybrid: the runtime proposes, mausCode stores, the user accepts.

This issue can be closed as spent, or kept open as the audit trail, your call; nothing downstream waits on it
because steps 05, 12, 17, 18, 24, 37 and 43 already carry the consequences.
```

### #7 · step 05

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/05-codex-default-constant.md`. The step is no longer a constant swap. The human
ratified reading the model catalog from the pinned Codex CLI at runtime, so it becomes a resolver: a cache, a
static fallback when the CLI cannot answer, and a loud refusal when neither source answers. The bug it kills is
the divergence between `src/main/lib/trpc/routers/codex.ts:146` (`gpt-5.5`) and
`src/renderer/features/agents/lib/acp-chat-transport.ts:41` (`gpt-5.5/high`), which is one value written in two
places.

Where this body and the file disagree, the file wins. A `step {{SNN}}` reference in this body is issue `#NN+2`.
```

### #14 · step 12

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/12-sdk-and-pins.md`. Three ratified answers landed on this step, and it is now
the only step allowed to touch `package.json` and `bun.lock`:

- Target line is Claude Agent SDK `0.3.270` with Claude CLI `2.1.270`, gated by its own 0.2 to 0.3 spike. Steps
  13, 19, 20, 23, 24 and 35 unblock behind this issue, so do not let it sit.
- `@dnd-kit/core`, `@dnd-kit/sortable` and `@dnd-kit/utilities` are added here in their own commit, exact pins,
  with bundle bytes recorded per target with and without them, because steps 17, 18 and 37 share one
  `DndContext` at the agents layout root instead of each growing a drag implementation.
- `sharp` is declared as a devDependency. `scripts/generate-icon.mjs:21` imports it while `package.json` declares
  nothing, so the icon script currently runs only when a transitive copy happens to be hoisted, and a fresh
  `npm install --ignore-scripts` cannot run it at all. This is the second and last approved dependency exception.

Where this body and the file disagree, the file wins. A `step {{SNN}}` reference in this body is issue `#NN+2`.
```

### #19 · step 17

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/17-subchat-optimistic-ordering.md`. The drag mechanism is decided: native HTML5
drag and drop is out, `@dnd-kit` is in, added by step 12 (#14) with exact pins. Optimistic creation and real
ordering use one shared `DndContext` mounted at the agents layout root, which steps 17, 18 and 37 consume
rather than each owning a context, and step 30 records the bundle cost they carry.

Where this body and the file disagree, the file wins.
```

### #26 · step 24

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/24-agent-memory.md`. Ownership is settled as hybrid: the runtime may **propose**
a memory, mausCode **stores** it, the user **accepts** it. The engine's own memory store stays dark so nothing
writes twice, and this step shares one proposal queue and one accept surface with step 43 (#45), whose skill
proposals arrive through the same place. That also settles the question of who decays and who audits: mausCode
does, in the app-side table, which is what makes the record showable to the user.

One more constraint this body predates: nothing here may store a derived model of the user. The data-egress
doctrine in `AGENTS.md`, ratified 2026-09-14, forbids it locally as well as remotely.

Where this body and the file disagree, the file wins.
```

### #29 · step 27

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/27-research-lane-and-egress-policy.md`. The acceptance test is now a quoted
doctrine the human ratified on 2026-09-14 and which also sits in `AGENTS.md`:

> Nothing leaves the machine that the user did not ask for, and anything that can leave is visible where the user
> can see it.

Concretely: a search or fetch that cannot be traced to a user request, a recorded URL, a byte cap and a redaction
rule does not ship. Telemetry, update pings on a load path and silent remote fetches are excluded by the same
sentence. And no user-derived profile or behavioural model is stored anywhere, local storage included, which
closes the Honcho-style question this step was flagged as gating.

Where this body and the file disagree, the file wins.
```

### #33 · step 31

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/31-identity-and-repo-hygiene.md`. Four things this body lists as open are
decided, so this step has fewer judgement calls and more verification:

- `build.appId` stays `dev.mausinc.mauscode`, display name `mausCode`, npm name and CLI `mauscode`.
  `.dump/app/decisions/provisional-assumptions.md` PA-1 is corrected to call `com.maus-inc.mauscode` stale, and
  `package.json` target values are `name` `mauscode` and `version` `0.1.0`.
- Add a CI branding guard that fails on `21st` or T3 identity strings outside vendored comments and licence
  files. Branding is no longer a one-off cleanup.
- The root font archives and the `new mauscode branding/` masters move to `assets/branding/`, kept in git, with a
  README line saying design inputs, never build inputs. The three demo GIFs in `assets/` stay exactly where they
  are, and `package-lock.json` is confirmed absent and stays absent.
- `.github/workflows/lock-regen-temp.yml` is kept and renamed into a documented, manually dispatched escape hatch
  rather than deleted. The icon script is verified here, not retired, because step 12 (#14) declares `sharp`.

Where this body and the file disagree, the file wins.
```

### #34 · step 32

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/32-release-workflow-and-artifacts.md`. Two ratified answers changed this step,
and one of them removes work from it:

- Channels are defined here: **alpha and stable**, each with its own manifest and feed path, published to GitHub
  Releases, no CDN.
- **There is no signing job and no notary placeholder.** The human refused signing and notarization for this
  program on 2026-09-14, so the release is unsigned by design: `SHA256SUMS` is the integrity story, the README
  states the one-time right-click Open past Gatekeeper, and auto-update stays off unless `MAIN_VITE_UPDATE_FEED_URL`
  is set at build time, which is what makes publishing an unsigned artifact safe rather than dangerous. Do not
  leave a secrets-dependent branch in the workflow for a future identity: a code path CI never exercises is where
  a release-trust bug hides. Adding signing later is a new decision with its own step.
- The four-target matrix stays, as a deliberate CI-minute cost, so cross-platform breakage surfaces at release
  time instead of in a nightly someone skips.

Where this body and the file disagree, the file wins.
```

### #45 · step 43

```markdown
**Body drift, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/43-skill-lifecycle-and-disclosure.md`. Skill proposals are not their own accept
surface: the ratified memory model (step 24, #26) is one queue with one accept UI, and skill proposals arrive
through it, so this step builds on that surface instead of adding a second inbox. The `name` and `description`
validation and the load-on-trigger-only disclosure model are unchanged.

Where this body and the file disagree, the file wins.
```

### #47 · step 45

```markdown
**Assumption ratified, 2026-09-14. Read this before the body.**

The truth is `.dump/app/roadmap/45-remove-built-in-sign-in.md`. This step used to proceed on a provisional
assumption; the human confirmed the scope on 2026-09-13 and it is recorded as
`.dump/app/decisions/provisional-assumptions.md` PA-20. Kept: provider OAuth, the credential switcher,
`auth-store.ts`, `auth-manager.ts` and the loopback callback server that MCP auth depends on. Removed: the
hosted gate and the login modal. Wholesale replacement of the credential and OAuth plumbing stays refused, which
is the option this issue's body may still describe as worth considering.

Where this body and the file disagree, the file wins.
```

### #48 · index

```markdown
**Status update from the planning session, 2026-09-14.**

Three things changed since this index was written, and none of them moves the ordering.

1. **The `roadmap` label is on all 46 issues, #3 through #48**, applied in the web UI on 2026-09-14 and verified
   with `gh issue list --limit 200`. Step 22's issue trigger is therefore live. The write-probe issue that was
   created to test what the planning integration could do has been deleted.
2. **Twelve bodies are behind their files and that is accepted as the steady state**, not a queue of fixes: the
   integration that created these issues can create but not edit, comment or label, all verified 403. Twelve
   drift notices are being posted as comments from `.dump/app/plans/2026-09-14-issue-drift-notices.md`. For any
   issue in this range: `.dump/app/roadmap/NN-<slug>.md` is the source of truth, and `#NN+2` is its issue.
   Unresolved `{{SNN}}` tokens are in **38 of these 46 bodies**, not the six this plan first recorded, and they
   resolve the same way.
3. **Eighteen open questions are answered**, in four batches, recorded with their rejected options in
   `.dump/global/decisions.md`, and one question was added after them, so `.dump/global/questions.md` carries
   exactly one open item, question 19 on automatic review planning. The consequences landed in
   steps 02, 03, 04, 05, 12, 17, 24, 27, 31, 32, 43 and 45. Notably: no signing or notarization anywhere, all four
   release targets kept, `@dnd-kit` and `sharp` as the only dependency exceptions, `tsgo` as a measured second
   typecheck gate, the vendored contracts kept and absorbed per use with a ledger, the data-egress doctrine as a
   rule in `AGENTS.md`, 1Code data read-only permanently, and no stored model of the user.

The plan gained §4a (ratifications), §4b (the drift, in its accepted form) and §4c (this session ends at
planning: no step is executed from it). Use `.dump/app/roadmap/00-how-to-use-this-roadmap.md` to hand a step to
an agent; it is the operator's manual for the sequence and it points at `AGENTS.md` for the method.
```
