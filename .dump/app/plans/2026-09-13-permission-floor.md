# Permission floor: implementation plan (roadmap step 10)

Date: 2026-09-13, implemented 2026-09-18. Source files cite this path for the
design and the precedence table; the ratified choices and their reasons are in
`.dump/app/decisions/2026-09-13-permission-floor.md`.

## Layout

Pure and shared, so main can enforce and the renderer can render the same rule:

```
src/shared/agent-mode.ts            the five-mode union, owned once
src/shared/permissions/policy.ts    classes, verdicts, the floor, rule grammar, resolution
src/shared/permissions/classifier.ts  tool call -> rule class
src/shared/permissions/toml.ts      constrained TOML reader, read-only
src/shared/permissions/decision.ts  the decision shape and the words it shows
src/main/lib/permissions/policy-file.ts  where the file lives, how it is read
src/main/lib/permissions/evaluator.ts    the gate: one entry, one decision
src/main/lib/permissions/index.ts        the wiring: real reader, real path check
src/main/lib/claude/permission-mode.ts   mode -> SDK posture, never a bypass
src/main/lib/claude/tool-approval.ts     the in-chat approval round-trip
src/main/lib/git/security/errors.ts      the error type, dependency-free
src/main/lib/git/security/containment.ts the containment checks, dependency-free
```

`src/shared` imports no node builtin, which is why the file reader lives under
`src/main/lib/permissions/`.

## The security split

`path-validation.ts` reached the database and `secure-fs.ts` reached `electron`,
so neither was importable from a test under CI's `--ignore-scripts` install,
which does not build the native `better-sqlite3` binding. Both were split:

- `errors.ts` — `PathValidationError` and its codes. No dependencies.
- `containment.ts` — `isPathWithinWorktree`, `assertParentInWorktree`,
  `assertRealpathInWorktree`, `validateRelativePath`, `resolvePathInWorktree`,
  `assertValidGitPath`, and the new `assertToolPathInWorktree`. Node builtins and
  `./errors` only.
- `path-validation.ts` — keeps the database-registered worktree checks and
  re-exports both leaves, so existing callers are untouched.

Tests import the leaves directly, never the barrel: the barrel still reaches the
database. `permissions/index.ts` imports `../git/security/containment` as a leaf
for the same reason.

`assertToolPathInWorktree` is the absolute-path sibling of
`resolvePathInWorktree`. Provider tools hand over absolute paths, unlike the tRPC
file endpoints. It runs the `FULL-REVIEW.md` §6.3 order: shape, then literal
containment, then canonicalised containment through symlinks. It deliberately
does **not** require database registration — that boundary belongs to the tRPC
file endpoints, where a renderer names the workspace; here the run's own cwd is
already the workspace the app chose, and re-checking it would deny every tool
call in a scratch session.

## Precedence table

| Step | Check | Outcome |
| --- | --- | --- |
| 0 | mode not in the union | deny `mode.unknown` |
| 1 | any path in the input fails containment | deny `path.<CODE>` |
| 2a | plan + `ExitPlanMode` | deny `plan.exit-plan-mode` |
| 2b | plan + read-only class | fall through to step 4 |
| 2c | plan + approval + shell command | deny `plan.no-shell` |
| 2d | plan + approval + markdown path | allow `plan.markdown-edit` |
| 2e | plan + approval + other | deny `plan.markdown-only` |
| 2f | plan + any other class | deny `plan.read-only` |
| 3 | class is not exfiltration and an allow-list entry matches | allow `allow-list.<index>` |
| 4 | per-mode verdict, else class verdict | `<class>.mode.<mode>` or `<class>.policy` |
| 5 | anything threw | deny `evaluator.error` |

A loader that throws gets `UNREADABLE_POLICY`, which denies every class
including `read-only`, and reports `source: "invalid-file"`.

## Classification order

Exfiltration → destructive → network → the tool's own class. The order is
load-bearing and each inversion is a test:

- a secret path beats everything, because once a model reads it the contents
  leave the machine by design and no later gate can catch that;
- destructive beats network, so `git push --force` reports as the history
  rewrite it is rather than as the network call it also is;
- an unknown tool takes `approval`, never `read-only`, because nobody has read
  its side effects.

Command splitting is not a shell parser and does not claim to be one. It exists
so a verb check matches `curl` in `cd build && curl x` and does not match
`ssh-keygen`, which is not an egress verb.

## Rule grammar

`Tool` | `Tool(prefix *)` | `Tool(exact)`. `Tool(prefix:*)` is refused and
returns null, which is a schema error, which fails the whole file closed. A
prefix keeps its separator, so `Bash(git *)` matches `git status` and not
`gitpush`.

## Provider wiring

Claude: `permissionMode: sdkPermissionMode(input.mode)` and `canUseTool` calls
`evaluateAction`. Deny returns `describePermissionDecision`, ask opens a card
through `askToolApproval`, allow returns `updatedInput`. The router's three
inline rule tables, its dangerous-deletion regex and its two near-identical
approval blocks were deleted; the approval round-trip now has one home.

Grok: engine-enforced, mapped from the same policy — plan gets
`--permission-mode plan`, ask gets a read-only `--tools` list, edit/agent/turbo
get `acceptEdits` plus one `--allow` rule per allow-list entry. Headless turbo
cannot prompt, so an unlisted destructive action fails closed.

The other eight: `permissionFloor: "engine-only"` in the capability manifest,
shown in Settings. Changing an engine's own enforcement is an ask-first boundary
under roadmap §8, so cursor `--force`/`--yolo` and qwen `auto`/`yolo` are
deliberately untouched.

## Tests

Ten files: `classifier`, `policy`, `toml`, `decision` in shared; `evaluator`,
`policy-file`, `no-bypass` in main permissions; `permission-mode`,
`tool-approval` in main claude; `containment` in git security.

`no-bypass.test.ts` walks `src` and fails unless every hit is inside a
`.test.ts` and there is nothing at all in a router. It has a third case that
asserts the walk still finds the tokens somewhere, so the test cannot pass by
going silently empty.

## Corrections made while implementing

- The roadmap's `agent → acceptEdits` was overridden to `default`; see decision 3.
- Plan mode is not policy-configurable. `[modes.plan]` is a schema error.
- `git clean -f` is destructive, not merely discarding-adjacent; it needed the
  `\s-[a-z]*f` shape to catch `-fd`.
- The TOML serializer was written and then deleted as an unused export.
- `.ssh/id_ed25519` reports as `secret-read.ssh-directory`, not `private-key`,
  because `.ssh/` is listed first. Both are tested.
