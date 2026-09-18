# Permission floor (roadmap step 10)

Date: 2026-09-13, implemented 2026-09-18. Provenance: roadmap
`.dump/app/roadmap/10-permission-floor.md`, `FULL-REVIEW.md` §6.3, and four
design questions put to the user and answered on 2026-09-18 (all four accepted
the recommendation).

## The problem being fixed

Every non-plan Claude run was sent to the SDK with its permission bypass
posture and the skip-permissions flag. That is not a floor: it is the absence of
one. The router then re-implemented a partial floor by hand, with a plan-mode tool
blocklist, an ask-mode approval list, and a dangerous-deletion regex, so the
effective policy lived in three places, only one provider had any of it, and the
dangerous-deletion table was unreachable from the other nine backends.

## Decision 1: the rule classes

Five, and no sixth. A tool call lands in exactly one.

| Class | What it covers | Shipped verdict |
| --- | --- | --- |
| `read-only` | Read, Glob, Grep, LS, NotebookRead, TodoWrite, BashOutput, AskUserQuestion, Skill, SlashCommand | allow |
| `approval` | Edit/Write/MultiEdit/NotebookEdit, and any Bash command no dangerous pattern matched, and any tool nobody classified | ask |
| `destructive` | the seven patterns below | deny |
| `network` | WebFetch, WebSearch, and egress commands | deny |
| `exfiltration` | a secret path reaching a reader or an egress channel | deny |

Destructive patterns, each with its own test and a near-miss test beside it:
`recursive-force-delete`, `destructive-sql`, `forced-git-push`,
`discarding-git-command`, `protected-path-overwrite`, `disk-or-power`,
`init-kill`. These are the patterns `detectDangerousDeletion` carried inside the
Claude router, moved to `src/shared/permissions/classifier.ts` so the rule
exists once.

Network is a verb list (`curl`, `wget`, `nc`, `ncat`, `netcat`, `telnet`,
`ssh`, `scp`, `sftp`, `ftp`, `lftp`), the remote git subcommands (`push`,
`fetch`, `clone`, `pull`, `remote`, `ls-remote`), the publish subcommands
(`npm|yarn|pnpm|cargo publish`, `twine upload`), and remote-target `rsync`.

**Residual Bash is `approval`, not `deny`.** This is the decision that keeps the
app usable: `npm test`, `git status` and package installs have to keep working
without a policy file. They are not read-only, so they ask in ask mode and allow
in the acting modes, exactly as the shipped floor sets it.

## Decision 2: precedence

Fixed order, highest first. Implemented in
`src/main/lib/permissions/evaluator.ts` and tested there.

0. **Unknown mode → deny `mode.unknown`.** A mode this app has no floor for
   fails rather than falling back to a wider posture. This is PA-8 in
   `provisional-assumptions.md`.
1. **Path safety → deny `path.<CODE>`.** The containment and symlink checks run
   before any policy, because a path that escapes the worktree is out of scope
   whatever its class. **Turbo is exempt from this step** unless the class is
   `exfiltration`, so turbo can read `/etc/hosts` but still cannot reach
   `~/.ssh/id_ed25519`. See decision 4.
2. **Plan-mode floor.** `ExitPlanMode` → deny `plan.exit-plan-mode`; read-only →
   fall through; approval + shell command → deny `plan.no-shell`; approval +
   markdown → allow `plan.markdown-edit`; approval + anything else → deny
   `plan.markdown-only`; every other class → deny `plan.read-only`.
3. **The critical-path breaker → ask `critical-path.<id>`.** Runs above the
   allow-list, so a user entry cannot pre-approve deleting the filesystem root.
   It downgrades `allow` to `ask` and never widens anything else. See decision 9.
4. **The mode's allow-list → allow `allow-list.<index>`.** Checked after the
   plan floor, never for `exfiltration`, and never when step 3 found a breach, so
   no entry a user writes can carry a secret out or reformat a disk.
5. **The policy verdict → `<class>.mode.<mode>` or `<class>.policy`.** A
   per-mode verdict beats the class verdict, because the mode is what the user
   picked for this run.
6. **A throw anywhere → deny `evaluator.error`.** The gate never throws at its
   caller, because a caller left to invent a fallback is how the bypass got
   there in the first place.

Note what step 2 costs: in plan mode a destructive or exfiltrating action is
denied with rule `plan.read-only`, not with its own class rule. The floor sits
above the class verdict on purpose, because plan mode narrows only, and the reason
text still names the class, so the user is not left guessing.

## Decision 3: the SDK posture is `default`, not `acceptEdits`

The roadmap's §6.4 table says `agent → acceptEdits`. **That is overridden.**
Anthropic documents that a tool call auto-approved by a permission mode never
reaches `canUseTool`, and that `acceptEdits` auto-approves Edit and Write plus
the shell commands `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed`
(<https://docs.claude.com/en/docs/claude-code/sdk/sdk-permissions>, read
2026-09-18; confirmed against the pinned SDK types for 0.2.45). Under
`acceptEdits` those calls would never reach the gate, so the floor would not
cover the file writes it exists to cover.

`default` is the posture Anthropic describes as requiring a `canUseTool`
callback to handle approval, and it still auto-allows reads inside the working
directory, which the `read-only` class allows anyway. So ask, edit, agent and
turbo all run under `default` and the policy decides; plan keeps `plan`.

The user was asked and accepted this override.

## Decision 4: turbo is the opt-out tier (revised 2026-09-18)

Superseded. The first cut of this step gave turbo an empty allow-list and denied
destructive commands and network egress, on the argument that a headless provider
cannot prompt so anything unlisted should fail closed. The owner rejected that on
2026-09-18. Turbo is the mode a user selects precisely because they do not want
to be asked, and shipping it with the same refusals as edit mode left the tier
with no reason to exist.

The shipped floor is now `read-only`, `approval`, `destructive` and `network` all
`allow`, with `exfiltration` at `deny`. Two things survive the opt-out.

1. **Exfiltration still denies.** Reading a secret path and posting a secret
   somewhere are the actions that cannot be undone by re-running anything, and
   they are the ones a prompt would not have caught anyway because nobody reads
   them in turbo.
2. **The critical-path breaker still asks.** See decision 9.

Turbo also stops refusing paths outside the worktree, so `Read("/etc/hosts")`
resolves on its class instead of tripping containment. Containment is unchanged
in plan, ask, edit and agent. `evaluator.test.ts` asserts the exemption and the
four modes that keep it, one case each.

**This is the one place the step's acceptance criteria are not met as written.**
Criterion 3 asks that an unset policy file yields deny-by-default rather than the
old bypass. It holds for four modes and for the two classes above. It no longer
holds for destructive commands or network egress in turbo, where an unset policy
file now allows them. That is a deliberate product decision by the owner, not a
wiring gap, and it is recorded in the benchmark next to the numbers that show it.

The tooltip copy in `src/renderer/features/agents/lib/mode-display.ts` says what
turbo actually does now, including that destructive commands and network egress
both run.

## Decision 5: the tool-rule grammar has four spellings (revised 2026-09-18)

Superseded. The first cut refused `Tool(prefix:*)`, treating its colon as
ambiguous about whether the separator belongs to the prefix. The owner asked for
it to be supported, and the research backs that up. `:*` is Claude Code's own
spelling for a prefix rule, so refusing it means a user who copies a working
`settings.json` rule into `permissions.toml` gets a schema error for a rule that
does exactly what they expect.

`parseToolRule` now accepts all four.

| Spelling | Match | Example |
| --- | --- | --- |
| `Tool` | any call to the tool | `WebFetch` |
| `Tool(prefix *)` | startsWith, separator included | `Bash(git *)` matches `git status`, not `gitpush` |
| `Tool(prefix:*)` | startsWith, separator not implied | `Bash(npm run test:*)` matches `npm run test --watch` and `npm run test:unit`, not `npm run tests` |
| `Tool(exact)` | equality | `Bash(git status)` |

The `:*` form keeps a `separator` field on the parsed rule, and
`toolRuleMatches` requires the next character after the prefix to be that
separator or the end of the string. So `Bash(npm run test:*)` will not match
`npm run testable`. `Bash(:*)` is still refused, because an empty prefix would
match every call and there is already an unambiguous spelling for that, `Bash(*)`.

The schema error message now lists all four accepted spellings so a rejected
entry says what to write instead.

## Decision 6: fail closed on the policy file

- Absent file → the shipped floor, `source: "default"`. Never created by a read.
- Unparseable or schema-invalid file → the shipped floor,
  `source: "invalid-file"`, with the failure named on the denial, including the
  line number when the parser has one.
- A loader that throws for a reason the reader did not anticipate →
  `UNREADABLE_POLICY`, which denies every class including `read-only`. An
  unexpected failure in the thing that decides what is allowed must not leave
  the permissive defaults in charge.

The schema is `.strict()` at every level, so a typo narrows rather than being
silently ignored. `[modes.plan]` is a schema error: the evaluator owns the plan
floor, and a file that claims it would be believed by the user and dropped by
the code.

`~/.claude/settings.json` is never written by this path. mausCode policy lives
in `~/.mauscode/permissions.toml`. The pre-existing code that symlinks the
user's Claude settings into an isolated config dir still only reads it, and
`policy-file.test.ts` proves the bytes are unchanged after every read path.

## Decision 7: TOML, hand-rolled, read-only

No TOML parser is installed and `AGENTS.md` forbids adding a dependency outside
the dependency step, so `src/shared/permissions/toml.ts` parses exactly the
subset the policy file uses and rejects everything else. Rejecting is the safe
direction. The vocabulary is class verdicts plus an allow-list, not raw Claude
rule strings, so the file reads the same for every backend.

The serializer was written and then deleted: nothing writes the file yet, and an
unused export is a writer nobody tested. The settings surface that adds it will
have to stay inside this subset.

## Decision 8: agent mode splits network in two (added 2026-09-18)

Agent mode used to deny network outright. The owner asked for web access to work
in agent mode without a card, while outbound shell commands still reach a human.
Those are two different actions, so the floor now treats them differently.

`WebFetch` and `WebSearch` are on the agent mode's shipped `allow_tools`, which
means they pass at precedence step 4 and the rule id says `allow-list.0` or
`allow-list.1`. A shell command that reaches the network, such as `curl` or
`wget`, classifies as `network` and asks under `network.mode.agent`. The user
policy cannot re-deny the allow-listed tools, which is the documented property of
that step: the allow-list widens within the mode and a class verdict cannot take
that back.

An allow-list entry never matches an `exfiltration` call, so `curl -T .env` in
agent mode still denies even though `WebFetch` is allowed.

## Decision 9: the critical-path breaker asks (added 2026-09-18)

The owner chose `ask` over `deny` when asked which way a circuit breaker should
fall. The breaker is the one thing that can still stop a turbo run, so it had to
be either, and `ask` keeps a human in the loop without making the mode refuse to
clean its own build directory.

`criticalPathBreach(command, worktreeRoot?)` in
`src/shared/permissions/classifier.ts` reports a breach when a destructive verb
targets something that should not be deleted unattended.

- The filesystem root, the home directory, the current working directory, the
  parent directory, and the worktree root itself.
- Disk and power verbs, which destroy data whether or not they name a path.

The evaluator runs it at precedence step 3, above the user's allow-list and above
the class verdict. A breach nulls the allow-list hit and downgrades `allow` to
`ask` with a rule id of `critical-path.critical-delete` or
`critical-path.disk-or-power`. It only ever narrows. A breach cannot turn a deny
into an ask, because an ask is wider than a deny.

Two invariants are tested rather than assumed. `sudo` is stripped before the scan,
so `sudo rm -rf /` breaches too. The reason names the target in plain English and
never echoes the command text, because the reason is rendered in the transcript.

This mirrors upstream behaviour. Claude Code keeps a circuit breaker in its own
most permissive mode, where deleting the filesystem root or the home directory
still prompts even though every allow rule is ignored.

## Decision 10: what the engine-only providers get (added 2026-09-18)

The capability manifest already records `permissionFloor` as `engine-only` for the
nine providers without an app gate. Turbo now needs an explicit rule list there
too, because a broad app-side allow does not travel through a provider that only
understands its own flags.

Grok is the case that matters, since it has a rule grammar. `GROK_TURBO_ALLOW` in
`src/main/lib/grok-print/args.ts` is `Bash(*)`, `WebFetch` and `WebSearch`, and
`allowRulesFor()` unions it with the policy file's `allow_tools` for turbo only.
Edit and agent pass the policy's list through unchanged. **No mode emits the
provider's always-approve token**, and `no-bypass.test.ts` plus
`grok-print/args.test.ts` assert that. Deny rules still hold under Grok's
always-approve, but mausCode does not rely on that, because it never asks for it.

The gap is recorded rather than papered over. **Engine-only providers cannot
enforce the exfiltration class or the critical-path breaker.** Grok in turbo can
carry a secret out, and the app cannot stop it, because no app-side code sees the
call. The manifest says `engine-only` for exactly this reason, and the settings
tab shows that label next to the provider so a user can see which floor they are
getting. Closing it needs a provider-side hook or a proxy, which is a follow-up
and not part of this step.

## What is app-enforced and what is engine-enforced

The capability manifest gained `security.permissionFloor`:

- `app-gate` is Claude. Every side-effecting call reaches `canUseTool` and goes
  through the evaluator.
- `engine-only` is the other nine. The floor is whatever the engine's own flags
  give, mapped from the same policy: grok gets `--permission-mode plan` for
  plan, a read-only `--tools` list for ask, and `acceptEdits` plus one `--allow`
  rule per allow-list entry for edit/agent/turbo.

Settings now shows the value, so a user can see which backends the floor really
covers. Grok headless turbo cannot prompt, so an unlisted destructive action
fails closed there rather than asking.

## Named follow-ups

- Cursor `--force`/`--yolo` and qwen `auto`/`yolo` are unchanged. Roadmap §8
  makes any change to an engine's own enforcement an ask-first boundary, so they
  need their own decision, not a drive-by edit.
- No main-process writer for the policy file yet; it is hand-edited.
- Seven duplicated `toErrorMessage` helpers in the renderer login-flow hooks are
  unrelated debt found while reading these files.

## Rollback

Roadmap §13 is explicit that a flag is not acceptable here, and that the record
has to say what a revert costs.

Rollback is a revert of the router mapping, which sets `permissionMode:
sdkPermissionMode(input.mode)` back to the plan/bypass ternary, and the
`canUseTool` body back to the three inline branches. **That revert restores a
bypass path**: four of the five modes would again run the SDK with permissions
bypassed and the skip-permissions flag set, which is the defect this step exists
to close. It also re-opens the hole for every step that blocks on this one
({{S16}}, {{S19}}, {{S20}}, {{S21}}, {{S22}}, {{S27}}), because each of their
unattended behaviours is defined by this floor.

So a rollback is a **human decision, not an agent one**. An agent asked to
"revert step 10" should refuse and escalate, because the thing being reverted to
is a known critical security defect. Reverting the *policy* is different and is
safe: deleting `~/.mauscode/permissions.toml` returns to the shipped floor, and
the floor denies destructive, network and exfiltration in every mode.

Partial rollback that is safe and does not need a human:

- Removing a `allow_tools` entry narrows turbo. Safe.
- Setting a class verdict back to `deny` in the policy file. Safe.
- Reverting the renderer copy or the capability-manifest field. Safe, cosmetic.

## Two findings about the step's own text

**§11's manual check does not match the floor it asked for.** It says: "run an
agent turn that tries `git push --force` in a scratch worktree, and confirm the
approval card appears." Under the shipped floor, `git push --force` classifies as
`destructive` (`forced-git-push`), and Agent mode denies destructive, so no card
appears, and none should. The card appears in **Ask** mode, which is the one
shipped widening (`[modes.ask] destructive = "ask"`). The prototype shows both:
Agent mode denying that exact command with rule `destructive.policy
(forced-git-push)`, and Ask mode producing the card. The step's wording predates
the class table and should read "confirm the denial names the rule" for Agent
mode.

**§6.4's `acceptEdits` mapping is overridden.** See decision 3. This is the one
place the implementation deliberately departs from the step's plan text, with the
user asked and the reason recorded.

## Cost

Measured in `.dump/app/benchmarks/2026-09-18-permission-gate-cost.md`: 9.5 to 21 µs
median per tool call, dominated by the filesystem path check, with the policy
read cached at sub-microsecond.
