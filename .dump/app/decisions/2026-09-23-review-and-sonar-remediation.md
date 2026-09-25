# What the review round on PR #69 was worth, and what it changed

Roadmap step 12, issue #14, PR #69 on `arena/01a0cbec-mauscode`, review round of
2026-09-23 against head `eb4a2bf`. This is the record of every finding the round
produced, what each one was worth, and what was done about it, so the next reader
does not have to re-judge a bot's opinion or re-derive why two findings were left
standing. A second round follows it: the duplication sweep instructed after head
`2c8be15`, recorded under its own heading below against head `dbb9457`.
A third round follows that one: every finding and every SonarCloud state still
open taken to either a fix or a decline carrying its evidence, against heads
`19ffbe1` to `cacd3db`.

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

### The gate after the sweep

SonarQube Cloud on head `b75064c`: quality gate passed, duplication on new code
0.5% — 7 duplicated lines out of 1284 new ones — against the 3% limit, the 4.2%
that failed it, and the 1.0% round 1 reached. Security hotspots 0. New issues 1,
down from 2, for the reason recorded in the complexity section below. CodeAnt's
five gates pass and it approved this head. All fifteen substantive GitHub Actions
checks pass: Build on ubuntu-24.04, macos-14 and windows-2022, Package unsigned on
ubuntu-24.04 and macos-14, the lint/test/typecheck quality gates, the security
gates, both Socket reports and CodeRabbit; Buoy, Sourcery and DeepSource skip as
before. Buoy re-posted the same two `min-h-[32px]` → `min-h-8` suggestions and they
are declined again on the evidence already recorded here: the arbitrary form appears
14 times across `src/**/*.tsx`, the token form zero times.

Sonar's per-file measure says where the 7 lines are, and it is one line in each of
seven provider manifests — cline, codex, cursor, grok, hermes, opencode, qwen. Every
file an abstraction touched reports zero duplicated new lines: both surfaces, the new
hook, the selector, both transports, the shared chunk helpers,
`provider-capabilities.ts`, `transform.ts`, `types.ts`, every test file and
`package.json`. The two manifests that report zero are openclaw and roo, which are
the two whose feature blocks carry reasoned false flags with comments — the comment
lines break the window. One duplicated line per manifest is consistent with the two
things the local scan also flags there, the data tail
(`latencyClass: "cloud", usageSurface: "native"`) and the spread line
(`features: { ...ALL_FEATURES_OFF, chat: true`), and with nothing else those files
contain. Neither is a decision stated twice, which is what item 2 above argues, and
0.5% is what is left when the decisions are each stated once.

## Round 3: every finding to a fix or an evidenced decline

The instruction after head `19ffbe1` was to take all of the new review findings and
all of the new SonarCloud states and work through them, leaving each with either a
fix or a decline that carries its evidence. Six commits: `41688f4`,
`e5b602a`, `5a98fb4`, `1900d14`, `cacd3db`, `97f4327`. Five findings were fixed
and three declined, and one of the three names a real defect that belongs to a
different contract rather than to this one.

| Source | Finding | Verdict | Where it landed |
| --- | --- | --- | --- |
| CodeAnt | `availableModels` includes hidden Claude models while the picker filters them (`chat-input-area.tsx:519`) | Real, and round 2's own making | `41688f4` |
| CodeAnt | `claudePickerProps` hides configured models but `selectedModel` comes from the unfiltered list (`new-chat-form.tsx:2137`) | The same defect on the other surface | `41688f4` |
| CodeAnt | The materialize effect leaves a stale model id stored when every Claude model is hidden (`chat-input-area.tsx:542`) | Declined — pre-existing, unreachable as described, and the guard is load-bearing | reply `r4086282209` |
| Buoy | `min-h-[32px]` → `min-h-8`, twice, re-posted on lines this PR does not touch | Declined again, with the numbers | replies `r4086282510`, `r4086282751` |
| SonarCloud | Seven duplicated lines, one in each of seven provider manifests | Real block, wrong suspect: it was the probe, not the flags | `e5b602a` |
| SonarCloud | `renderPart` cognitive complexity 70 against 15 | Fixed, harness first | `5a98fb4`, `1900d14` |
| SonarCloud | `typescript:S3358` nested ternary in `probe-command.ts:37` | Real, introduced by `e5b602a` | `cacd3db` |
| SonarCloud | `typescript:S3358` nested ternary in the plan indicator | Real, and surfaced by the split: moved lines count as new | `97f4327` |
| SonarCloud | The seven duplicated manifest lines that remain | Declined — the shape of the table is what repeats, and no constant can hold it | below |

### The picker's selection came from a list the picker did not show

Round 2 extracted one hook for the Claude half of the picker and left each surface
the two props that were genuinely its own: which model is selected, and what
selecting one does. CodeAnt found what that left behind. The hook returned
`availableModels` exactly as `useAvailableModels` has always returned it —
`CLAUDE_MODELS`, unfiltered — and `props.models` filtered by `hiddenModels`. Each
surface kept a `selectedModel` reading the unfiltered one, so the picker offered
three models while the selection, the trigger label and the id written to
per-sub-chat storage could all be a fourth, hidden one. That is the drift the hook
was extracted to end, reintroduced one level up by returning both lists.

`41688f4` filters once, inside the hook, and returns the filtered list as
`availableModels.models`, so there is one list and no surface can read the other.
Both surfaces then derive their selection from it the way every other provider in
both files already derives its own — `codexUiModels.find(...) || codexUiModels[0]`
and the rest — which replaces a `useState` plus a sync effect that could only ever
move towards a model it could find. Net −24/+31 across the hook and the two
surfaces.

### The duplicated block on the manifests was the probe, not the flags

Sonar's duplication endpoint on this PR named two block sets across the manifests.
The second, the one carrying the new lines, is a 37-line window starting at the
head of each capability object; the first is a sixteen-line `execFile` wrapper that
all ten manifests carried byte-identically, eight as `runBinary` and two as
`runLaunch`, differing only in the bound — fifteen seconds in eight, thirty in
openclaw and roo. Ten copies of one rule about what a capability probe may do: run
a CLI once, bounded, and resolve rather than reject, because the ordinary failure
is a binary that is not installed, and read `error.code` as a string errno for a
spawn failure versus a number for a non-zero exit.

`providers/probe-command.ts` holds it once (`e5b602a`, −193/+74 across eleven
files), with the bound as a named export and the two longer-bound manifests passing
it explicitly. `cacd3db` then takes the one issue the extraction itself drew —
S3358 on `error ? (typeof error.code === "number" ? error.code : null) : 0`, three
outcomes in one expression with the reason for the middle test sitting in a comment
above it — and puts the rule in `exitCodeOf(error)`, where the explanation and the
branch are the same thing.

**What stays duplicated there, and why no constant can fix it.** One line per
manifest still reports as duplicated, inside the capability-object window. Sonar's
CPD normalizes TypeScript string literals, so what matches across those files is
not a value stated twice — the values differ per provider — but the *shape* the
`ProviderCapability` type mandates: the same field names, in the same order,
because that is what makes the ten manifests one table. Extracting the shared lines
into a constant would mean either a spread whose defaults are silently wrong for
the provider that inherits them (the fail-safe argument already recorded for the
feature flags does not hold for `latencyClass` or `usageSurface`) or a partial type
that stops being a capability table. Seven lines out of 1284, 0.5% against a 3%
limit, is what is left when each decision is stated once and the shape of the table
is what repeats.

### Nothing rendered the transcript dispatcher, so the output was recorded first

`renderPart` was the last standing complexity finding: 70 against 15, a
`useCallback` inside `AssistantMessageItem` holding eighteen branch decisions,
eighteen closure reads and the JSX for each one. Round 2 declined it on the grounds
that nothing tested the file, and that a pins pull request cannot also rewrite a
legacy renderer safely. The first half of that was fixable, which changed the
answer: the instruction for this round was to work the findings, and the way to
make a 250-line dispatcher safe to restructure is to write down what it currently
produces.

`5a98fb4` adds 28 snapshot tests, one message per branch — text, whitespace-only
text, step-start, a part that is neither text nor tool, Bash success and Bash
failure, reasoning, a completed thinking tool, Edit with its patch, Write, a plan
file as a card, a second plan operation as a mini indicator, web search, web fetch,
PlanWrite, ExitPlanMode, a todo list, a question awaiting an answer, a registry
tool, the renamed TaskOutput, a sub-agent task with nested tools, an orphaned
nested group, an MCP call, an unregistered tool, the collapsed-steps path, the
streaming path, the exploring group and the usage badges. No child component
reaches for trpc, the router, Sentry or electron, so the only context a render
needs is the tooltip provider the agents layout already supplies; the question
chime is mocked because jsdom has no `Audio` and a sound is not part of the output.
The message id is reset per test because it lands in the rendered DOM, so a
snapshot cannot depend on how many tests ran before it. Baseline stability was
checked rather than assumed: 28 snapshots written, then a second run with 0 written
and 0 obsoleted.

Three devDependencies come with that, in a PR that otherwise only moves pins:
`jsdom` 30.1.1, `@testing-library/react` 16.3.3 and its `@testing-library/dom`
10.4.2 peer. Exact pins, no carets, and the lockfile was regenerated by bun 1.4.2 —
the version CI's `oven-sh/setup-bun` pins — so `bun install --frozen-lockfile`
accepts it. Five entries the diff removes reappear in it unchanged (`ansi-styles`,
`entities`, `lru-cache`, `parse5`, `yallist`): bun re-sorted sections rather than
re-resolving anything, and no existing dependency changed version. The vitest
environment stays `node` globally; this one file declares jsdom for itself, and the
include list gains `*.test.tsx`.

`1900d14` then does the split, and the branch bodies do not change. They move to
module scope as one function per shape — text, sub-agent task, Bash, thinking, plan
operation, file edit, web search, web fetch, plan write, todo list, question,
registry row, unregistered tool — each taking the part, its index and one
`PartRenderContext` carrying what only the component knows. `renderMessagePart`
dispatches in the order it always did, which is the part that carries meaning: a
sub-agent `Task` and a Write to a plan file both claim a type the dispatch table
also names, and they have to win. Two things fall out — Write and Edit rendered the
identical `AgentEditTool` in two branches, so one function serves both table
entries, and the closure's eighteen-entry deps list becomes a `useMemo` around the
context with `renderPart` depending on that single object.

The evidence that it worked is the absence of a diff: `git diff` reports no change
to the `.snap` file, and vitest wrote 0 and obsoleted 0 against the baseline
recorded one commit earlier. This is the model the round-2 record predicted — one
function per decision, an explicit context, a single dispatch — applied to a
renderer instead of a transport, and the reason the harness came first is that
"the snapshots still pass" is only evidence if they existed before the change.

SonarCloud agreed on the analysis after `1900d14`: the S3776 report on
`renderPart` is gone, new technical debt fell from 60 minutes to 10, and the same
analysis raised something worth recording — `typescript:S3358` on the plan
indicator, a ternary inside a ternary inside JSX choosing between four strings.
It had sat in `renderPart` unreported for as long as the function existed,
because Sonar analyses a pull request against its new code and those lines were
old. Moving a line makes it new. `97f4327` puts the four strings and the two
questions in `planOperationLabel(isWrite, isOpStreaming)` and leaves the JSX one
ternary, and adds the two snapshots that pin the strings no fixture covered —
"Updating plan..." and "Updated plan" — so all four are now recorded. The
snapshot diff for that commit is additions only, 0 removed lines, which is the
same evidence as the split: 30 tests, 1 written, 0 updated.

**Where the round ended.** SonarQube Cloud on head `97f4327`: quality gate passed,
**0 new issues**, **0 minutes** of new technical debt, 0 security hotspots, and
duplication on new code at **0.3%** — 7 lines out of 2302, the same seven manifest
lines argued above. Across the round the issue count went 1 → 2 → 1 → 0 and the debt
60 → 10 → 5 → 0 minutes, each step a commit: the probe extraction added the second
S3358, `cacd3db` removed it, the split removed the S3776 and surfaced the first
one on moved lines, and `97f4327` removed that. All ten substantive GitHub Actions
checks pass on the same head.

That is a general hazard of this kind of remediation and it is worth stating
plainly: extracting code in a pull request re-reports whatever the extracted lines
already carried. The choice is between leaving a 70-complexity dispatcher alone
and finding out what else lives in it. Both findings found this way were five
minutes of work and one made the renderer better.

### Declined: a stale id that nothing can read as a stale model

CodeAnt, Major, on the materialize effect: when every Claude model is hidden,
`selectedModel` is undefined, the effect returns early, and the old id stays in
per-sub-chat storage, "so the next request still sends a hidden model". Declined,
on four facts (reply `r4086282209`):

1. The effect is byte-identical at this PR's base (`33475d8`,
   `chat-input-area.tsx:569-575`), early return included. Nothing here introduced
   it.
2. Neither transport consults `hiddenModels`; both are untouched by this PR and both
   resolve `MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP.opus`
   (`ipc-chat-transport.ts:400`, `native-chat-transport.ts:81`). In the state the
   finding describes *every* Claude model is hidden, so a cleared id resolves to
   opus — also hidden. No value the effect could store makes the next request send
   a visible model.
3. The early return is load-bearing. `models` is a synchronous filter over a static
   list, so it is empty only when the user hid them all, never transiently. Leave
   storage alone and the preference survives the cycle: hide everything, unhide
   Sonnet and Opus, and `find(stored) || models[0]` lands back on the model they
   chose. Write a default on the empty path and the same cycle lands on
   `models[0]`, because the stored id no longer matches anything.
4. What `41688f4` did change is the part that was wrong: at base `selectedModel`
   was `useState` seeded from the unfiltered list, so a hidden model stayed
   selected, stayed in the trigger label and was written back on mount. It now
   derives from the visible list, the label reads `"Select model"`
   (`chat-input-area.tsx:792-794`), and nothing is written.

The finding does name a real gap, one level down: hiding a model hides it from the
picker and not from the wire. Closing that means filtering at send time in the two
transports, which changes which model runs for every existing chat, mid-session,
and is a contract of its own rather than a line in a pins PR. It is recorded here
and in the PR body as a follow-up. This token cannot open an issue (403 on both
create and comment), so it is handed off in writing rather than filed.

### Declined again: `min-h-[32px]`

Buoy re-posted the same two suggestions on `agent-model-selector.tsx:367` and `:381`
after the earlier decline, on lines this PR does not touch. The decline stands and
now carries the arithmetic (replies `r4086282510`, `r4086282751`): tailwindcss is
`^3.4.17`, `tailwind.config.js` only `extend`s — no `spacing`, `minHeight` or
`fontSize` override — and nothing sets a root `font-size` (every `font-size` rule in
`globals.css` is scoped to a component), so `min-h-8` is `2rem` is `32px` and the
swap changes no computed style. `min-h-[32px]` appears 16 times under `src/`,
`min-h-8` appears 0 times, and 5 of the 16 are in the flagged file, so taking the
token on two lines leaves 14 arbitrary sites and introduces a second spelling of
one value. Both classNames also carry `py-[5px]` and `w-[calc(100%-8px)]`, neither
of which has a token form — 5px falls between `1`/4px and `1.5`/6px — so the line
stays arbitrary-valued either way. A repo-wide move to spacing tokens is a styling
sweep of its own.

## The complexity findings this step does not take

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

**Update from round 2.** One of the two no longer stands, and nothing attacked it:
SonarCloud's issue list for this PR now returns a single issue, `typescript:S3776`
on `assistant-message-item.tsx:803`. Moving the picker wiring out of `NewChatForm`
(`e57175b`) took the ternary that fed the effort rows and the `||` chains that
resolved the custom config, the connection state and the Ollama model with it, and
the component came out under the threshold. A component that stops owning a decision
stops paying for its branches — the same argument as the transport refactor, arrived
at from the other end, and a reason to expect the `renderPart` split to be worth
doing on its own terms rather than as gate relief. `renderPart` is untouched by this
round and stands at 70 against 15.

**Update from round 3.** The other one is gone as well, and this time something
attacked it. `5a98fb4` wrote down what `renderPart` renders — 28 snapshots, one
message per branch — and `1900d14` moved the branches to module scope against one
explicit context, leaving a dispatcher of eleven increments where a single function
carried seventy. The snapshots pass byte-identically, which is what makes the split
a refactor rather than a rewrite. The table above keeps its round-2 wording because
the reasoning that deferred it was sound when it was written, and what changed it
was not a better argument but a test file: "no coverage to make the rewrite safe"
was the load-bearing half of the decline, and that half was removable.

## What was declined, and why

Buoy asked for `min-h-8` in place of `min-h-[32px]` on two rows of the effort
sub-menu. `min-h-[32px]` appears 14 times across `src/**/*.tsx` and `min-h-8`
appears zero times, so the token form has no precedent in this renderer, one of the
two flagged lines is pre-existing Codex code this PR only generalized, and adopting
the token here would make this component the single exception while leaving the
other 14 arbitrary values in place. A repo-wide move to spacing tokens is a
formatting contract of its own.

**Corrected in round 3.** The count at head `cacd3db` is 16 occurrences of
`min-h-[32px]` under `src/` and 0 of `min-h-8`, not 14 — the earlier number
counted `src/**/*.tsx` only. Buoy re-posted both suggestions after the decline and
they were declined again with the arithmetic and with the reason the swap cannot
even buy a token-only line: the same two classNames carry `py-[5px]` and
`w-[calc(100%-8px)]`, which have no token form. Round 3 records it in full.

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

### Round 3, re-run in full against head `97f4327`

| Gate | Result |
| --- | --- |
| `biome check .` | 980 files, 0 findings |
| `npm run lint` | 925 files checked, no findings |
| `ratchet:typecheck` | passed, 0 errors against a 0 baseline |
| `vitest run` | 104 files, 1921 passed, 1 skipped |
| the render harness alone | 30 snapshots, stable across runs; the 28 recorded before the split pass byte-identically after it, and `git diff` on the `.snap` file is empty for the split and additions-only for the two tests added with the label extraction |
| `bun install --frozen-lockfile` | accepted the lock regenerated with the three new devDependencies; the five entries the diff removes reappear unchanged, so no existing dependency moved |
| `npm run test:node` | 59 passed, 0 failed |
| `npm run test:contracts` | 382 passed |
| `ratchet:audit` | passed, no new critical advisories against a 3-critical baseline |
| `skills:verify` | 50 of 50 locked skills verified, 2 unrecorded project-owned |
| GitHub Actions | Build ubuntu-24.04, macos-14, windows-2022; Package unsigned ubuntu-24.04, macos-14; quality gates; security gates; both Socket reports; CodeRabbit — all pass. Buoy, Sourcery, DeepSource skip |
| SonarQube Cloud | quality gate passed, 0 new issues, 0 debt, 0 hotspots, 0.3% duplication on 2302 new lines |

## Round 4: the independent review, twenty-one threads

A fourth reviewer — `kilo-code-bot`, six multipass reviews plus targeted
confirmations — opened twenty-one inline threads against head `5ea0b64` with a
`CHANGES_REQUESTED` review: five Major, six Moderate (later ten), five Low
across three addenda, plus a mediation roadmap in the PR thread. Each claim was
checked against the pinned SDK's own `.d.ts`, the installed bundle, this
repo's code and its recorded snapshots before anything was touched; the
disposition table below is the round's result. Nothing was accepted on the
reviewer's word alone, and nothing was declined without evidence in the reply.

### Fixed — sixteen of twenty-one

| Thread | What it claimed | What settled it | Commit |
| --- | --- | --- | --- |
| MCP peer contract (Moderate) | SDK 0.3.270 declares `@modelcontextprotocol/sdk` `^1.29.0`; the graph resolves `1.25.3` | Reproduced: `npm ls` → `invalid: "^1.29.0"`, `ELSPROBLEMS`. Exact `1.30.1` pinned, newest in range | `dfe7044` |
| Transform throws on malformed lines (Major) | `apiRetryMessage` and `handlePromptSuggestion` trust fields `toClaudeStreamMessage` proved only have a string `type`; qwen `feedLine` has no catch, so the throw escapes into the main process | Both handlers read only documented shapes; `feedLine` wraps premap/result/transform in a boundary that settles the turn. Claude router already caught; qwen was the process-killer | `ead68c1` |
| Launch rendered as completion (Major) | `AgentOutput.status` is `completed \| async_launched \| remote_launched`; the row asked only "streaming?" | `sdk-tools.d.ts` confirms the union; `isLaunchedAgentOutput` branches the title and the registry phrase. Three statuses pinned in a snapshot | `6804c04` |
| Nested ancestry orphaned (Major) | Grouping resolved a child's parent by first id segment among top-level tasks only, so `B:C` never found `A:B` | The transform composes `parentOriginal:childOriginal` from the SDK's immediate `parent_tool_use_id`; lookup now goes through every task's original id, keys children by the parent's full id, self-parent skipped as the cycle guard, recursive rows capped at three levels | `6804c04` |
| Inert focusable subtitles (Moderate) | Every registry subtitle wore `role="button"` and a tab stop; TaskOutput rows have no action | Our own snapshot contained `<span role="button" tabindex="0">Task: task_1</span>`; button semantics now require a handler. Snapshot deltas verified as exactly those two attribute deletions | `b4c9ebb` |
| `shell_id` dropped (Low) | `TaskStopInput` accepts the deprecated `shell_id`; the shared reader took only `task_id`/`taskId` | `sdk-tools.d.ts:920` confirms; reader takes `shell_id` under the same `Task:` label; registry test pins it | `b4c9ebb` |
| Effort is global (Major) | One `claudeEffortAtom` for every pane while the model beside it is per-sub-chat | Mirrored the Codex thinking family: `subChatClaudeEffortAtomFamily` + `lastSelected` keeping the old storage key; `in` not `??` so an explicit null stays that chat's answer. Five tests including migration | `07bf80a` |
| Native sends no effort (Moderate) | The picker shows effort on the Native engine; the transport omits the field | Contract verified before building: the pinned runtime-client exposes `setReasoningEffort` (`set_reasoning_effort`). Router validates `z.enum(EFFORT_LEVELS)` and applies it best-effort after `set_model` | `7f7a8f9` |
| Stale suggestion survives turn/engine (Moderate ×2) | Session equality stood in for turn ownership; native never cleared; abort/error left the row | `{text, turn, engine}` entry, per-sub-chat generation bumped by both transports at send, store-time and render-time gates, guarded clears on abort/error. Seven tests on the pure rules | `34ea81b` |
| Preference not authoritative (Moderate) | Option sent only when true, so an inherited `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` decided | Env var overridden both directions from the toggle (the SDK documents env beating settings), `promptSuggestions: false` sent as explicitly as true, store refuses chunks while off | `34ea81b` |
| Click erases draft (Moderate) | `setValue(suggestion)` clears and rebuilds the editor | `mergeDraftWithSuggestion`: replace only an empty/whitespace draft, otherwise append after one space, draft byte-stable. Five tests; voice path uses the same join | `5e24490` |
| Switch has no name (Moderate) | Sibling `<span>`, no `aria-label`; 31 switches, 0 labelled | `aria-label="Prompt Suggestions"` on the new control; test queries `getByRole("switch", { name: ... })` | `7e2c988` |
| NaN claim (Low) | JS coerces `null` to 0; the transform normalizes with `?? 0` | Verified on Node 22; research record rewritten to the real contract | `2456829` |
| Benchmark counts (Low) | Row says 103 files / 1885 tests; head CI reports more | Row labelled as the pre-harness measurement it is, with CI named as the live count | `2456829` |
| Stale version strings (Low) | CLAUDE.md, openspec/project.md, permission-hook comment still name 0.2.45 / 2.1.45 / 0.137.0 | All three moved to 0.3.270 / 2.1.270 / 0.154.0; the hook's `["deny", "ask"]` claim re-read in the 0.3.270 bundle before the number moved; roadmap §16 added ratifying every lockfile addition | `2456829` |
| Probe `null` doc (Low) | `null` also follows timeout, signal, EACCES, max-buffer — not only "never ran" | Comment narrowed to "no usable exit code", naming ENOENT as the one case the helper can prove; behavior deliberately unchanged (pre-existing, deferred with the structured-result follow-up) | `2456829` |

### Declined — four threads, evidence in each reply

- **`conversation_reset` (Major).** `/clear` is a client-side builtin in this
  app — it "creates new sub-chat" (`builtin-commands.ts`) — so the CLI's reset
  event never reaches the transformer from any path the app owns. The
  router lines the thread cites are unreachable for it.
- **Per-model capability matrix (Major).** `src/shared/effort.ts` already
  records the SDK's documented clamp ("an effort above a model's
  `maxEffortLevel` is clamped to it") and files per-model
  `supportedEffortLevels` as the named follow-up; no model-info source exists
  in-repo to build the matrix from. The engine half of the same thread was
  fixed instead (native now sends effort), and the "hidden control still
  sent" premise was checked: nothing hides the effort rows for custom or
  offline — `efforts` is passed unconditionally — so there is no hidden
  control to disagree with.
- **`TaskOutput` in `READ_ONLY_TOOLS` (Moderate).** The classifier belongs to
  the sibling permissions lane; checked `arena/01a0bb80-mauscode` at push time
  — still `BashOutput` only — so the handoff stands as a handoff, and touching
  it here would collide with the lane that owns it.
- **Packaged artifact size (Moderate).** The benchmark already lists packaged
  and bundle size as *needs `bun run package:linux`* rows owned by CI and step
  30; this sandbox cannot produce the artifact, and the record says so rather
  than claiming a measurement it does not have.

Two sub-asks rode along declined with their threads: capping the raw qwen line
before `JSON.parse` (identical feedLine at base, outside the diff cause, and
JSON.parse was already guarded) and restructuring the probe's null into a
structured result (behavior inherited from the base wrappers; the comment now
says what it proves, the follow-up keeps the redesign).

### Where the round stood

Ten commits from `5ea0b64` to `2456829`, every gate re-run in full at each of
the three code commits that needed it and at the docs commit: biome 987 files
0 findings, typecheck ratchet 0 errors against a 0 baseline, lint 932 files
clean, vitest 109 files / 1951 passed / 1 skipped (29 new tests across the
round), test:node 59, test:contracts 382, audit ratchet at the 3-critical
baseline, skills:verify 50 of 50. Pushes after `5e24490` are queued locally —
the session's GitHub token expired mid-round (401 on REST and GraphQL) — and
the replies to the twenty-one threads post when the connection is restored.

## Round 5: five new threads, five fixes, and the Sonar leak period

Kilo's reconciliation at 16:01Z opened five new inline findings against
`5e24490` (the twelve already-discussed rows in that summary were answers to
the round-4 threads). Each was verified in the code before anything was
touched; all five were real; all five were fixed:

| Thread | Claim | Commit |
| --- | --- | --- |
| `qwen-print/session.ts` | Settling a malformed line left the child running; stdout kept feeding a dead turn | `c84a571` — settled turns refuse further lines; catch escalates SIGINT→SIGTERM→SIGKILL |
| `ipc-chat-transport.ts:506` | Provider `error` chunks never hit subscription `onError`, so a stored suggestion survived the failure | `e429440` — `error`/`auth-error` chunks clear under the generation guard |
| `suggestion-ownership.ts:42` | `suggestionIsCurrent` asked engine and turn but not the preference; off→on resurrected a withdrawn row | `3c3500e` — preference is the third argument the render gate passes |
| `agent-tool-utils.ts:171` | `nestedChildren` identity defeated task-row memo on every stream render | `faae395` — nesting map compared by content, not callback identity |
| `agent-tool-call.tsx:19` | Tooltip-only subtitles lost keyboard access when role/tabindex were removed | `8b0ee3d` — tab stop with no role, only when a tooltip exists |

Replies posted on each thread; summary comment `5818332768`.

### Sonar on the same heads

After the round-4/5 pushes the leak period carried **10 open issues** (gate
still passed: 0 hotspots, 0.7% duplication on new code). Nine were cleared in
`1fe7cf9` — both S3776s by extraction (`openNativeTurnSession` /
`applyNativeEffort`, `buildNestingIndex`), the S3358 by hoisting the
max-retries half, S7755/S6582/S6551/S5906×2 as one-liners, and S6819 by
making the action subtitle a native `<button type="button">` with a style
reset. **S6845 is left open deliberately**: `TooltipTrigger` hangs off
focus, a bare tab stop is not a button, and Biome carries the suppression
with that reason. Comment `5818550916` records the table.

### Where the round stood

Commits `5e24490` → `1fe7cf9` are pushed. Round-4's five queued commits were
rebuilt after a sandbox reset wiped `.git` (tree matched the staged content
exactly: `8a1d177`); round-4's 21 replies and both summary comments post
once the token was restored. The issue-#14 backlink comment remains a 403 —
this integration cannot comment on issues — so linkage stays `Closes #14`
in the PR body alone. One CI job (`Package (macos-14, unsigned)` on the
duplicate pull_request-triggered run at `8b0ee3d`) failed fetching bundled
agent binaries; the push-triggered run on the same SHA passed every job
including that package. Re-run is a 403 on this token.

## Round 6 — the S4782s the S3776 split moved

Re-analysis at `8071737` (the record you are reading) reported **5 new
issues**: four S4782s on the `openNativeTurnSession` input that `1fe7cf9` had
just extracted (`model?: string | undefined` and three siblings — `?` already
carries the option), and one S6845 which is the accepted false positive above.
The four unions were dropped in `1e415ee`; Sonar's next analysis confirmed it,
from 5 down to **1 open issue (S6845 only)** with the gate passing at 0.6%
duplication and 0 hotspots. The S6845 line moved during the split, so it read
as new; it stays open on the same argument as before.

## Round 7 — the regression round 5 introduced

Kilo thread `4096408265` against `1e415ee` claimed that `nestedMapsEqual`
walked every map part through `arePartsEqual`, which advances the
module-level `toolStateCache` — so the first task row's comparator consumed
every in-place mutation and later rows saw a clean cache and skipped
re-rendering a grandchild that had changed. **Verified real**: the full
message-level map became shared across all rows in `faae395` (round 5's own
memo fix), which turned the pre-existing single-consumer cache design into a
multi-consumer one.

Fixed in `5683525`, taking the thread's first suggestion (keep the descendant
comparison pure):

- `nestingFingerprintOf` snapshots the map once per render in
  `AssistantMessageItem` — `state`/`input`/`output` plus identity fields, the
  same fields `getToolStateSnapshot` records — into one immutable string, no
  cache interaction.
- `areTaskToolPropsEqual` compares that string by `===`. Every row reads the
  same value; neither writes anything.
- `arePartsEqual` stays for each row's own `part`/`nestedTools`, where each
  `toolCallId` has exactly one consuming row, as before `faae395`.

New `agent-tool-utils.test.ts` (9 tests): fingerprint empty/absent cases,
stable across rebuilds with equal content, changes on in-place grandchild
mutation and on a state move, and the regression itself — the same
before/after pair rejects **twice in a row**, where the old comparator's
second call returned `true` because the first had eaten the change. Testing
note: `arePartsEqual` seeds its cache on first sight and early-returns, so
the accept-expectations prime the cache with two warm-up passes.

Reply `4097288538` posted on the thread; all 27 Kilo roots are answered.
Gates at `5683525`: biome 988/0, typecheck ratchet 0 ≤ 0, lint 933 clean,
vitest 110 files 1962 passed 1 skipped, test:node 59, contracts 382,
audit ratchet, skills 50/50. `tsgo` ran `--singleThreaded` after the
sandbox's 3.7 GiB cgroup OOM-killed the default parallel mode twice; it
passed in default mode earlier on this tree, and the single-threaded run
was sanity-checked against a deliberate type error. CI on `5683525`: both
runs success, 18 checks passed, 2 skipped (DeepSource, Sourcery), 0 failed.
The issue-#14 comment retried a fourth time — still 403.

### Round 7 follow-up — Sonar's read of the fix itself

The analysis of `5683525` kept the gate passing but raised two new issues on
the fingerprint code: S5906 on the test's redundant `expect(a === b).toBe(true)`
beside the `.toBe` that already pinned it, and S6551 on the segment `.join()`
whose `state` member is `unknown` — join's default stringification could fold
two different state objects into one `"[object Object]"` and hide precisely the
change the fingerprint exists to catch. `172fbb2` drops the redundant
assertion and JSON.stringify's the tuple as a whole instead; the re-analysis
confirms it: **1 open issue again (S6845 only), gate passed**, 0 hotspots,
0.6% duplication. Comment `5820990401`.

## Round 8 — the outer memo's blind spot

Kilo thread `4097307159` (posted a minute after the round-7 reply) claimed
the nesting fingerprint could never fire: `areMessagePropsEqual` snapshots
text lengths, every part's state, and only the LAST part's input, so a
non-last nested tool mutating `input` or `output` in place with an unchanged
state let the outer memo skip the render — and every row memo behind it,
fingerprint included, never ran. **Verified real, and pre-existing**: the
outer comparator and its last-part-only tracking both predate this PR, and
before round 7 the same gate hid the change from `nestedChildren` identity
and `nestedMapsEqual` alike. Real and in scope because the feature this PR
ships is exactly the rows it hides.

`6e90855` takes the thread's first suggestion: the snapshot carries
`partIOJsons` — every part's input and output, stringified — replacing
`lastPartInputJson` outright (the last part is covered the same way, one
array is not two rules). Parts with neither field short-circuit to
`undefined` without a stringify, so the cost lands only on tool parts, which
the row comparators already stringify on the renders this unlocks. Nothing
downstream needed changing: `messageParts` is rebuilt every render by
deliberate design, so once the outer memo passes, the nesting map and its
fingerprint recompute with it.

The component-level test does what the thread asked: an expanded Task, a
nested Read whose subtitle prints its `file_path`, a trailing tool holding
the last-part slot, an in-place `input` mutation with `state` untouched —
asserted to flip the row from `one.ts` to `two.ts`. Proven red with the fix
stashed and green with it. Reply `4098391046`; all 28 Kilo roots answered.

The push-triggered CI run on `6e90855` passed every job; the
pull_request-triggered run failed its vitest step after 30s. Its merge ref
(`refs/pull/69/merge`) is byte-identical to the head the push run passed
(`git diff HEAD origin/pr-69-merge` is empty), log storage is unreachable
from this sandbox, and `gh run rerun` refuses — so the failure reads as
environmental and the re-triggered run is the arbiter.

## Round 9 — S6845 fixed, and the round-8 fix's own price

Sonar's leak period closed on one issue: **S6845**, the bare `tabIndex="0"`
on the tool-call header subtitle (`agent-tool-call.tsx:35`) — every subtitle
was a tab stop, plain-text ones included, with nothing for a keyboard user to
reach. The fix reverses the round-4 ruling that kept bare spans: that call
assumed a click handler existed to protect, and it rests on native buttons
never overriding appearance — Radix's `TooltipTrigger` default is a button,
which the snapshot change records. `920a934` renders a span only when the
subtitle has neither an `onClick` nor a tooltip, otherwise a native
`<button type="button">` (same tab stops, no `tabIndex` anywhere, no role
overrides) with `cursor-default` when it only opens a tooltip. One snapshot
line changed, span to button; 38 targeted cases green.

Three new perf reviews then attacked what round 8 introduced: kilo
`4098403950` and CodeAnt `4098800130` on the outer memo serializing every
part's `input`+`output` on every comparison — quadratic in transcript size,
transient strings per stream tick — and CodeAnt `4098801144` on
`nestingFingerprintOf` doing the same per render. **Verified real**; round 8
chose correctness over cost without bounding either.

`646b8e8` bounds both with one settled-part rule. A part whose state string
is terminal (`output-available`/`output-error`/`result`/`error` — the new
shared `isTerminalStateString`, the state string alone, so an output that
arrived before its state caught up stays live) and whose input/output
references are unchanged reuses its cached string in O(1): the SDK does not
reopen a completed part. Only live parts serialize per comparison, bounded
by the active tool's payload instead of the transcript's. The fingerprint's
reuse lives in a private segment cache keyed by `toolCallId`, cleared in
`clearToolStateCachesByToolCallIds`, written once per render so row
comparators keep round 7's single-consumer property. Tests pin both halves:
a streaming grandchild deep-mutating through one input object still changes
the fingerprint, and a settled terminal part holds its segment until a
reference moves. Replies `4098985226`, `4098985453`, `4098985725`.

The fifth sandbox reset struck between gates — HEAD back at base, and this
time `node_modules`, `bun`, and the runtime-client `dist` gone with it.
Recovered via stash checkout of the three S6845 files, reinstalled bun
through npm, `bun install --frozen-lockfile --ignore-scripts` (1228
packages), rebuilt the dist. Battery re-run over both changes at once:
biome 0 findings, lint-changed clean, tsc 0 errors, tsgo `--singleThreaded`
0, vitest 1964 passed / 1 skipped (110 files), test:node 59 pass,
contracts 382 passed, audit ratchet clean, skills 50 of 50, typecheck
ratchet 0 <= 0 — both commits pushed, queue regenerated to 55 patches.
Issue #14 `Linked PR: #69` retried an eighth time, same 403: the App
installation token lacks Issues write on this repository.
