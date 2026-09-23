# What the review round on PR #69 was worth, and what it changed

Roadmap step 12, issue #14, PR #69 on `arena/01a0cbec-mauscode`, review round of
2026-09-23 against head `eb4a2bf`. This is the record of every finding the round
produced, what each one was worth, and what was done about it, so the next reader
does not have to re-judge a bot's opinion or re-derive why two findings were left
standing.

AGENTS.md still says no review bot is configured. That is now false in three
directions: Sourcery, CodeAnt and Buoy all review here, and SonarQube Cloud runs a
quality gate on the pull request. Bot output was treated as evidence to verify
against the pinned artifacts and the tree, not as a verdict.

## The round, finding by finding

| Source | Finding | Verdict | Where it landed |
| --- | --- | --- | --- |
| Sourcery | A prompt suggestion stayed in the sub-chat atom after the next turn began | Real bug | `eb4a2bf` |
| Sourcery | Suggestions were stored by sub-chat id alone, so a late one from an older session could overwrite the current turn's | Real bug | `eb4a2bf` |
| CodeAnt | `KillBash`, `BashOutputTool`, `AgentOutput` and `AgentOutputTool` had no registry entry, so persisted calls rendered as generic rows | Real gap | `df4b974` |
| Buoy | `min-h-[32px]` should be `min-h-8`, twice, in the effort sub-menu | Declined | PR comment |
| SonarCloud | Quality gate failed: 4.2% duplication on new code against a 3% limit | Real, and this step's own making | `685aebd`, `fe09b5a` |
| SonarCloud | `handlePromptSuggestion` nested in the transformer closure | Real, cheap | `57e8cd3` |
| SonarCloud | Effort sub-menu props not read-only | Real, cheap | `3306846` |
| SonarCloud | `onData` cognitive complexity 43 against 15 | Real shape problem, mostly pre-existing | `dc182be`, `fe09b5a` |
| SonarCloud | `NewChatForm` cognitive complexity 23 against 15 | Pre-existing, deferred | below |
| SonarCloud | `renderPart` in `assistant-message-item.tsx` cognitive complexity 70 against 15 | Pre-existing, deferred | below |

Duplication was the only condition the quality gate actually failed on. The three
cognitive-complexity reports are annotations against new code, and two of the three
are reported only because this PR touched lines inside functions that were already
over the limit.

## The duplication was this step's own making

The pin added three turn-shaping features to the capability manifest. Ten backends
each grew the same six lines: a three-line comment pointing at the research record,
then `effort`, `adaptiveThinking` and `promptSuggestions` set to false. Eight of the
ten were byte-identical, and a scan for repeated eight-line windows over the tree
returned them as the single largest duplicated block touching new code.

`TURN_CONTROLS_OFF` in `src/shared/provider-capabilities.ts` now holds the "when in
doubt, false" answer in the module that owns the rule. A manifest spreads it and
names only what its own backend carries: Codex overrides `effort`, Claude turns all
three on and so inherits nothing. The forcing function is worth more than the line
count — a fourth flag added to the schema now fails typecheck in one place instead
of being silently missing from whichever manifest someone forgot.

The second duplication source was not written by this step but was exposed by it.
`chat-chunk-atoms.ts` states that it was extracted from the Claude IPC transport so
the native runtime transport could reuse identical question, compacting and
prompt-extraction behaviour, and then the Claude transport kept its own copies:
`applyQuestionChunks`, `applyCompactingChunks`, `clearStalePendingQuestion`,
`extractPromptText` and `extractPromptImages` were called only from
`native-chat-transport.ts`, while `ipc-chat-transport.ts` carried the same logic
inline and two private methods byte-identical to the shared extractors. Refactoring
`onData` into handlers made that copy-paste visible; `fe09b5a` deletes it, 172
lines, and the two transports can no longer drift on the question lifecycle.
`session-init` deliberately stays per transport, because the native runtime reads a
cached snapshot and fills the gaps while the CLI reports the full set on init.

## The two complexity findings this step does not take

| Function | Reported | What this PR changed inside it | What clearing it needs |
| --- | --- | --- | --- |
| `renderPart`, `assistant-message-item.tsx:803` | 70 against 15 | +3 / −4 lines: one `if` removed, one equality swapped for `isSubagentToolType()` | The 250-line render dispatcher split into components. It closes over roughly a dozen locals — orphan and nested tool-call sets, the nested-tools map, collapse state, the file-open callback — so each extraction is a props contract of its own, and nothing tests the file |
| `NewChatForm`, `new-chat-form.tsx:216` | 23 against 15 | +11 lines, one of them a ternary, so one point of the 23 | Section extraction across a 2300-line component whose remaining complexity is spread through the JSX body as `&&` and ternary expressions rather than sitting in one block |

Both are pre-existing conditions reported on new code because the PR touched them.
Neither blocks the gate. Both are left standing on purpose: a dependency-pin pull
request that also rewrites two legacy renderer components cannot be reviewed as a
dependency-pin pull request, and there is no test coverage to make the rewrite
safe. They are named here so they are handed off rather than quietly dropped, and
the transport refactor is the model for how to do them — one handler per side
effect, an explicit context, and a single exit path.

## What was declined, and why

Buoy asked for `min-h-8` in place of `min-h-[32px]` on two rows of the effort
sub-menu. `min-h-[32px]` appears 14 times across `src/**/*.tsx` and `min-h-8`
appears zero times, so the token form has no precedent in this renderer, one of the
two flagged lines is pre-existing Codex code this PR only generalized, and adopting
the token here would make this component the single exception while leaving the
other 14 arbitrary values in place. A repo-wide move to spacing tokens is a
formatting contract of its own.

## One finding this step must not fix

The pin renames tools, and the permission classifier keeps its own name table.
`READ_ONLY_TOOLS` in `src/shared/permissions/classifier.ts` lists `BashOutput`,
which the 2.1.270 binary no longer emits: it emits `TaskOutput`. `classifyToolName`
falls through to `approval` / `unclassified-tool`, "no classification, so it takes
the middle tier", for any name it does not know, so the direction of the drift is
fail-safe — reading background output now costs an approval instead of being
read-only, rather than the other way round. The same is true of `TaskStop` for
`KillShell` and `KillBash`, and of `Agent` for `Task`.

It is recorded rather than changed here because the classifier belongs to the
permission-floor work of steps 10 and 11, which another lane owns, and a
dependency-pin step editing that table is exactly the cross-lane collision the lane
rules exist to prevent. Whoever owns the classifier should decide whether the
renamed tools take their predecessors' classes.

## Verification in this sandbox

2 CPU, 3.9 GB, no Electron binary (the postinstall download is intercepted) and no
local build or package.

| Gate | Result |
| --- | --- |
| `biome check .` | 977 files, 0 findings |
| `tsc --noEmit` | 0 errors, after building `packages/runtime-client` for its `dist` types |
| `ratchet:typecheck` | passed, 0 errors against a 0 baseline |
| `vitest run` | 103 files, 1891 passed, 1 skipped |
| `npm run test:node` | 59 passed, 0 failed |
| `npm run test:contracts` | 23 files, 382 passed |
| `npm run lint` | 922 files checked, no findings |
| `ratchet:audit` | passed, 3 critical baseline, no new critical advisories |
| `skills:verify` | 50 of 50 locked skills verified, 2 unrecorded project-owned (pre-existing) |
| `build`, `package:linux` | not runnable here; CI runs them and the results are recorded on the PR |
