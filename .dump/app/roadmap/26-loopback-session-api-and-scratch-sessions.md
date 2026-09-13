## 0. Meta

| Field | Value |
| --- | --- |
| Step | 26 of 35, wave W8 |
| Area | main, renderer, db |
| Risk | critical, it opens a listening socket |
| Depends on | {{S07}}, {{S10}}, {{S11}}, {{S24}} |
| Blocks | {{S27}}, {{S33}} |
| Estimate | medium |

## 1. Outcome

A loopback HTTP API that creates and lists sessions from outside the app, off by default and token-gated, plus scratch sessions that need no repository and can later be promoted into one.

## 2. Why it matters

Triage row 13 accepted the sessions API as a local, opt-in, token-gated surface, and row 14 reinterpreted repoless sessions as scratch work that promotes into a project after the fact. The second half matters more than the first: `chats.create` requires a `projectId`, verified this session at `src/main/lib/trpc/routers/chats.ts:427-458`, so today there is no honest way to start a thought with no repository.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| `create` requires `projectId`, takes `initialMessageParts` including `data-image`, and defaults `useWorktree` to true | `src/main/lib/trpc/routers/chats.ts:427-460`, `:458` for the flag, `:528-529` for the branch | E1, this session |
| Worktree creation is conditional, so a no-worktree path already exists | same router at `:528` | E1, this session |
| The app already binds one loopback server for auth callbacks, on a fixed port, with redacted logging | `src/main/index.ts:285`, `AUTH_SERVER_PORT`, and the `code?.slice(0, 8)` log line at `:298` | E1, this session |
| Local-only is the promise, and there is no control plane | `CONTRIBUTING.md` local-only section, `src/shared/local-only.ts` | E1, this session |
| Run records are what an external caller would poll | step 07 | by contract |

## 4. Read first, and what already exists

`FULL-REVIEW.md` §6.2 and §6.3, the process-authority and filesystem-authority sections, because this step adds an input path that reaches main from outside the renderer. `src/main/lib/trpc/routers/` owns every mutation, so the API is a thin translation layer, never a second implementation of create.

## 6. Implementation plan

1. Decide the bind in writing, in the PR and in `.dump`: a separate port from the auth server, loopback only, no `0.0.0.0` under any circumstance, and a port file written to `~/.mauscode/` so a CLI or script can find it without a fixed number colliding.
2. Disabled by default, one settings switch, and a token generated on enable, stored through the step 11 owner, shown once, revocable.
3. Routes, all of them delegating to existing procedures: `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `GET /sessions/:id/events?cursor=`, `POST /sessions/:id/messages`, `POST /sessions/:id/cancel`, `GET /sessions/:id/changeset`.
4. Auth middleware: constant-time token compare, a per-token origin allow-list defaulting to loopback, a rate limit, and a body cap. Return `401` without leaking whether a path exists.
5. Scratch sessions: make `projectId` optional with an explicit `scratch` flag, keep `useWorktree` false for scratch, and store the working directory as a per-session scratch path under `~/.mauscode/scratch/<id>`.
6. Promote: move the scratch tree into a new or chosen project worktree with `git apply` of the recorded change set, keep the run history, and show a file list first so the user sees what moves.
7. Deletion: promote leaves nothing behind unless the user asks, and a scratch session's directory is removed on delete, in `finally` per the subprocess rule.
8. Tests: token failure paths, the loopback-only bind asserted by connecting from a non-loopback address in a fixture, the changeset route returning step 14's shape, scratch create and promote on a temp repository, and a cursor replay across a restart.

## 7. Contracts this changes

| Contract | Before | After |
| --- | --- | --- |
| tRPC `chats.create` | `projectId` required | optional with an explicit scratch flag |
| Persistence | sessions always project-bound | scratch sessions with their own directory |
| Network | one loopback server for auth callbacks | plus an opt-in session API on its own port |

## 8. Boundaries

- Always: off by default, loopback bind, token required, body capped, everything through the existing procedures, and no secret in a URL.
- Ask first: any non-loopback bind, any CORS allowance, and any endpoint that can delete a project's files.
- Never: an unauthenticated read of run content, a token in a query string, a permissive default so a demo works, or a new mutation implemented at the HTTP layer.

## 10. Acceptance criteria

- [ ] With the switch off, no socket is bound, proven by a test that reads the port file and expects nothing.
- [ ] A request without a token, with a wrong token, and from a non-allowlisted origin all fail the same way, with identical bodies.
- [ ] `POST /sessions` with no repository creates a working scratch session that runs a turn.
- [ ] Promote moves exactly the files in the change set, and the run history is intact afterwards.
- [ ] `GET /sessions/:id/events?cursor=` replays what a reload would have shown, using step 07's sequence.
- [ ] Deleting a scratch session removes its directory, tested on a temp home.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
```

Manual: `curl` a create and a changeset against the running dev app, and confirm the token is required by pasting the request with it stripped.

## 12. Benchmark record

Per-request latency for `GET /sessions/:id` against a long transcript, in `.dump/app/benchmarks/`.

## 13. Rollback

The switch is the rollback. Reverting the commit removes the routes, and the scratch rows keep their project id absent, which the old code must tolerate, so land the schema tolerance first if you split this.

## 14. Out of scope

Auth, plan limits and concurrency metering, rejected in triage row 18. A CLI client, rejected in rows 19 and 20. `git apply` from a CLI, deferred in row 21 to this step shipping a parsable change set, which step 14 already gives it.

## 15. Handoff notes

Record the port and token model, the route list and the promote semantics in `.dump/app/plans/2026-09-13-sessions-api.md`. The placement work in {{S34}} reads this file and reuses the registry idea, so write the shape you actually shipped.
