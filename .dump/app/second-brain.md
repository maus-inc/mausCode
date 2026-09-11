# Second Brain - App

Index for the app capability. Start here.

## Audits

- `audits/security-ipc-boundary.md` — what the renderer can make the Electron
  main process do. Documents the theme path traversal, the auth token proxy,
  the IPC channel naming, and the tool subtitle XSS, with the fix and the
  verification for each.

## Architecture notes worth carrying forward

The repository already contains the right security model, written at the top of
`src/main/lib/git/security/path-validation.ts`, and a correct path containment
implementation in `secure-fs.ts`. It was private to one module, so a second
call site reinvented it incorrectly. That is the pattern to watch for: the
correct code exists but is not reachable, and the duplicate is worse than the
original.

`src/renderer/features/agents/main/active-chat.tsx` is over 7800 lines and
`src/renderer/features/sidebar/agents-sidebar.tsx` over 3500, and between them
they hold most of the cognitive complexity and dead prop findings. They are
also the components that would have to be rewired onto the mausCode runtime
protocol, so splitting them is on the critical path for the runtime work, not
just for the linter.
