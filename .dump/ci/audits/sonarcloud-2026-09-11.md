# SonarCloud issue catalog, 2026-09-11

Source: `https://sonarcloud.io/api/issues/search?componentKeys=maus-inc_mauscode`.
Analysis id `0c68c88b-b4cd-42be-a02d-f73db699c6cc`, last updated 2026-09-11T11:57:24Z.
All numbers below come from that API, not from the web UI.

## Totals

| Metric | Value |
| --- | --- |
| Open issues | 1836 |
| Remediation effort | 12705 minutes (211 hours) |
| Lines of code | 128867 |
| Duplicated lines density | 12.5% |
| Coverage | not reported |
| Security hotspots | 0 |

Ratings: security E, reliability D, maintainability A.

## Split by software quality

| Quality | Count |
| --- | --- |
| Maintainability | 1673 |
| Reliability | 307 |
| Security | 46 |

## Split by impact severity

| Severity | Count |
| --- | --- |
| Blocker | 2 |
| High | 232 |
| Medium | 821 |
| Low | 930 |
| Info | 8 |

## Split by language

TypeScript 1794, JavaScript 33, HTML 5, CSS 2, PL/SQL 1, Shell 1.

## Top directories by issue count

`src/renderer/features/agents/ui` 271, `src/renderer/features/agents/main` 195,
`src/renderer/features/agents/mentions` 117,
`src/renderer/components/dialogs/settings-tabs` 106,
`src/renderer/features/sidebar` 90, `src/main/lib/trpc/routers` 88,
`src/renderer/components/ui` 80, `src/renderer/components` 59,
`src/renderer/features/file-viewer/components` 53,
`src/renderer/features/details-sidebar/sections` 52, `src/main/lib` 50,
`src/renderer/icons` 50, `src/main/lib/git` 45,
`src/renderer/features/terminal` 45, `scripts` 29.

The renderer holds most of the debt. `src/renderer/features/agents/ui` and
`src/renderer/features/agents/main` alone account for 466 issues, a quarter of
the project total.

## Rule frequency

Counts are open issues per rule.

| Rule | Count | What it reports |
| --- | --- | --- |
| typescript:S6759 | 258 | Props that are never read |
| typescript:S3358 | 195 | Nested ternary expressions |
| typescript:S3776 | 172 | Cognitive complexity over 15 |
| typescript:S1854 | 95 | Dead stores, assigned then never read |
| typescript:S1128 | 93 | Unused imports |
| typescript:S6848 | 73 | Non-interactive element given a role or handler |
| typescript:S1082 | 70 | Mouse-only event handler, no keyboard path |
| typescript:S7772 | 66 | React hook rules |
| typescript:S7773 | 55 | React hook rules |
| typescript:S6582 | 53 | Optional chain where the value is already known present |
| typescript:S6767 | 52 | Deprecated React lifecycle or legacy API |
| typescript:S6478 | 44 | `React.memo` without a comparator or with unstable props |
| typescript:S6479 | 39 | Array literal as a JSX key or unstable dependency |
| typescript:S6594 | 32 | String conversion that can use a template literal |
| typescript:S3863 | 30 | Identical branches in a conditional |
| typescript:S7781 | 25 | React hook rules |
| typescript:S7761 | 24 | React hook rules |
| typescript:S2933 | 23 | `readonly` property reassigned |
| typescript:S7755 | 20 | React hook rules |
| typescript:S1874 | 18 | Deprecated API in use |
| typescript:S2245 | 17 | `Math.random()` in a security context |
| typescript:S7780 | 17 | React hook rules |
| typescript:S6819 | 17 | ARIA role on an element that already implies it |
| typescript:S6535 | 16 | Regex that can be simplified |
| typescript:S8786 | 15 | Deprecated React API |
| typescript:S4144 | 14 | Two functions with the same implementation |
| typescript:S2486 | 12 | Empty catch block |
| typescript:S6324 | 9 | Regex with a redundant character class |
| typescript:S2871 | 8 | `Array.sort()` without a comparator |
| typescript:S1135 | 8 | TODO comment |

The long tail below 8 per rule contains 40 further rules, including every
taint-analysis rule.

## The two blocker issues

Both are open, both were fixed on this branch.

`src/main/lib/claude-config.ts:189`, typescript:S3516, maintainability blocker.
`removeMcpServerConfig` returned `config` on both exit paths. The function
mutated its argument and always handed back the same reference, so a caller
could not tell a successful removal from a no-op.

`src/main/lib/vscode-theme-scanner.ts:233`, tssecurity:S2083, security blocker.
The `vscode:load-theme` IPC handler accepted a path from the renderer and
checked it with

```js
normalizedPath.startsWith(normalizedAllowed + path.sep) ||
normalizedPath.startsWith(normalizedAllowed)
```

The second operand defeats the first. `~/.vscode/extensionsEVIL/theme.json`
satisfies `startsWith("~/.vscode/extensions")`, so any sibling directory whose
name begins with `extensions` was readable. `path.normalize` also resolves
nothing on disk, so a symlink inside the real extensions directory pointed
anywhere. The main process then read the file and returned its contents over
IPC.

## Security issues, 46 total

Eleven are taint findings, where the analyzer traces a value from a renderer
IPC call to a dangerous operation. Every one of them has the same source:
"a compromised renderer can send arbitrary IPC messages to the main process".

| Rule | Impact | Location | Sink |
| --- | --- | --- | --- |
| tssecurity:S2083 | Blocker | `src/main/lib/vscode-theme-scanner.ts:233` | `fs.readFile` on a renderer-supplied path |
| tssecurity:S8476 | High | `src/main/windows/main.ts:431` | `fetch` of a renderer-supplied URL with the auth token attached |
| tssecurity:S8387 | High | `src/main/windows/main.ts:513` | IPC channel name built from `streamId` |
| tssecurity:S8387 | High | `src/main/windows/main.ts:517` | IPC channel name built from `streamId` |
| tssecurity:S5144 | Medium | `src/main/windows/main.ts:431` | Server-side request to a renderer-supplied URL |

The remaining 35 are hotspot-style findings that need a human decision rather
than a trace:

- `Math.random()` used to build identifiers, typescript:S2245, 17 issues. In
  `src/main` these are `src/main/lib/db/utils.ts:6`,
  `src/main/lib/claude/transform.ts:54`,
  `src/main/lib/trpc/routers/chats.ts:788`,
  `src/main/lib/vscode-theme-scanner.ts:258`. None of them is a token or a
  secret, so the risk is identifier collision, not disclosure. The 13 renderer
  hits are React keys and animation jitter.
- `PATH` read from the environment before spawning a process, typescript:S4036
  and javascript:S4036, 5 issues. Relevant ones are
  `src/main/lib/trpc/routers/external.ts:101` and
  `scripts/download-codex-binary.mjs:199`.
- Publicly writable temp directory, typescript:S5443, 3 issues.
  `src/main/lib/git/sandbox-import.ts:235,286,314` build predictable filenames
  (`sandbox-import-${Date.now()}.bundle`) in `os.tmpdir()`. A local user can
  win the race and pre-create the file. `src/main/lib/git/stash.ts:38` uses
  `mkdtemp` and is safe.
- `chmod 0o755` on a downloaded binary, javascript:S2612, 2 issues,
  `scripts/download-claude-binary.mjs:208` and
  `scripts/download-codex-binary.mjs:329`.
- Missing `strict-transport-security` header, typescript:S5148, 2 issues. The
  app runs an OAuth callback server on `127.0.0.1` (port 21321, or 21322 in
  dev), so HSTS is not meaningful there. These need review and a documented
  resolution, not a code change.
- `postMessage` without an origin check, typescript:S2819, 1 issue.

## Reliability issues, 307 total

Ten carry high or blocker impact.

| Rule | Location | Problem |
| --- | --- | --- |
| typescript:S2871 | `src/renderer/features/kanban/kanban-view.tsx:165,166` | `Array.sort()` with no comparator |
| typescript:S2871 | `src/main/lib/terminal/port-scanner.ts:48` | `pids.sort()` on numbers, and it mutates the caller's array |
| typescript:S2871 | `src/renderer/features/agents/lib/drafts.ts:251,255` | `Array.sort()` with no comparator |
| typescript:S2871 | `src/renderer/features/sidebar/agents-sidebar.tsx:1913,1914` | `Array.sort()` with no comparator |
| typescript:S7059 | `src/main/lib/git/watcher/git-watcher.ts:97` | Async work started from a constructor |
| shelldre:S7688 | `scripts/sync-to-public.sh:31` | `[` used where `[[` was intended |

The S2871 hits are not all cosmetic. `port-scanner.ts:48` sorted numbers
lexicographically and sorted the array the caller still holds, so
`panePortMap` in `src/main/lib/terminal/port-manager.ts:102` kept a reordered
`pids` array after every poll. The string cases only needed an explicit
comparator to record that the sort exists to canonicalise a set comparison.

The remaining 297 reliability issues are medium (64%) and low (33%) impact.

## Maintainability issues, 1673 total

Dominated by four rules: S6759 unused props (258), S3358 nested ternaries
(195), S3776 cognitive complexity (172), S1854 dead stores (95). Together they
are 720 issues, 43% of the project total and 43% of the maintainability
bucket.

S3776 concentrates in the largest files. `src/renderer/features/agents/main/active-chat.tsx`
is over 7800 lines and `src/renderer/features/sidebar/agents-sidebar.tsx` over
3500. Both are single components. No amount of local refactoring reduces their
complexity scores without splitting them, and splitting them is a project, not
a cleanup pass.

## What this catalog does not cover

Coverage is not reported to SonarCloud, so there is no denominator for any of
this. The project has no test runner and no CI workflow, which is why the
number is absent rather than zero.

## Provenance: the analyzed commit matches this tree

Both analyzers ran against `origin/main` at `9f1bc76` ("Release v0.0.72"), which
is the commit DeepSource names as its last analysis. This branch is based on
`19666d0`, a sibling commit rather than a descendant.

`git diff --name-only origin/main 19666d0` lists 30 files and none of them are
under `src/`, `scripts/`, or `package.json`. The only differences are `.dump/`,
`.agents/skills/unslop/SKILL.md`, and the `new mauscode branding/` folder.
Source is byte-identical between the analyzed commit and this tree, so every
line number in this catalog maps directly onto the working copy.
