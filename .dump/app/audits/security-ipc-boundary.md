# Main process IPC boundary audit

Scope: values the renderer sends to the Electron main process, and what the
main process then does with them. Date 2026-09-11.

## The threat model the repository already states

`src/main/lib/git/security/path-validation.ts` opens with an explicit model:
"a compromised renderer can execute commands via terminal panes". That file
names `assertRegisteredWorktree()` as the primary boundary and
`validateRelativePath()` as defence in depth, and `secure-fs.ts` implements a
correct containment test with `path.relative()`.

The model is right. The problem is that only the file viewer follows it. Three
other main-process entry points took renderer input and acted on it with
weaker checks, and SonarCloud's taint analyzer found all three.

## Fixed: theme path traversal

`src/main/lib/vscode-theme-scanner.ts`, IPC channel `vscode:load-theme`.

The old check was

```js
const normalizedPath = path.normalize(themePath)
const isAllowedPath = EXTENSION_PATHS.some(({ path: allowedDir }) => {
  const normalizedAllowed = path.normalize(allowedDir)
  // Ensure we check with path separator to avoid partial matches
  return normalizedPath.startsWith(normalizedAllowed + path.sep) ||
         normalizedPath.startsWith(normalizedAllowed)
})
```

The comment says the separator check avoids partial matches and then the very
next operand reintroduces the partial match. `~/.vscode/extensionsEVIL/x.json`
passes. `path.normalize` is also purely lexical, so it collapses `..` in the
string while resolving nothing on disk, and a symlink inside the real
extensions directory could point at `~/.ssh/id_rsa`. The handler then read the
file and returned its parsed contents to the renderer.

Fix, in three parts:

1. `src/main/lib/security/path-containment.ts` now holds the `path.relative()`
   containment test that `secure-fs.ts` already had as a private function.
   `secure-fs.ts` imports it, and two further inline copies of the same escape
   test inside `secure-fs.ts` were collapsed onto it. One implementation, four
   fewer copies.
2. The handler canonicalises first with `fs.realpath(path.resolve(themePath))`,
   then tests the real path against realpath-resolved extension roots.
   Canonicalising after validating is what let a symlink escape.
3. `themePath` is typed `unknown` and rejected unless it is a non-empty string.

The roots are resolved per call rather than cached. That is four `realpath`
syscalls on an explicit user action, and caching them would go stale when an
editor is installed or removed.

## Fixed: auth token sent to an arbitrary origin

`src/main/windows/main.ts`, IPC channel `api:signed-fetch`.

The handler took `url` from the renderer, attached `X-Desktop-Token` from
`getAuthManager().getValidToken()`, and fetched it. Any origin was accepted.
A compromised renderer, or XSS anywhere in the renderer, could point the proxy
at `https://attacker.example/` and receive the user's desktop auth token in the
request headers. The same handler is the transport for the whole remote tRPC
client, so it is on the hot path for every authenticated call.

The handler also logged the full URL at `console.log` on every call, which puts
query strings into the main process log. Removed.

Fix: `isSameApiOrigin(url, getBaseUrl())` in
`src/main/lib/security/ipc-guards.ts`. It compares `URL.origin`, so subdomains
and lookalike hosts such as `https://21st.dev.evil.example` are rejected. All
existing callers build their URLs from `window.desktopApi.getApiBaseUrl()`,
which is the same `getBaseUrl()`, so no legitimate call changes behaviour.

## Fixed: IPC channel names built from renderer input

`src/main/windows/main.ts`, IPC channel `api:stream-fetch`, two findings.

`streamId` arrived from the renderer and was interpolated into
`` `stream:${streamId}:chunk` ``, `:done`, and `:error` channel names. The
renderer that opened the stream is the one listening, so the practical impact is
limited, but an id containing `:` could name another channel. `isSafeIpcToken`
restricts ids to `[A-Za-z0-9_-]{1,64}`, which matches what
`remote-chat-transport.ts` generates (`stream_<timestamp>_<base36>`). The same
handler now validates its URL with `isSameApiOrigin`.

## Fixed: XSS through tool subtitles

Not a SonarCloud taint finding, found through DeepSource `JS-0440`. Documented
in `.dump/ci/audits/deepsource-2026-09-11.md`.

`AgentToolCall` rendered `subtitle` with `dangerouslySetInnerHTML`. Subtitles
are built in `agent-tool-registry.tsx` from `part.input.description`,
`part.input.pattern`, `part.input.path`, and `part.input.target_directory`, all
of which originate in the model's tool call or in a repository the model is
reading. Only `tool-Edit` ever produced markup, for its `+N -N` counts.

`AgentToolCall` now renders `subtitle` as text and takes a typed
`diffStats?: { added: number; removed: number }` prop for the Edit counts.
Keeping `diffStats` structured rather than a `ReactNode` matters here because
`AgentToolCall` is wrapped in `memo`, and a fresh element on every render would
defeat the comparison for every Edit row in a streaming message list.

`src/renderer/components/mermaid-block.tsx` moved from
`securityLevel: "loose"` to `"strict"`, because Mermaid diagram source is
agent-authored and `loose` permits raw HTML labels and click bindings.

## Verified

`src/main/lib/security/security.test.ts`, 10 cases, `npm test`, all pass.

The path containment test asserts both sides of the regression: it records that
the old prefix logic accepted `~/.vscode/extensionsEVIL/theme.json` and that
`isPathWithinRoot` rejects it. Reintroducing the prefix match into
`isPathWithinRoot` makes that one case fail and the other nine pass, which is
the mutation check that the test exercises the shipped function rather than a
copy of it.

`npm run ts:check` reports 110 errors before and after, and the set of
file-plus-message pairs is identical, so no change here introduced a type error.

## Fixed after the first pass

`src/main/lib/git/sandbox-import.ts` wrote the git bundle and two patch files to
`os.tmpdir()` under names built from `Date.now()`. Any local user could
pre-create them and substitute contents that `git fetch`, `git apply --cached`,
and `git apply` would then consume. `applySandboxGitState` now creates one
`mkdtemp` scratch directory for the whole import, writes `export.bundle`,
`staged.patch`, and `unstaged.patch` inside it, and removes the directory in a
`finally`. That follows the pattern `src/main/lib/git/stash.ts:38` already used
and drops three per-file `unlink` calls that the directory removal now covers.

`src/renderer/features/agents/ui/agent-preview.tsx` handles `message` events
from the preview iframe. It already checked `event.source` against the iframe's
`contentWindow`, which identifies the sender more precisely than an origin
check, so SonarCloud's S2819 is not a live vulnerability. The handler still
accepted any `event.data.url` and put it in the URL bar and in localStorage, so
it now requires a string starting with `/`.

## Still open in this area

- The remaining `ipcMain.handle` registrations in `src/main/windows/main.ts` and
  the tRPC routers have not been audited against the renderer-untrusted model.
  Three handlers were wrong out of the ones checked, so the base rate is not
  reassuring.
- The agent permission model has not been re-audited since the fork.
