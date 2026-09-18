# mausCode end-to-end review protocol

This document defines the required review process for `mausCode`.

The process applies to pull requests that change application code, tests, generated output, dependencies, build scripts, workflows, configuration, packaged assets, or documentation that changes an operational contract.

The review goal is to find defects the pull request introduced, exposed, or made reachable. Do not report pre-existing defects unless the pull request makes them worse, makes them reachable, or blocks a safe fix.

This protocol has four parts.

1. **Part I, review procedure**, defines the required review actions, the evidence rules, and the phase gates.
2. **Part II, project risk catalog**, defines conditional mausCode-specific checks for the Electron main and renderer processes, the runtime protocol and provider adapters, persistence, CI and packaging.
3. **Part III, operational changes and automation backlog**, lists the repository changes that make this procedure repeatable.
4. **Part IV, external references**, pins the external review skills this protocol builds on and states how each informs it. Those references are non-normative.

Part I is the sole normative process. Parts II through IV are conditional checks, an operational backlog, and reference material. If guidance conflicts, Part I and `AGENTS.md` take precedence.

A reviewer must not treat a catalog item as a finding on its own. A finding needs evidence that the pull request creates a reachable defect.

---

# Part I, review procedure

## 1. Terms, review contract, and evidence rules

### 1.1 Terms

| Term | Meaning |
| --- | --- |
| Contract | An observable promise to a caller, user, renderer, provider CLI, or test. |
| Boundary | A point where data, authority, lifecycle ownership, or failure ownership changes. In this app that is usually the preload bridge, a tRPC procedure, a provider adapter, the runtime protocol, or the SQLite layer. |
| Evidence | A code trace, test result, CI result, reproduction, or runtime observation. |
| Verification | A command, test, inspection, or manual scenario that checks a contract. |
| Risk | The review depth a changed area requires. Risk is not finding severity. |
| Finding | A confirmed defect the pull request introduced or made reachable. |
| Assumption | A statement you have not verified. |
| Unknown | A required fact you cannot obtain from the pull request, the repository, or CI. |

### 1.2 Review contract

A review must:

1. Compare the reviewed head SHA with the target branch.
2. Read the complete diff before you make any line-level finding.
3. Inventory the changed contracts before you select verification.
4. Identify every changed behaviour, contract, and operational surface.
5. Trace each changed boundary to its consumers, in both directions where the boundary is a protocol.
6. Review the success, failure, cancellation, retry, disconnect, and shutdown paths.
7. Inspect tests for coverage and for validity, independently from the implementation.
8. Run or inspect every relevant verification gate, record its status, and never claim an unrun check passed.
9. Report only findings that meet all five validation conditions in section 10.
10. Separate verified facts from assumptions and unknowns.
11. Stop only when every required phase gate has an explicit result.

A review must not:

- Report a style preference as a correctness finding.
- Claim a command passed when you did not run it.
- Require a named implementation pattern when another implementation keeps the same contract.
- Infer main-process behaviour only from a mocked unit test, or renderer behaviour only from a type check.
- Infer provider CLI behaviour from the mock peer alone. A mock proves your parsing, not the CLI's output.
- Infer packaging behaviour from a dev-mode run, or one platform from another.
- Treat a test as valid when it can pass while the changed contract is broken, or when it restates an implementation constant.
- Report a pre-existing issue unless this pull request makes it worse, reachable, or unfixable.
- Mark CI as passing while a required check is pending, unavailable, or inconclusive.

### 1.3 Evidence quality

Use the strongest evidence you can get.

| Level | Evidence | Allowed conclusion |
| --- | --- | --- |
| E0 | Intent in the PR text or comments | Intended behaviour only |
| E1 | Static inspection of the changed code | A plausible code path |
| E2 | A consumer trace or a focused test inspection | Reachability or contract coverage |
| E3 | A command or test completed on the reviewed head SHA | Verified behaviour within the test scope |
| E4 | A scenario run in the real app, either `bun run dev` or the packaged build | Verified user-visible runtime behaviour |
| E5 | A reproduction on the relevant platform and persisted state | A confirmed real defect |

Do not describe an E1 conclusion as an E4 conclusion. Treat PR text as intent, code and tests as implementation, and CI output as verification evidence.

---

## 2. Review inputs and the evidence ledger

Collect these before detailed analysis:

- Target branch and reviewed head SHA.
- PR title, description, linked issues, and prior discussion.
- The full diff, including renames, deletions, generated files, `bun.lock`, workflows, config, and binary assets.
- Changed files and the symbols they changed.
- The tests nearest each changed behaviour.
- CI jobs, their status, and the exact commands they run, from `.github/workflows/ci.yml`.
- The repository instructions that bind the area: `AGENTS.md`, `CLAUDE.md`, `docs/backend-porting-recipe.md`, `DESIGN.md`, `docs/design-system-baseline.md`, `docs/design-skills.md`, `docs/ci-gotchas.md`, `docs/protocol.md`, `CONTRIBUTING.md`, `biome.json`, `electron.vite.config.ts`, `electron-builder.yml`.
- For any UI, design, motion, typography or copy change: the skills named in `docs/design-skills.md`, loaded before the diff is judged, and the antislop Delivery Gate report for the change.
- For provider work: the adapter's `README.md`, its mock fixture, and the pinned binary version in `package.json`.

Create the ledger before you write findings.

| ID | Contract or concern | Evidence source | Level | Result | Follow-up |
| --- | --- | --- | --- | --- | --- |
| E-01 | A renamed tRPC input still decodes for existing clients | Router schema and its callers | E2 | Verified or unverified | Add a decode test |
| E-02 | A provider adapter cleans up its child process on cancel | Session module and its test | E3 | Verified or unverified | Run the adapter test |
| E-03 | A migration leaves an existing database openable | Migration SQL plus a copy of a real DB | E4 | Verified or unverified | Manual scenario |

Keep one stable id when a concern spans several files.

---

## 3. Phase 0: scope, baseline, and change inventory

### 3.1 Establish the baseline

1. Identify the base branch and the head SHA.
2. Check for merge conflicts and whether an automated rebase is safe.
3. Identify which commits belong to this PR.
4. Identify generated files and vendored output, for example `drizzle/*.sql`, `packages/runtime-client/dist`, `src/main/lib/codex-app-server/src/_generated/schema.gen.ts`, `resources/bin`, and `build/`.
5. Identify dependency and lockfile changes, and whether `bun.lock` was regenerated.
6. Identify deleted or disabled tests, weakened assertions, removed suppressions, and any new `biome-ignore`.
7. Identify changed environment variables and build-time config, especially `MAIN_VITE_API_URL`, `MAIN_VITE_UPDATE_FEED_URL`, and the pins in the `claude:download` and `codex:download` scripts.
8. Identify config that behaves differently in dev, CI, packaging, and a user's machine.

Do not assume a file is generated from its name. Find the generator, script, or build step, or state that it is hand-written.

### 3.2 Build the change inventory

Write one record per changed contract. One file can produce several records.

| Field | Required content |
| --- | --- |
| File | Repository-relative path |
| Change type | Behaviour, API, persistence, security, UI, test, CI, dependency, docs, generated output, asset |
| Changed contract | What a caller, user, renderer, or provider CLI can observe |
| Entry points | tRPC procedure, IPC channel, exported function, hook, listener, script, workflow |
| Consumers | Callers, renderer stores, protocol clients, DB readers, CI jobs |
| Risk level | Critical, high, medium, or low |
| Required verification | Commands, tests, manual scenario, inspection |

Use the highest applicable risk level.

| Risk | Examples in this repository | Minimum depth |
| --- | --- | --- |
| Critical | Approval, sandbox, or egress policy, credential handling, the auto-update feed and manifest, `shell.openExternal`, workspace file read and write paths, preload exposure, anything that widens what the renderer may reach | Full security, contract, test, and verification review |
| High | SQLite migrations and startup recovery, child process lifecycle, protocol event and chunk mapping, binary download and integrity checks, packaging config, workflow changes, release artifacts | Full contract and lifecycle review with direct evidence |
| Medium | Stateful UI, tRPC payload shapes, validation, error handling, dependency bumps, generated schema, settings persistence | Consumer trace, tests, targeted verification |
| Low | Isolated rendering, copy, comments, formatting, non-operational docs | Diff inspection plus the local checks that apply |

Risk selects review depth. Severity describes the impact of a confirmed finding. Do not use one as the other.

### 3.3 Select the review modules

| Change type | Required modules |
| --- | --- |
| React component or hook | Contract, lifecycle, accessibility, tests |
| tRPC procedure or shared type | Contract, consumer trace, validation, tests |
| Drizzle schema or migration | Persistence, compatibility, recovery, tests |
| Provider adapter or session module | Lifecycle, subprocess, protocol mapping, mock and test review |
| Runtime protocol event or chunk | Contract, translate trace, renderer consumer, tests |
| Filesystem read, write, or watch | Security, path and symlink analysis, cleanup, tests |
| Download, binary, or asset | Network, integrity, cleanup, retry, packaging, size delta |
| Dependency or lockfile | Supply chain, consumer impact, build and CI verification |
| Workflow or release config | Trigger, permission, secret, cache key, platform matrix review |
| Documentation | Command accuracy, contract accuracy, operational impact |
| Visual design, style, motion or copy on a UI surface | Baseline conformance, Delivery Gate, accessibility, focus and states, motion constants, tests |

Record `Not applicable` with a reason for every module you skip. A docs-only change must not get the depth of a migration, but the record and the reason must exist.

---

## 4. Phase 1: diff, symbol, and boundary trace

Read the complete diff before you read any line in isolation.

For every changed exported symbol, procedure, config key, schema, migration, protocol field, workflow input, or environment variable:

1. Find its declaration or source of truth.
2. Find direct consumers and call sites.
3. Find indirect consumers through wrappers, hooks, stores, generated schemas, or config.
4. Find the tests that claim to cover it.
5. Find the adjacent contracts, types, and generated outputs.
6. Find the error, cancellation, cleanup, and rollback paths.
7. Find the persisted state and anything that depends on its shape.
8. Find the platform branches, since this app ships macOS, Windows, and Linux builds with per-platform binaries.
9. Record the trace in the ledger.

### 4.1 Required boundary traces

| Changed boundary | Required trace |
| --- | --- |
| Renderer component to store to tRPC call | Props, ownership of state, effect lifecycle, pending, empty, error, and cancel states |
| Preload bridge to main handler | What is exposed, what is not, argument validation, error shape crossing back |
| tRPC procedure to provider adapter | Input schema, capability checks, session reuse, one-in-flight-turn rule, disposal |
| Adapter to child process | Executable selection, args, env, bounded stdout and stderr drain, timeout, kill, reap, temp cleanup |
| Provider output to chunk stream | Event mapping, dropped events, tool-name canonicalisation, usage accounting, error subtype rules |
| Chunk stream to renderer UI | `translate` coverage, message store update, ordering, coalescing, teardown on unmount |
| Router to SQLite schema | Migration, transaction, rollback, retry, recovery on a dirty database |
| Config or env to runtime behaviour | Dev, CI, packaged, and local-only differences, and which build target reads it |
| Workflow to build input | Trigger, permissions, cache key, install flags, platform job, path filters |
| `package.json` to `bun.lock` | Declaration, resolution, workspace consumer, and the CI install path |

### 4.2 Generated artifacts

1. Identify the source of truth.
2. Identify the generation command, for example `npm run db:generate`, `bun run build:runtime-client`, `npm run icon:generate`, `npm run dist:manifest`, or the provider CLI schema generator.
3. Verify the generated output matches the source.
4. Check that a generated-file change does not hide or replace a source change.
5. Do not recommend hand-editing generated output.
6. Report a stale artifact only when source and output disagree.

### 4.3 Dependency changes

For each changed dependency, identify the direct and transitive consumers, and whether the change reaches the app runtime, the build tooling, CI, or packaging. Confirm `bun.lock` matches the manifest. Check pins and floors, since `@biomejs/biome` is pinned exactly at 2.5.13 and `@effect/vitest` at a release candidate. Check whether a native module such as `better-sqlite3` or `node-pty` needs the `postinstall` rebuild, which CI skips with `--ignore-scripts` in the quality and build jobs and runs in full only in the package job. Check whether the update moves a security, network, filesystem, or serialization boundary. Record the verification that runs an affected consumer.

Do not report "dependency updated without tests" unless the update has a reachable contract impact and no relevant verification exists.

---

## 5. Phase 2: contract review

Define each changed behaviour before you judge its implementation.

```text
Given: [initial state, platform, persisted state, valid input]
When:  [user action, IPC call, stream event, retry, startup, or shutdown]
Then:  [observable result]
And:   [failure, cancellation, cleanup, rollback, and retry result]
```

For stateful behaviour, add:

```text
Invariant: [condition that must stay true]
Owner:     [component, process, transaction, or module responsible]
End state: [required state after success, failure, and cancellation]
```

### 5.1 Input and output review

Check what applies:

- The receiving boundary validates input that came from the renderer, a file, or a provider CLI.
- Numbers survive JSON and IPC. Timestamps and byte counts must not lose precision.
- Empty, missing, `null`, `undefined`, malformed JSON, and unknown enum variants have defined behaviour.
- Error strings sent to the renderer do not carry tokens, key file contents, or absolute paths of other users' files.
- Each caller gets the result shape it expects.
- A default does not silently change behaviour for people who already have settings, a database, or a worktree config.
- Field naming, optionality, and serialisation stay compatible.
- A change to a public type, a persisted shape, or user-visible state came with the consumer update it implies.
- Every state a user can see has explicit pending, success, empty, and error behaviour where each is possible.

### 5.2 Failure, recovery, and retry review

For each operation that can fail:

1. Name the failure owner.
2. Compare the state before and after failure, and check that failure leaves a valid state.
3. Check whether a partial operation rolls back, compensates, or recovers.
4. Check what retry does and whether it is idempotent, with no duplicate work, corrupt state, or leaked process.
5. Check whether the failure is logged, surfaced at the right layer, or deliberately swallowed.
6. Check whether failure blocks startup or allows degraded operation, since local-only mode must keep working when a hosted service is absent.

A recovery path must keep the diagnostic evidence the product needs. Never delete a database, a worktree, or a provider config file as part of recovery without preserving the original.

### 5.3 Concurrency and lifecycle review

For async or long-lived work, name the start owner, cancellation owner, completion owner, cleanup owner, and resource owner, plus how a stale result is rejected, what shutdown does, and what a replacement turn does.

Check for:

- A stale async completion overwriting newer state.
- A callback that runs after unmount, cancellation, or replacement.
- An event listener or IPC subscription that survives teardown.
- A timer, stream, child process, transaction, or file handle left open after failure or cancel.
- Shared mutable state without a session, request, or generation identity.
- A `setOnChunk` style rebinding that strands the previous subscriber.
- More than one in-flight turn for a session that can only carry one.
- A global cancel that crosses session or sub-chat boundaries.
- Duplicate work from double clicks, auto-retries, or optimistic create plus server echo.

### 5.4 Compatibility review

For persisted or platform-sensitive changes, check:

- Fresh install behaviour.
- Upgrade from a previous build, including an existing `~/.mauscode` database, `.mauscode/worktree.json`, app settings, and cached model or provider config.
- That migrations handle both fresh and existing databases.
- Behaviour after an interrupted operation.
- Behaviour with corrupted or hand-edited persisted state.
- Behaviour when an optional asset is missing or a provider binary is not installed, which must degrade instead of failing startup.
- Equivalent behaviour on macOS, Windows, and Linux where the contract is shared.
- `localStorage` shapes, and whether a versioned migration exists when the shape changed.

---

## 6. Phase 3: security and authority review

Run this phase for every critical and high risk record, and the relevant subsections for the rest.

### 6.1 Threat model record

| Field | Required content |
| --- | --- |
| Asset | The user's database, provider config, tokens, workspace files, agent binaries, update feed |
| Attacker control | A renderer payload, a file path, a repo or PR string, provider CLI stdout, a download, a workflow event |
| Trust boundary | Renderer to main, main to child process, download to disk, CI event to secret |
| Required property | No traversal, no unvalidated invoke, integrity preserved, bounded resource use |
| Enforcement point | A validation function, a capability check, the CSP, a transaction, a workflow permission |
| Test or evidence | A rejected-input test, a config trace, an integration test, a CI inspection |

### 6.2 Electron process authority

- Check what `src/preload` exposes. Anything on the bridge is callable from renderer code, including content the app renders.
- Check the CSP in `src/renderer/index.html`. It currently allows `'unsafe-inline'` and `'unsafe-eval'`, `https://unpkg.com`, and PostHog hosts, and `connect-src` allows `http://localhost:*` and `ws://localhost:*`. A change that widens it further needs a stated reason and a named consumer. Never add a wildcard to a directive.
- Check that renderer code uses relative URLs and does not call `localhost` or another origin to reach a service the sandbox or the user's machine hosts.
- Validate every URL before `shell.openExternal`. A user or provider supplied string must not reach it unchecked.
- Confirm the window does not enable `nodeIntegration`, and that any new privileged main handler validates its arguments at the boundary instead of trusting the renderer.
- Confirm markdown, diffs, and terminal output render through the existing sanitising or escaping path, since provider output is untrusted text.

### 6.3 Filesystem authority

Workspace file read, write, diff, and search endpoints are the main traversal risk in this app.

1. Validate the shape of the path, then reject traversal and absolute paths where a repo-relative path is required.
2. Resolve the intended project or worktree root.
3. Canonicalise the existing components before you compare.
4. Check symlink behaviour, including the final component.
5. Perform the operation on the validated absolute path, never on the raw input.
6. Clean up partial output on failure.
7. Test delete, overwrite, extraction, traversal, absolute path, and symlink escape where the change reaches them.

A string prefix check does not prove containment.

### 6.4 Provider CLI, subprocess, and config files

- Executable selection comes from the pinned or configured binary, not from a user string. Check the allow-list path in `src/main/lib/*-binary.ts` and `cli-binaries.ts`.
- Never widen an approval, sandbox, or egress policy silently. `docs/backend-porting-recipe.md` section 7 puts those changes in the capability manifest, and `bypassPermissions` is never portable.
- Bound captured stdout and stderr, drain both without deadlocking, and kill plus reap on timeout.
- This app reads user provider config such as `~/.claude/settings.json`, `~/.claude.json`, and `~/.qwen/settings.json`, and writes OAuth entries only through the atomic path. Check that a read stays read-only, a write preserves unknown user keys, and a failed write leaves the previous file intact.
- Secrets live in exactly one place, `src/main/auth-store.ts`, which encrypts through Electron `safeStorage`. Read its fallback before you copy the pattern: when encryption is unavailable it logs a warning and stores the payload unencrypted, so a new caller must not treat that path as safe by default, and nothing may log a token.

### 6.5 Network, downloads, and updates

- Validate each redirect target, cap hops, and enforce a byte limit while streaming rather than trusting `Content-Length`.
- Verify artifact integrity. `scripts/download-claude-binary.mjs` and `scripts/download-codex-binary.mjs` hash files with sha256 against a manifest checksum, and the codex script keeps a `.codex-asset.sha256` marker. A change that skips, loosens, or reuses that check needs a reason.
- Delete partial downloads on failure or cancellation.
- The update feed is build-time config. `MAIN_VITE_UPDATE_FEED_URL` is empty by default and auto-update stays off, which is the shipped behaviour. A change that adds a default host, changes `npm run dist:manifest` output, or trusts a new signer is a release-trust change and needs review at critical depth.

### 6.6 CI, release, and secrets

- Job permissions use `contents: read` at job level, and write scope appears only where a step needs it.
- Fork-triggered runs get no privileged secrets.
- Signing keys, tokens, and feed credentials stay out of the repository.
- Cache keys include the inputs that change compiled output.
- Path filters, if anyone adds them, must cover `src`, `packages`, `biome.json`, `tsconfig*.json`, `electron.vite.config.ts`, `electron-builder.yml`, `drizzle`, `resources`, and `bun.lock`. Today CI runs on every PR, which is safe but slow; the failure mode to watch is a future filter that omits a build input.
- Release steps run only on the intended events and branches.

---

## 7. Phase 4: test review and test validity

Review test quality separately from implementation correctness.

### 7.1 Evidence classification

| Class | Meaning |
| --- | --- |
| Direct test | Exercises the changed contract through its public boundary |
| Indirect test | Covers the contract inside a larger flow |
| Regression test | Fails before the change and passes after it |
| Negative test | Confirms rejected input or failure handling |
| Recovery test | Confirms a safe state after failure plus retry behaviour |
| Missing test | No evidence protects a contract that changed |
| Invalid test | Can pass while the required behaviour is broken |

### 7.2 Test validity questions

1. Would this test fail if the change were reverted?
2. Does it use the public contract rather than an implementation detail?
3. Does it mock the module that contains the behaviour under test?
4. Does the expected value come from an independent source, or does it restate a constant from the implementation?
5. Does it check failure as well as success?
6. Does it wait on readiness instead of elapsed time?
7. Does it restore global state, environment variables, temp directories, and any home-directory config it touched?
8. Could it pass only because the mock repeats the same bug?
9. Does it protect an existing user's state, not only a fresh one?
10. Does it distinguish a visible UI result from an internal helper call?
11. Does it separate the old behaviour from the new one, or would both pass?
12. For stream tests, does it assert the payload of a chunk, or only that a chunk exists?

### 7.3 Required test types

| Changed area | Minimum evidence |
| --- | --- |
| Pure deterministic function | Unit test with boundary and error cases |
| React hook or state transition | Test with mount, update, and cleanup behaviour |
| tRPC procedure or shared schema | Decode test for old and new shapes |
| Provider adapter turn handling | Test against the mock peer for text, tools, usage, cancel, non-zero exit, and a final line without a trailing newline |
| Subprocess management | Exit, timeout, cancellation, and output-bound tests, plus a temp-directory cleanup check |
| Filesystem operation | Integration test in a temp directory with rejected paths |
| SQLite migration | Fresh database, upgrade, failure, and recovery tests |
| Download or binary install | Integrity, cleanup, retry, and readiness tests |
| Bug fix with a reproducible failure | Regression test |
| Security boundary | Rejected-input tests |
| CI or release config | Static workflow inspection plus the CI evidence itself |
| Renderer interaction | Behaviour test where one exists, otherwise a documented manual scenario |

Prefer the smallest test level that proves the contract. Use unit tests for pure logic, integration tests for persistence, process handling, and module boundaries, and a real app run for flows that only exist at runtime.

### 7.4 Test anti-patterns

Treat these as findings when they touch changed behaviour:

- An expected schema or event list copied from the production constant, so a rename passes silently.
- A mock that replaces the function under test.
- Assertions on which functions were called instead of what the user can observe.
- A fixed sleep where a readiness condition exists.
- A test that does not await async cleanup, so a leaked child process or socket goes unnoticed.
- A test that mutates a config file in a user's home directory without restoring it.
- A lookup with `find` followed by an unchecked property read, which fails as a `TypeError` instead of naming what was missing. `src/main/lib/print-test-helpers.ts` and `requestOf` in `packages/runtime-client/test/mock-harness.ts` exist for this reason.
- A test typed with `any`, `as any`, or a suppression so that the assertion cannot fail. Biome reports `noExplicitAny` as an error now, so a reintroduced cast is a review finding on its own.
- An existence check standing in for a content check on a stream chunk.

---

## 8. Phase 5: application scenarios

Unit tests do not replace running the app when a critical flow changed. Select scenarios from the inventory.

### 8.1 Startup, database, and recovery

1. A fresh profile starts and creates the database.
2. An existing profile from a previous build starts and migrates.
3. A failed prior migration follows the documented path and preserves the original file.
4. A corrupted or hand-edited database does not get silently deleted.
5. Missing optional binaries degrade to a clear message instead of a crash.
6. With `MAIN_VITE_API_URL` unset, local features still work and hosted features stay visibly unavailable.
7. Startup logs carry useful context and contain no token or key material.

### 8.2 Provider turn lifecycle

1. A normal turn streams text and tools, then finishes with usage.
2. A cancel stops the child process, releases the temp files, and leaves the session reusable.
3. A non-zero exit surfaces as an error with the CLI's message, not a silent empty answer.
4. A reconnect or resume after a restart reattaches or starts fresh according to `docs/backend-porting-recipe.md` section 3, and reports which happened.
5. Two turns cannot run at once on one session, and a queued or second send is handled explicitly.
6. A provider config file that lacks the expected shape produces a readable state, not a stack trace in the UI.

### 8.3 Terminal, filesystem, and workspace

- A PTY resize, a full-screen program, and a closed tab leave no orphan process.
- File reads and writes honour the project root, and a symlink inside the repo is handled deliberately.
- A large file, a binary file, and a deleted file all have defined rendering.

### 8.4 Packaging

- `bun run build` completes with the heap setting CI uses, and reports the bundle sizes CI prints.
- `bun run package:mac` or `--dir` produces an app that launches with the bundled agent binaries present in `resources/bin`.
- Renderer asset weight moves in the expected direction. Record the before and after bytes when an asset changed.

### 8.5 Cross-platform

Record which platform and version you tested. Do not generalise one platform's result. Windows path handling, macOS notarisation and signing, and Linux packaging each have their own CI job or deliberate absence.

---

## 9. Phase 6: verification matrix

Use the repository's own commands, the ones CI runs.

### Everything

```sh
export NODE_OPTIONS=--max-old-space-size=4096
bun install --frozen-lockfile --ignore-scripts
bun run build:runtime-client
bun x biome check .
npm run typecheck
node scripts/ci/lint-changed.mjs
node scripts/ci/typecheck-ratchet.mjs
```

### Application and shared code

```sh
npm run test                 # vitest, src/**/*.test.ts
npm run test:contracts       # the vendored contract suites
npm run test:node            # node:test suites for the runtime layer
npm --prefix packages/runtime-client run typecheck
npm --prefix packages/runtime-client run test
```

### Renderer and main process build

```sh
bun run build                # main, preload, renderer. Needs the large heap above
bunx electron-builder --dir  # unsigned packaged output
```

### Security and supply chain

```sh
node scripts/ci/audit-ratchet.mjs
# No secret scanner is wired as a package script. CI downloads gitleaks 8.30.1, checks its
# sha256, and runs `gitleaks dir --verbose .`. Reproduce that, or record the check as Not run.
```

### Status vocabulary

Record one status per required check: `Passed`, `Failed`, `Not run`, `Not applicable`, or `Inconclusive`.

| Check | Applies when | Status | Evidence |
| --- | --- | --- | --- |
| Lint and format | Any source, style, or config change | one of the five | Exact command and head SHA |
| Typecheck | Any TypeScript contract change | … | Exact command and head SHA |
| Unit tests | Changed deterministic logic | … | Command and scope |
| Contract and runtime suites | Protocol, persistence, or runtime change | … | Command and scope |
| Build | Renderer, main, or preload change | … | Command plus bundle sizes |
| Packaging | Anything that ships | … | Builder command and output |
| Workflow inspection | Workflow or release change | … | Reviewed paths and permissions |
| Security review | Critical or high risk boundary | … | Threat model record |

Do not call CI green while a required check is pending, unavailable, or inconclusive. A review with a required `Not run` or `Inconclusive` result is `Needs Verification`, not `Ready`.

---

## 10. Phase 7: finding validation and severity

A candidate finding needs all five conditions.

1. **Diff cause.** This pull request introduced the defect, changed its reachability, or blocks its safe repair.
2. **Reachable scenario.** A concrete input, state, event sequence, or platform condition reaches it.
3. **Concrete impact.** The correctness, security, data, lifecycle, performance, or user outcome is stated as a mechanism or a number.
4. **Minimal remediation.** A safe, small change preserves the intended contract.
5. **Verification path.** A test, scenario, or command can prove the fix.

Discard the candidate if one condition is missing.

| Severity | Meaning |
| --- | --- |
| Critical | Exploitable authority or security boundary failure, data loss, startup failure for everyone, or a release-blocking defect |
| High | Common correctness failure or crash, persistent corruption, a broken core flow, unsafe recovery, a serious leak, or a reachable security defect |
| Medium | Reachable defect with bounded impact, incomplete recovery or error handling, or missing behaviour that matters |
| Low | Uncommon defect or defensive gap with limited impact |
| Nitpick | No runtime or operational impact |

Report one finding per root cause. Do not split one defect into several comments, and do not merge unrelated defects into one. Never report a finding only because the implementation differs from a pattern you would have chosen.

---

## 11. Report format

Use this order.

```md
## Verdict

**Status:** Ready | Not Ready | Needs Verification
**Confidence:** High | Medium | Low
**Mergeable:** Yes | No | Unknown
**CI verification:** Passing | Failing | Pending | Inconclusive

## Change inventory

| Area | Changed contract | Risk | Required verification | Result |
| --- | --- | --- | --- | --- |

## Findings

### [Critical|High|Medium|Low] Title

**Location:** `path/to/file.ext`, line N
**Diff cause:** [what this pull request changed]
**Evidence:** [code trace, test result, CI output, or reproduction]
**Reachable scenario:** [input, persisted state, event sequence, or platform]
**Impact:** [consequence, as a mechanism or a number]
**Required change:** [minimal safe remediation]
**Verification:** [the test, scenario, or command that proves it]

## Missing test coverage

- [changed contract]: [the smallest test that proves it]

## Verification performed

| Check | Status | Evidence |
| --- | --- | --- |

## Correct behaviour confirmed

- [contract]: [evidence and scope]

## Assumptions and unknowns

- [what could not be verified, and why]
```

When no finding survives validation, write `No validated findings.` Do not add empty sections, and do not list an assumption as a finding.

---

## 12. Completion rules

A review is `Ready` only when:

- No unresolved critical, high, or medium finding remains.
- Every critical and high risk contract has direct evidence or a documented, justified indirect path.
- Required verification is `Passed` or explicitly `Not applicable`.
- Generated output matches its source of truth.
- Required boundary traces are complete.
- The report separates verified facts from assumptions and unknowns.

A review is `Needs Verification` when the analysis is complete but execution evidence is pending, unavailable, or inconclusive. A review is `Not Ready` when a validated finding blocks a safe merge.

Confidence measures evidence quality, not how sure you feel. Do not claim high confidence without completing every relevant verification step.

| Confidence | Meaning |
| --- | --- |
| High | Required traces and verification are complete |
| Medium | Analysis is complete, but verification or platform coverage is partial |
| Low | Important inputs, traces, or verification are unavailable |

### 12.1 Fast path for low-risk docs-only changes

When every inventory record is low risk and no changed file affects an operational contract, meaning no code, test, workflow, manifest, lockfile, config, generated output, or documented command changed, use this minimum form. If any record exceeds low risk, run the full procedure.

1. Read the complete diff.
2. Confirm the inventory holds only low-risk records, and write the reason.
3. Check that changed prose does not alter a documented command, path, contract, or security statement. A doc change that edits an operational instruction is not docs-only, so reclassify it and run the full procedure.
4. Verify the claims in the prose against the repository, since a stale instruction in this repo's docs is how agents relearn the same thing badly.
5. Record the formatting check as `Not applicable` if the change is Markdown only, because Biome's gate in this repository covers code and style, not prose.

```md
## Verdict

**Status:** Ready | Not Ready
**Confidence:** High | Medium | Low
**Mergeable:** Yes | No | Unknown
**CI verification:** Passing | Failing | Pending | Inconclusive

## Change inventory

One line per file: path, `docs-only`, low, and the reason.

## Findings

`No validated findings.` or the standard format.

## Verification performed

| Check | Status | Evidence |
| --- | --- | --- |
```

The fast path never applies to changes touching `AGENTS.md`, `REVIEW.md`, this file, `biome.json`, `electron.vite.config.ts`, `electron-builder.yml`, `.github/workflows`, or anything listed critical or high in section 3.2.

---

# Part II, project risk catalog

Use a module only after Phase 0 selects it. These checks distill the architectural contracts, security boundaries, and recurring findings in this repository. A catalog match is a review prompt, not a finding, so run whatever it surfaces through the Phase 7 validation gate.

## 13. Electron process boundaries

**Traps.** The renderer is a browser process with app privileges. Anything the preload bridge exposes is reachable from renderer code, which includes rendered provider output. A `shell.openExternal` fed by a repo name, PR URL, or changelog string is an arbitrary-URL launch. A CSP that allows `'unsafe-eval'` plus remote script origins turns any injection into code execution. `connect-src` allowing `http://localhost:*` means rendered content can probe local services.

**Pattern.** Expose the smallest named API surface on the bridge, validate every argument in the main process at the handler, keep outbound links through the existing validated path, and treat any CSP or bridge widening as a critical-risk change that needs a named consumer in the diff.

**More traps.** Renderer code that calls `localhost` directly works in dev and dies in a packaged build, and in a proxied preview environment. Native modules need the `postinstall` rebuild, so a run that installed with `--ignore-scripts` cannot prove packaging works. `better-sqlite3` and `node-pty` failures must not be silently swallowed at import time.

## 14. Runtime protocol and provider adapters

**Traps.** A new harness event that `src/main/lib/runtime/translate.ts` does not map disappears without an error. That switch already returns no chunks for 22 event kinds, so a feature that depends on one of them reads like a renderer bug. `resultSubtype: "error"` set on a non-error ends a turn early. Rebinding `setOnChunk` without releasing the previous subscriber strands chunks. A `dispose()` that is not idempotent throws on the second teardown during a window close. A resume that trusts a stale native id reuses the wrong session.

**Pattern.** Follow `docs/backend-porting-recipe.md`. Extend the closed chunk dialect deliberately, keep `dispose()` idempotent, allow one in-flight turn, resume native id to legacy to fresh in that order, clean temp files in `finally`, fingerprint a session on `(cwd, auth, mcp, effort, model)`, and ship a mock peer with binary-free lifecycle tests. The session watchdog detects and reports; it does not kill.

**More traps.** Buffering a chatty CLI's whole stdout in memory instead of draining it, joining a reader while the child still holds the pipe, and reading the final line only when it ends in a newline. The six print adapters already encode these edge cases, so a new adapter copies them rather than redeciding. Tool-name canonicalisation and MCP `__` splitting are shared behaviour, so duplicated per-adapter logic is a smell.

## 15. React and TypeScript UI

**Traps.** Writing a ref or state during render breaks under StrictMode's double render. A controller built once behind a ref guard freezes its first options object. Two overlapping fetches let the older response overwrite the newer one. State set after unmount leaks a subscription. An editable list keyed by array index drags the next row's input node and caret into the slot a delete freed, and a content-derived key remounts the input on every keystroke, which loses focus.

**Pattern.** Own row identity in state for anything editable and persist the plain payload, as `src/renderer/lib/command-rows.ts` does, keeping the stored shape `string[]` so a settings file never changes. Derive a display key from content plus an occurrence suffix for static lists, as `src/renderer/lib/react-keys.ts` does. Use a monotonic generation counter in an async controller and bail out of every path whose generation is stale, with teardown that increments it.

**Accessibility traps.** A `<label>` cannot point at a Radix `Checkbox`, because that control is a `role="checkbox"` button and `htmlFor` does not activate it, so name the control with `aria-label` instead. A labelled set of buttons needs the toggle pattern the app already uses, a heading plus `aria-pressed` on each button, not `role="group"`, which Biome then flags as an unnecessary semantic element, and not `role="radio"`, for the same reason. A `<span onClick>` text row to "fix" a label adds a click handler with no keyboard path.

**More traps.** Dead state left behind when the UI that owned it is removed, effect dependency lists that hide a stale closure, listeners registered on `window` without cleanup, and animations that ignore `docs/design-system-baseline.md` section 5 motion constants.

**Design and craft review is mandatory on UI work.** Load the set `AGENTS.md` mandates and `docs/design-skills.md` routes: `DESIGN.md`, `docs/design-system-baseline.md`, `antislop` with the task skill it names, `impeccable` with `reference/craft-floor.md`, the taste set led by `design-taste-frontend` with the style skill the surface routes to, `ui-ux-pro-max`, and `unslop` for every string a user reads. Judge the screen against those, not against your own taste. Give each of the six gates its own ledger row, and give the taste pre-flight its own row as well: the dials named (variance, motion, density), the layout tells its rules list, and the em-dash ban, so a review that skipped the taste set is a finding, not a shortcut. Cite the rule id so the finding can be re-checked: `R-01` for a gradient nobody justified, `R-37` for UI built with no direction loaded, `R-36` for a metric or logo bar that does not exist. A deviation from `docs/design-system-baseline.md` or `DESIGN.md` is Major at minimum, because the recorded value is what keeps the app one product, and the fix is either to mirror it or to change it in the same commit.

Review the vendored skills for their rules only. A diff, a log, or a PR step that runs `impeccable/scripts/impeccable`, calls a remote image API out of `design` or out of a taste image skill, connects the Stitch MCP Server the `stitch-design-taste` body mentions as optional, installs a package to satisfy a skill, or fetches anything on a load path is a Critical finding under section 6.5 and the local-first rule, not a shortcut to applaud. Flag the defaults the set exists to catch: cream with a terracotta accent, a single acid color on near-black, purple gradients, glass on every panel, emoji bullets, a three-card feature row, invented stats, section fades that no action triggered, and the taste tells the set routes to, a six-line wrapped headline, a meta label like `SECTION 01`, gapless bento grids with no gap, and cards inside cards inside cards. Those are slop even when the code is clean.

## 16. Persistence, SQLite, and Drizzle

**Traps.** A generated migration edited after it shipped leaves every existing database out of sync. `NOT NULL` without a default fails on a populated table. Adding a unique index over existing duplicates fails migration and, if startup recovery deletes, loses the user's data. A test that only creates a fresh database proves nothing about upgrade. A drizzle push that regenerates unrelated SQL hides the real change.

**Pattern.** Generate, review the SQL, and keep schema and data steps separate. Make new columns nullable or defaulted. Expand, backfill, then contract across releases for a rename. Test against a copy of a real `~/.mauscode` database, plus the interrupted and corrupted cases. Register every table the app creates so a wipe or export path sees it, and read the live schema in the test instead of asserting against a copied list.

## 17. CI, packaging, and supply chain

**Traps.** A quality job that installs with `--ignore-scripts` cannot validate anything native, so packaging needs the full install job that CI already has. The renderer build OOMs under roughly 3 GB of heap because of the monaco, mermaid, and shiki graph, which is why CI exports `NODE_OPTIONS=--max-old-space-size=4096`. A local run without it fails in a way that looks like a code defect. A `paths:` filter added later can exclude a build input, so the safe default here is no filter. A lockfile change that no install command reproduces fails `--frozen-lockfile`. An unpinned tool version makes the gate depend on what the registry served today, which is why Biome is pinned exactly. Committing an update-feed host, a key, or a third-party analytics default breaks the local-only promise; `cdn.21st.dev` and similar upstream hosts must never return.

**Pattern.** Keep tool versions pinned, regenerate `bun.lock` with the same package manager CI uses, record asset and bundle deltas, and check that every new gate runs in CI as well as locally. A binary download keeps its checksum verification, and the manifest generator stays the only place the feed format is written.

## 18. Suggestions, nitpicks, and what this repository's tooling actually checks

**Suggestions** cover performance, maintainability, and defensive gaps: strip dead variables, unused imports, and ignored parameters, prefer optional chaining and explicit narrowing over a cast, and hoist a repeated conditional into the shared module. **Nitpicks** have no runtime effect: formatting drift, a missing trailing newline, a comment that contradicts the code, or a name that no longer describes what it holds.

The tooling boundary matters when you judge a comment. Biome 2.5.13 covers format, lint, and assist for the files `scripts/ci/lint-changed.mjs` selects, and every rule is at `error` with the tree at 0 findings. There is no ESLint, Prettier, oxlint, Sonar, CodeFactor, or review bot configured in this repository today. Markdown and prose are not machine checked, so structure notes on a `.md` file are readability nits, not gates. The gates are the four CI jobs and the scripts under `scripts/ci/`, which are `lint-changed.mjs`, `lint-ratchet.mjs`, `typecheck-ratchet.mjs`, and `audit-ratchet.mjs`. Verify a suggestion does not itself break a gate, for example a fix that adds a suppression comment or an unnecessary `type` import Biome then rejects.

## 19. Anti-pattern checklist

| Category | Smell | Severity | Fix |
| --- | --- | --- | --- |
| Electron security | Renderer reaches a local service by absolute origin | Major | Use relative URLs through the dev server proxy |
| Electron security | Unvalidated URL reaches `shell.openExternal` | Critical | Validate scheme and host at the handler |
| Electron security | CSP directive widened to a remote origin or a wildcard | Critical | Name the consumer, narrow the origin, or drop it |
| Renderer build | OOM blamed on the change | Medium | Export `NODE_OPTIONS=--max-old-space-size=4096`, then recheck |
| Protocol | New harness event unmapped in `src/main/lib/runtime/translate.ts` | High | Map it or state why it stays internal |
| Provider adapter | Unbounded stdout buffer, or a kill without a reap | Major | Drain with a cap, kill and reap, clean temp files in `finally` |
| Provider adapter | Capability widened without the manifest | Critical | Route approvals, sandbox, and egress through section 7 of the recipe |
| Persistence | Migration edited after shipping, or `NOT NULL` with no default | Critical | Add a forward-only migration |
| Persistence | Fresh-database-only test for an upgrade contract | Major | Test a copy of a real database |
| Persistence | A row already handed to another process deleted, requeued or resent while its outcome is unknown | Major | Keep the record visible until its sender retires or parks it, and return only claims that were never handed over to the automatic path |
| Tests | A cap test whose fixture the neighbouring cap already refuses, so the rule it names is never reached | Major | Disable the rule the test names, and confirm the test fails |
| Tests | A test that cannot reach the branch it is named after, or a global restored at the end of the test body | Minor | Give the second actor its own identity, and restore globals in an `afterEach` |
| React keys | Index key on editable rows, or content key on an input | Major | Ids in state for editable rows, derived keys for display lists |
| React lifecycle | Stale async completion overwrites newer state | Major | Generation counter, discard stale results |
| Shared state | A write that changes visible state without emitting, because the emit is keyed on the returned value | Major | Emit when the transaction changed anything, park and release included |
| Concurrency | A guard written after the event it must precede, such as a pause issued after the stop that wakes other windows | Major | Set the guard before the trigger, and re-read it after every await |
| Accessibility | `htmlFor` aimed at a Radix checkbox, or `role="group"` on a button set | Medium | `aria-label` on the control, `aria-pressed` on each button |
| Types | Reintroduced `any`, `as any`, or a suppression | Major | Name the real type, or delete the code that needs the cast |
| Shared logic | Same rule implemented in two provider adapters | Major | Extract into the module the adapters already share |
| Lint config | Rule downgraded or a new `biome-ignore` | High | Fix the code, and use file-scope exclusions only for non-source artifacts |
| Supply chain | `bun.lock` out of step with the manifest | Major | Regenerate with the same tool CI uses |
| Assets | An icon or font shipped far above its display size | Medium | Resize to the rendered size with headroom, and record the byte delta |
| Branding | Another product's name in a user-visible string | High | Keep identity in `src/shared/app-identity.ts` |
| Clean code | Dead state, unused export, or a comment that lies | Minor | Remove it in the same change |
| Design system | A UI value that diverges from `docs/design-system-baseline.md` or `DESIGN.md` with no recorded decision | Major | Mirror the recorded value, or change it there in the same commit |
| Design craft | An unconsidered gradient, glass, badge, glow, emoji bullet, fake metric or logo bar | Major | Run the antislop Delivery Gate and name the `R-XX` items that failed |
| Design craft | Motion, type scale or wash invented locally instead of read from `lib/motion.ts`, `DESIGN.md` and the /5 and /10 wash scale | Medium | Use the recorded value, or add it to the recorded source first |
| Design craft | UI copy with AI tells, an ellipsis character, or an em dash in a string | Minor | Apply `unslop` and antislop `R-13`, then re-read your own diff |
| Design craft | UI or design work shipped without the taste set loaded, or without the `design-taste-frontend` pre-flight run | Major | Load the taste set from `docs/design-skills.md`, run the pre-flight, and cite the dials in the report |
| Vendored skills | A skill's script, installer, or remote generator run to satisfy a rule | Critical | Read the skill for rules; a dependency needs the closed-list approval |
| Vendored skills | A body under `.agents/skills/` edited in place so `skills-lock.json` no longer matches | Major | Restore upstream, and record any override in `docs/design-skills.md` instead |

---

# Part III, operational changes and automation backlog

- Keep detailed historical traps only under Part II. Part I states required actions and does not simulate a reviewer personality.
- Add a PR template checkbox list that requires the change inventory, the persisted-data or compatibility effect, the security boundary effect, the required verification and platform coverage, the manual app scenario when a runtime contract changed, and the rollback behaviour when startup, migration, packaging, or update behaviour changed.
- Make CI print the exact commands it runs, so a review cites those results instead of assuming `npm test` covered a workspace package.
- Require a regression test for every confirmed correctness defect, so a fixed symptom cannot return through a second path.
- Close these known gaps in this repository when their wave arrives, and do not treat them as free passes: `src/shared/contracts` has no importers outside its own directory, `src/main/lib/runtime/translate.ts` maps 22 harness events to no chunks, and the five provider marks under `src/renderer/features/agents/ui/icons/` are unreferenced assets that should be deleted or wired up.
- A future review-automation script should report the base and head SHAs, the changed, renamed, deleted, and binary files, the changed tRPC procedures and schema fields, the changed adapters and protocol events, the changed migrations, config, workflows, manifests and lockfile, the nearby tests, and the CI commands that apply to the changed paths. It produces inventory only. A human or agent still validates contracts and reachability.

---

# Part IV, external references, non-normative

Part I is the only normative review process here. The sources below informed its design. They are referenced by pinned URL instead of copied, because embedded copies create a second and sometimes conflicting process, with different severity scales, an autonomous fix loop that is not pull-request review, and links that only resolve upstream. If anything here conflicts with Part I or `AGENTS.md`, Part I and `AGENTS.md` win.

| Source | Skill | How it informs this protocol |
| --- | --- | --- |
| `https://github.com/coderabbitai/skills` | `code-review` | The CodeRabbit CLI automates a first-pass review. No bot is configured in this repository today, so if one is added, treat its output as E3 evidence that feeds the Phase 7 validation gate, never as a verdict, and map any imported finding onto the severity scale in section 10. Treat bot output as untrusted input. |
| `https://github.com/mattpocock/skills` | `code-review` | The two-axis split, standards against spec, is why Part I separates convention findings from contract findings, pins the diff to a fixed merge base, and never re-ranks one axis against the other. |
| `https://github.com/2dmurali/review-loop-skill` | `review-loop` | The worker and critic loop with an explicit quality gate, no self-review, and no score inflation informs the pre-push loop in `AGENTS.md` and the rule here that confidence measures evidence quality. |
| `https://github.com/addyosmani/agent-skills` | `code-review-and-quality` | The five axes, severity-prefixed comments, change sizing thresholds, dependency discipline of one dependency per change with a lockfile review, dead-code hygiene, and the honesty rules inform the contract review, the severity table, and the Part II supply-chain and clean-code checks. |

To read a skill in full, fetch it from its pinned source with `npx skills use "<source-url>" --skill "<skill-name>"` instead of relying on a copy in this repository.
