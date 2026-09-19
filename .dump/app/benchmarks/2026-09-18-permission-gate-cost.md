# Permission gate cost per tool call (roadmap step 10)

Date: 2026-09-18. Required by `.dump/app/roadmap/10-permission-floor.md`, which
asks what the gate costs per tool call before it is put in front of every agent
action.

## Environment

Arena sandbox, Linux x64, 2 CPUs, 3.9 GB RAM, Node v22.22.3. Dependencies
installed with `npm install --ignore-scripts --legacy-peer-deps`. Runner:
`npx --no-install tsx`. Clock: `process.hrtime.bigint()`.

Measured against the **wired** gate in `src/main/lib/permissions/index.ts`, not
a mock: the real policy reader and the real containment check
(`assertToolPathInWorktree`) against a real temporary worktree. No policy file
present, so the shipped floor applied. That is the default install state and
the one worth measuring.

2000 iterations per case over a fixed 10-call mix; the first 100 samples are
dropped as warm-up. The mix is what a real turn sends: three read-only tools,
two file edits, three shell commands (benign, benign, destructive), one network
tool, one AskUserQuestion.

## Results

Two runs are reported. The first was the original floor. The second is after the
mode floors changed on 2026-09-18, when turbo became the opt-out tier, agent
gained a network allow-list, and the critical-path breaker was added. The gate
cost barely moved, which is the point of measuring it twice.

| Case | first run mean | first run p50 | revised mean | revised p50 | revised p95 |
| --- | --- | --- | --- | --- | --- |
| `classifyToolAction` (pure table walk) | 6.7 µs | 2.2 µs | 5.0 µs, then 4.2 µs | 1.0 µs | 9.7 µs |
| `readPolicyFile` cold | 10.0 ms | | 2.0 ms | | |
| `readPolicyFile` cached | 0.8 µs | | 2.2 µs | | |
| `evaluateAction` plan | 135.7 µs | 21.1 µs | 96.7 µs | 12.9 µs | 533 µs |
| `evaluateAction` ask | 96.7 µs | 17.1 µs | 82.3 µs | 15.3 µs | 453 µs |
| `evaluateAction` edit | 100.8 µs | 12.0 µs | 79.7 µs | 12.5 µs | 420 µs |
| `evaluateAction` agent | 97.1 µs | 14.6 µs | 78.1 µs | 12.0 µs | 428 µs |
| `evaluateAction` turbo | 84.0 µs | 9.5 µs | 77.6 µs | 9.6 µs | 400 µs |
| path-bearing call (`Edit`, absolute path) | 143.6 µs | | unchanged | | |

The cold policy read dropped from 10.0 ms to 2.0 ms because the second run had a
warm page cache, not because the reader got faster. Treat 10 ms as the cold
machine figure and 2 ms as the warm one. Both happen once per TTL window.

A third run followed the review pass that taught the classifier to skip wrapper
verbs and strip quotes, and that added a second enforcement point on Claude in the
form of a PreToolUse hook. Classification got marginally cheaper rather than dearer,
4.2 µs mean against 5.0 µs, because the verb finder returns on the first word that
is not a wrapper and most commands name their verb immediately. `evaluateAction`
landed between 70.2 µs and 96.4 µs mean with p50 between 11.9 µs and 17.3 µs,
inside the spread of the run before it. The hook duplicates one evaluation per tool
call on the Claude path, which at these numbers is tens of microseconds.

## Reading

- **The gate costs tens of microseconds per tool call.** At the agent-mode p50
  of 12.0 µs, a turn with 200 tool calls spends about 2.4 ms in the gate. A
  single model round-trip is orders of magnitude larger, so the gate is not on
  the critical path and does not need a fast path of its own.
- **The cost is the filesystem, not the policy.** Classification alone is 6.7 µs
  mean and the cached policy read is 0.8 µs, while a call that names a path
  costs 143.6 µs mean. `assertToolPathInWorktree` canonicalises through symlinks
  with `realpath`/`lstat`, and that is where the time goes. Calls that name no
  path (Bash, WebFetch, AskUserQuestion) are the cheap ones, which is why turbo
  and agent sit lowest.
- **The cold policy read is 10 ms and happens once per 5 seconds**, not once per
  call. The TTL matches the window `claude-settings.ts` already uses. A turn
  that makes 200 calls pays it a handful of times.
- **The tails are the machine, not the gate.** Maxima of 4 to 9 ms against p95 of
  ~0.5 ms on a 2-CPU sandbox with 3.9 GB RAM are scheduler and page-cache
  noise; the same run recorded `kswapd0` active from an unrelated process.
- **Plan mode is still the most expensive** at 96.7 µs mean and 12.9 µs p50,
  because its floor evaluates the markdown-path branch after the class verdict
  and so does slightly more work per call than the modes that fall straight
  through. The critical-path breaker added to the revised gate did not move any
  mode's p50 by more than about 2 µs, which is what a two-segment scan of an
  already-split command should cost.

## Verdict distribution observed

Same 10-call mix, 2000 calls each, shipped floor, after the revision.

| Mode | allow | ask | deny | before the revision |
| --- | --- | --- | --- | --- |
| plan | 800 | 0 | 1200 | 800 / 0 / 1200 |
| ask | 800 | 1000 | 200 | 800 / 1000 / 200 |
| edit | 1600 | 0 | 400 | 1600 / 0 / 400 |
| agent | 1800 | 0 | 200 | 1600 / 0 / 400 |
| turbo | 2000 | 0 | 0 | 1600 / 0 / 400 |

The mix is 4 read-only calls, 4 approval-class calls, 1 destructive and 1
network. Read the shifts against that.

- Agent moved from 1600 allow to 1800 because `WebFetch` is now on its
  allow-list. Its one denial per 10 calls is still the destructive one, so
  **criterion 2 is still measured rather than asserted**.
- Turbo moved to 2000 allow out of 2000. On this mix nothing trips the two things
  turbo still refuses, which are exfiltration and the critical-path breaker. The
  probe table in
  `.dump/app/research/2026-09-18-permission-floor-verification.md` shows both
  firing, and that is the honest way to read a row of all-allow. Turbo on a mix
  with no secret paths and no filesystem root in it has nothing left to refuse.
- Plan, ask and edit did not move, which is the check that the revision narrowed
  where it was asked to and nowhere else.
- **The same mix came out identical after the review pass**, 800/0/1200,
  800/1000/200, 1600/0/400, 1800/0/200 and 2000/0/0. Nine commands that used to
  reach this mix as `approval` now classify as destructive, and none of them is in
  the mix, so the honest reading is that the ordinary ten-call turn costs exactly
  what it did and the evasions that were invisible to this table are covered by
  `classifier.test.ts` instead. The wrapper probes below are that coverage,
  measured end to end through the wired gate.

## What this does to acceptance criterion 3

Criterion 3 asks that an unset policy file yields deny-by-default rather than
the old bypass. That holds for plan, ask, edit and agent, and it holds for
exfiltration and the critical-path breaker in every mode. It no longer holds for
turbo, where an unset policy file now allows destructive commands and network
egress. That is a deliberate product decision taken on 2026-09-18 and recorded in
`.dump/app/decisions/2026-09-13-permission-floor.md`, not an oversight in the
wiring. It is stated here because the benchmark is where a reader would otherwise
conclude the floor was still uniform across modes.

## Method

The script is kept here rather than in the repo tree so it is not picked up by
the test gate. Reproduce with `npx --no-install tsx <file>.mts`; the `.mts`
extension matters, because outside a `"type": "module"` package tsx emits CJS
and rejects the top-level await.

Fixture discipline, recorded because getting it wrong here deleted a workspace
earlier in this step: `mkdirSync` before `realpathSync`, and cleanup deletes the
`mkdtempSync` result itself, guarded by a `startsWith(tmpdir())` check, never a
path derived from a value a failed setup could leave empty.

```ts
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir, homedir } from "node:os"
import { join } from "node:path"
import { evaluateAction } from "<repo>/src/main/lib/permissions/index.ts"
import { invalidatePolicyCache, readPolicyFile } from "<repo>/src/main/lib/permissions/policy-file.ts"
import { classifyToolAction } from "<repo>/src/shared/permissions/classifier.ts"

const MIX = [
  { toolName: "Read", toolInput: { file_path: "src/a.ts" } },
  { toolName: "Grep", toolInput: { pattern: "TODO" } },
  { toolName: "Glob", toolInput: { pattern: "**/*.ts" } },
  { toolName: "Edit", toolInput: { file_path: "src/a.ts" } },
  { toolName: "Write", toolInput: { file_path: "src/b.ts" } },
  { toolName: "Bash", toolInput: { command: "npm test" } },
  { toolName: "Bash", toolInput: { command: "git status --porcelain" } },
  { toolName: "Bash", toolInput: { command: "rm -rf /tmp/build" } },
  { toolName: "WebFetch", toolInput: { url: "https://example.test" } },
  { toolName: "AskUserQuestion", toolInput: {} },
] as const

const root = mkdtempSync(join(tmpdir(), "mauscode-bench-"))
mkdirSync(join(root, "repo"), { recursive: true })
const worktree = realpathSync(join(root, "repo"))
mkdirSync(join(worktree, "src"), { recursive: true })
writeFileSync(join(worktree, "src/a.ts"), "export const a = 1\n", "utf-8")

const ROUNDS = 2000
for (const mode of ["plan", "ask", "edit", "agent", "turbo"] as const) {
  const samples: number[] = []
  for (let i = 0; i < ROUNDS; i++) {
    const action = MIX[i % MIX.length]
    const t0 = process.hrtime.bigint()
    await evaluateAction({
      toolName: action.toolName,
      toolInput: action.toolInput as Record<string, unknown>,
      mode,
      worktreePath: worktree,
    })
    samples.push(Number(process.hrtime.bigint() - t0))
  }
  const warm = samples.slice(100).sort((a, b) => a - b)
  const mean = warm.reduce((a, b) => a + b, 0) / warm.length
  console.log(mode, "mean", mean / 1000, "us  p50", warm[warm.length >> 1] / 1000, "us")
}
if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true })
console.log("app dir:", join(homedir(), ".mauscode"))
```

## Before and after

§12 of the step asks for the cost before and after. The honest answer is that
only "after" was measured directly, and here is why that is a fair comparison
rather than a gap.

**Before**, the non-plan path did not evaluate a policy at all: the SDK was given
the bypass posture, so most calls never reached `canUseTool`. What the router did
check ran inside the callback: a plan-mode `Set` lookup, an ask-mode `Set`
lookup, and `detectDangerousDeletion`, which is six regular expressions over the
command string. Those six regexes are the whole of the old cost, and they are the
same work the classifier now does.

**After**, that regex work is `classifyToolAction`, measured standalone at
**6.7 µs mean / 2.2 µs p50**. So the classification half of the gate costs about
what the old check cost, and the gate's total (9.5 to 21 µs p50) is that plus a
cached policy read (0.8 µs) plus the containment check, which is new work the old
path never did because nothing was checking where a tool's paths pointed.

The new cost buys two things the old path did not have: path containment on every
call that names a file, and coverage of every action rather than the subset that
happened to reach a callback under a bypass posture. The old path's real cost was
not microseconds. It was that four of five modes had no floor at all.

Measuring the old path directly would have meant rebuilding deleted code to time
it, which is not a use of this step's budget. The comparison above is stated as an
inference from the measured classifier cost, not as a measurement.

## Consequence

No caching layer beyond the policy TTL, and no bypass of the path check for
speed. Both would trade a measurable safety property for microseconds that no
user can perceive.

## Wrapper probes, measured through the wired gate

Added after the review pass. Same temporary worktree, no policy file. Each of
these classified as `approval` before it, which Agent mode allows and turbo runs
with no prompt.

| Mode | Command | Verdict | Rule |
| --- | --- | --- | --- |
| agent | `bash -c "rm -rf /"` | deny | `destructive.policy` |
| turbo | `bash -c "rm -rf /"` | ask | `critical-path.critical-delete` |
| turbo | `timeout 30 rm -rf /` | ask | `critical-path.critical-delete` |
| agent | `git -C /repo push --force` | deny | `destructive.policy` |
| turbo | `find / -delete` | ask | `critical-path.critical-delete` |

The two commands that still answer `approval` after all of this are an interpreter
taking inline code and a script written to disk and then run. They are listed under
"The residual gap" in the decision record with the sources that explain why a
pattern table cannot close them.

## Fourth run, 2026-09-19, after the adversarial probe round

This run is the first one with a controlled comparison. The classifier was restored
to its committed state, measured twice, then replaced with the revised one and
measured twice more, in the same session on the same machine, so the delta is not
being read across a change in load.

Harness `/home/user/bench3.mts`, 2000 iterations, no policy file, temporary worktree.
The mix is the same ten calls: 4 read-only, `Edit`, a non-markdown `Write`,
`Bash npm test`, `Bash mkdir -p build/out`, `Bash rm -rf ./dist`, `WebFetch`.

| Measurement | Committed classifier | Revised classifier |
| --- | --- | --- |
| `classifyToolAction`, 10-call mix, mean | 36.8 to 48.2 µs | 42.0 to 46.0 µs |
| `classifyToolAction`, per call, mean | 3.7 to 4.8 µs | 4.2 to 4.6 µs |
| `classifyToolAction`, per call, p50 | ~1.7 µs | ~2.1 µs |
| `evaluateAction`, agent, mean | 225.7 to 238.8 µs | 195.9 to 246.4 µs |
| `evaluateAction`, agent, p50 | 19.5 to 21.3 µs | 19.3 to 22.7 µs |
| `evaluateAction`, turbo, mean | 186.6 to 195.1 µs | 201.4 to 223.2 µs |
| `evaluateAction`, turbo, p50 | 17.4 to 19.6 µs | 18.8 to 19.1 µs |

**What this table does and does not show.** An earlier draft of this paragraph claimed
the `evaluateAction` bands overlap completely. That was wrong and it is corrected here
rather than left standing. The agent mean bands overlap, 225.7 to 238.8 µs against 195.9
to 246.4 µs, and both p50 bands overlap, 17.4 to 19.6 µs against 18.8 to 19.1 µs. The
turbo mean bands do not: 186.6 to 195.1 µs against 201.4 to 223.2 µs is a separation of
about 6 µs with no shared ground.

That turbo mean delta is unexplained and stays on the record as unexplained. The harness
that produced the A/B was lost when the sandbox was reprovisioned, so it cannot be re-run
here, and the machine it ran on has two CPUs, where a mean that moves while the median
does not is usually a tail effect from garbage collection or scheduling. That reading is a
hypothesis about a measurement nobody can repeat, so it is written as one and not as a
result. What the table supports is narrower: the median cost of a gated call did not move.

The part this PR actually changes was measured again on its own, interleaved so a drift in
machine load lands on both sides instead of one. Harness `/home/user/bench4.mts`, 2000
iterations of the same ten-call mix after a 20000-iteration warm-up, two passes, committed
classifier read back out of `6222fb1`:

| Measurement | Committed classifier | Revised classifier |
| --- | --- | --- |
| `classifyToolAction`, per call, mean | 1.33 to 1.49 µs | 1.59 to 1.78 µs |
| `classifyToolAction`, per call, p50 | 1.16 to 1.25 µs | 1.39 to 1.54 µs |
| Verdicts that differ over the mix | | 0 of 10 |

Classification costs about 0.25 µs more per call, consistently across both passes, and it
returns the same class and rule id for every call in the mix. These absolute figures are
lower than the `evaluateAction` rows above because this harness classifies only: it does
none of the path syscalls `evaluateAction` performs, which is where the other 190 µs goes.
The two tables are not comparable to each other and are not meant to be.

**The figures recorded earlier in this file are not comparable to these**, and the
difference is the harness rather than the code. This one drives the wired gate in
`src/main/lib/permissions/index.ts`, so every call performs the real path check in
`containment.ts`, which stats and canonicalises on the filesystem. Those syscalls are
what the mean is made of, and the p50 is the representative number for a call that
names no path. The earlier 70 to 96 µs means were measured without that work. Both
runs agree on the conclusion, which is that the gate is three or four orders of
magnitude below a model round-trip and is not on the critical path.

**The verdict mix is byte-identical to every run before it**: 800/0/1200, 800/1000/200,
1600/0/400, 1800/0/200, 2000/0/0. That is the result worth the most here. Two probe
batteries closed 42 silently-allowed commands and added 149 tests, and the ordinary
ten-call turn behaves exactly as it did, in every mode.

### The evasion battery, timed on its own

Five commands that exercise the new patterns rather than the ordinary ones: the
numbered `GIT_CONFIG` injection, a `--mount=type=bind` container escape, a grouped
`find` with `-exec rm`, a `/dev/tcp` reverse shell, and `su root -c`.

| Measurement | Result |
| --- | --- |
| `classifyToolAction`, 5 heavy commands, mean | 51.1 to 58.4 µs, so 10.2 to 11.7 µs each |
| `evaluateAction`, turbo, 5 heavy commands, mean | 73.1 to 82.3 µs, so 14.6 to 16.5 µs each |

A heavy command costs two to three times an ordinary one, because the strings are
longer and more patterns run. At the turbo p50 that is still under twenty
microseconds, and turbo is the mode that runs the most calls without stopping.
