# What the review round on PR #69 was worth, and what it changed

Roadmap step 12, issue #14, PR #69 on `arena/01a0cbec-mauscode`, review round of
2026-09-23 against head `eb4a2bf`. This is the record of every finding the round
produced, what each one was worth, and what was done about it, so the next reader
does not have to re-judge a bot's opinion or re-derive why two findings were left
standing. A second round follows it: the duplication sweep instructed after head
`2c8be15`, recorded under its own heading below against head `dbb9457`.

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

## Round 2: taking the duplication to zero, and where zero stops being the goal

The instruction after head `2c8be15` was "eliminate all code duplication
correctly". Round 1 removed the two blocks a reviewer would have pointed at; this
round removed what was left that could be removed honestly, and writes down what
stayed and why. The measure is a windowed scan over the whole tree at 4- and
6-line windows, keeping only blocks whose copies contain lines this PR added —
stricter than the gate it feeds, since Sonar's CPD threshold for TypeScript is
about 100 tokens and a six-line window of short object entries is well under it.

### `ALL_FEATURES_OFF` replaces `TURN_CONTROLS_OFF`

`TURN_CONTROLS_OFF` named four of the thirteen flags, so every manifest still
restated the other nine and the shared default covered a third of the object. The
flags are not four. They are thirteen booleans that default off, because a
capability nobody proved is a capability this app must not advertise — round 1's
rule, applied to the whole object instead of to the slice that had just grown:

- `FeatureFlags` is now `z.infer<typeof featureFlagsSchema>`, exported in place of a
  hand-named partial, so the type cannot drift from the schema.
- `ALL_FEATURES_OFF` spells all thirteen `false` under `satisfies FeatureFlags`.
  Adding a flag to the schema is a compile error there until its default is chosen
  deliberately, and off is the only default that needs no edit.
- Each manifest reads `features: { ...ALL_FEATURES_OFF, <what this CLI proved> }`.
  A flag that is off because nobody proved it is no longer written at all; a flag
  that is off *for a reason* keeps its reason inline — grok's undocumented `-r`
  composition, cline's broken `--id`, openclaw's missing session ids, roo's
  rejected prompt, the two unverified skills claims.

The direction of the default did not move, so neither did the fail-safe:
`ALL_FEATURES_OFF` is a superset of `TURN_CONTROLS_OFF`, and no provider gained a
control it did not have. That was verified rather than assumed. The effective flag
matrix parsed out of every manifest at `2c8be15` was compared key by key against
the rewritten tree: 130 values across 10 providers, 0 differences; the default
itself checked for 13 keys, all `false`, covering every schema flag with none
outside it. Net: −77/+47 lines across eleven files, most of it deleted negatives.

### One hook for the Claude half of the model picker

`chat-input-area.tsx` and `new-chat-form.tsx` each carried a byte-identical
37-line `useAvailableModels`, an identical connection test and an identical
26-line `claude={{ ... }}` block — about 110 duplicated lines that had already
drifted once, when the effort rows were added to both surfaces by hand in the
round that shipped adaptive thinking. This duplication predates step 12; step 12
added to it, which is what made it worth ending.

`hooks/use-claude-model-picker.ts` now owns the model list and the offline-Ollama
overlay, the custom-config test, the connection test, the resolved Ollama model,
extended thinking, and the capability-driven effort rows. It returns the list plus
a ready props object typed against `AgentModelSelectorProps["claude"]`, exported
from the selector for the purpose, so the block cannot drift from the component it
feeds: add a prop to the selector and the shared object fails typecheck until it
supplies one. The connection test travels inside that object rather than in the
return, because neither surface reads it apart from the picker.

Two things stay with each surface on purpose: `selectedModelId` and
`onSelectModel`. They are the only lines that differ — the composer also stamps the
sub-chat model id — and pulling them into the hook would mean passing callbacks
back out, which is the same coupling wearing a different hat. Net across the two
surfaces: −177/+22, and the drift class is gone rather than merely smaller.

### The transports take the SDK's own options type

Both chat transports restated
`sendMessages(options: { messages: UIMessage[]; abortSignal?: AbortSignal })` and
then repeated the same three lines reading the last user message. Both classes
`implements ChatTransport<UIMessage>`, so the shape was the library's all along,
and restating it did not merely duplicate it — it narrowed it: the real options
carry `trigger`, `chatId`, `messageId` and `ChatRequestOptions`, none of which
either transport could see.

`chat-chunk-atoms.ts`, which already holds the shared transport helpers, now also
holds `SendMessagesOptions = Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]`
and `lastUserPrompt(messages)`. Each transport declares the derived type and reads
the turn once. This is the one duplication the compiler was already holding equal —
an implementation that stops matching its interface does not typecheck — and it was
still worth removing, because what the copies shared was a loss of contract.

### Left standing, with reasons

1. **Import statements.** `import { ALL_FEATURES_OFF, type ProviderCapability } from
   "../../../shared/provider-capabilities"` is identical in ten manifests, and the
   two surfaces share atom import lines. These are references, not behaviour:
   nothing inside them can drift out of step with anything, and the only way to
   "share" an import is a barrel module whose entire job is being imported.
2. **Declarative manifest data.** Seven manifests share
   `contextWindow: null, latencyClass: "cloud", usageSurface: "native"`, and the two
   that share `usageSurface: "none"` share it for the same reason. Unlike the flags,
   these have no fail-safe default: a spread that quietly handed a new provider
   cloud latency or a native usage surface would be a wrong value inherited
   silently, where an off flag is a safe one. Restating a fact per provider is what
   a capability table is for.
3. **Call sites of the new abstractions.** `const { availableModels, ... } =
   useClaudeModelPicker(hiddenModels)` and `claude={{ ...claudePickerProps, ... }}`
   appear in both surfaces because both surfaces use the shared thing. Two call
   sites of one hook are the point, not the residue.
4. **Coincidental windows with pre-existing code.** A `break / default: / break`
   switch tail in `transform.ts` matches three unrelated files; two providers'
   comment prose matches. Neither is a copy of anything this step wrote.

After this round the scan reports no duplicated block of six or more lines in which
both copies contain lines this PR added, other than the manifest data and the call
sites itemised above. The same scan before round 2 reported 21 such groups.

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

Re-run in full against the round-2 head `dbb9457`; every row below is that run.
2 CPU, 3.9 GB, no Electron binary (the postinstall download is intercepted) and no
local build or package.

| Gate | Result |
| --- | --- |
| `biome check .` | 978 files, 0 findings |
| `tsc --noEmit` | 0 errors, after building `packages/runtime-client` for its `dist` types |
| `ratchet:typecheck` | passed, 0 errors against a 0 baseline |
| `vitest run` | 103 files, 1891 passed, 1 skipped |
| `npm run test:node` | 59 passed, 0 failed |
| `npm run test:contracts` | 23 files, 382 passed |
| `npm run lint` | 923 files checked, no findings |
| `ratchet:audit` | passed, 3 critical baseline, no new critical advisories |
| `skills:verify` | 50 of 50 locked skills verified, 2 unrecorded project-owned (pre-existing) |
| `build`, `package:linux` | not runnable here; CI runs them and the results are recorded on the PR |
