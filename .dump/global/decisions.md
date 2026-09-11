# Decisions

Each entry records what was decided, why, and what would reverse it.

## 2026-09-11

### `ts:check` runs `tsc`, not `tsgo`

The script referenced `tsgo` from `@typescript/native-preview`, which is not a
dependency, so it could not run at all. `typescript` is already a
devDependency and `tsconfig.json` is written for `tsc`. Choosing `tsc` adds no
dependency. Reversing this means adding `@typescript/native-preview` to
devDependencies, which is reasonable later for speed but was not needed to make
the check run.

### The test runner is Node's built-in one, driven by `tsx`

The repository had no tests and no test runner. `tsx` was already in
`node_modules` at 4.23.13 as a transitive dependency of `drizzle-kit`, so
`npm test` uses `tsx --test` with `node:test`. `tsx` is now declared explicitly
in devDependencies rather than relied on by accident. No new package was
downloaded. Reversing this means adopting vitest or bun's runner, which is
fine, but it should be a deliberate choice, not a side effect of adding the
first test.

### Containment checks live in `src/main/lib/security/`

`secure-fs.ts` already had a correct `path.relative()` containment test as a
private function, and `vscode-theme-scanner.ts` hand-rolled a broken
`startsWith` version because it could not reach it. The test moved to
`src/main/lib/security/path-containment.ts` and both call sites import it. The
module sits outside `git/security/` because the theme scanner has nothing to do
with git.

### Renderer IPC input is validated in the main process, not the renderer

Renderer-side validation is advisory. A compromised renderer can call
`ipcRenderer.invoke` directly. Every guard added here lives in the main process
or in a module the main process imports.

### Tool subtitles are plain text

`AgentToolCall` no longer accepts markup in `subtitle`. Rich output goes through
typed props such as `diffStats`. This keeps the component's props primitives so
`memo` still short-circuits, which matters because these rows re-render during
streaming.

### Mermaid runs at `securityLevel: "strict"`

Changed from `"loose"`. Diagram source is agent-authored and can come from
untrusted repositories, and `loose` allows raw HTML labels and click bindings.
The visible cost is that a diagram label containing `<br/>` now shows the
literal text. Flagged in `questions.md` because it changes rendered output.

### `getBaseUrl()` delegates to `getApiUrl()`

`src/main/index.ts` and `src/main/lib/config.ts` contained byte-identical
implementations of the same URL resolution. `getBaseUrl()` now calls
`getApiUrl()`. The name stays because many modules already import it from
`index.ts`.
