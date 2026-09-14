# Backend porting recipe: add any CLI/agent/SDK as a mausCode backend

A recreatable, deeply customizable cookbook. Follow top to bottom; every step
has acceptance checks. Worked examples: `src/main/lib/codex-app-server/`
(native JSON-RPC over stdio) + router `src/main/lib/trpc/routers/codex.ts`,
and `src/main/lib/opencode/` (local HTTP + SSE).

## 0. Principles (non-negotiable)

- The renderer is never modified for a backend change. It speaks only the
  shared chunk dialect + capability schema in `src/shared/`.
- Upstream code is ported verbatim + attribution header, or not at all.
  All mausCode behavior lives in adapters marked NOT verbatim.
- No silent capability widening: approvals, sandbox, egress, and auth are
  reported in the capability manifest exactly as configured.
- No credentials stored: adapters probe/detect auth state; app-managed keys
  travel via env only.
- Every backend ships with a mock + tests proving the lifecycle without the
  real binary (binaries never exist in CI/sandbox).

## 1. Recon the target (research before code)

1. Identify the integration rung (see landscape doc ladder): native SDK >
   serve/API+events > headless structured CLI > ACP > raw API > PTY.
2. Record, with primary-source links: spawn command + args, auth setup +
   state location, session create/resume/ids, message send (sync/async),
   event/stream format, cancel/abort, permission/approval hooks, MCP story,
   model selection, image/file attachments, usage/cost surfaces, licenses.
3. Check for deal-breakers: interactive-only (PTY rung — flag it), singleton
   daemon, config-file races under parallel instances, proprietary binary
   (PATH-only, never bundled).
4. Write the findings into `.dump/app/backend-landscape-<date>.md` (newest
   file wins; never edit old ones).

Accept: a strategy row stating rung + protocol + resume identity + cancel
path + the top 3 gotchas.

## 2. Scaffold

```
src/main/lib/<backend>/session.ts        # adapter (ours, NOT verbatim)
src/main/lib/<backend>/session.test.ts   # lifecycle tests vs mock
src/main/lib/<backend>/test/fixtures/<backend>-mock-peer.*  # mock
src/main/lib/<backend>/README.md         # port log + protocol notes
src/main/lib/trpc/routers/<backend>.ts   # tRPC surface (mirror codex.ts)
src/main/lib/providers/<backend>.ts      # capability profile + probe
```

If porting upstream client code (SDK too heavy, or generated client):
`src/main/lib/<backend>/src/` verbatim + headers, and a harvest ref
(`refs/harvest/<name>`) + entry in the upstream policy doc. Otherwise depend
on the official SDK (exact pin, like `@anthropic-ai/claude-agent-sdk`).

Accept: `git status` shows only the new files; no shared file touched yet.

## 3. Session module

- One native child process / server / client per chat session; own lifecycle
  scope; `dispose()` kills the child (layer finalizer) AND calls the native
  kill API as fallback, then releases the scope. `dispose()` is idempotent.
- `setOnChunk()` rebinds the chunk sink: sessions outlive runs (reuse across
  turns), sinks are per-run. Forgetting this breaks every second turn.
- Single in-flight turn per session (assert or serialize; never overlap).
- Resume: `existingNativeId` first; legacy-id lookup second (e.g. list +
  match); fresh start third. Each step falls back with a logged warning.
- Cancel maps to the native abort (`turn/interrupt`, `POST abort`,
  `AbortController`, `SIGTERM`); cancel-before-start must short-circuit, not
  run the turn anyway.
- Temp artifacts (image stage files, config overlays, ports) are created per
  turn and removed in `finally` (best effort, never fail the turn).

Accept: create → turn → chunks → result → interrupt → dispose, all without
the real binary (mock), with zero leaked processes/ports/files.

## 4. Event→chunk mapping (the shared dialect)

Emit exactly these chunk shapes (see codex `session.ts` for reference):

- Text: `{type:"text-start",id}` → `{type:"text-delta",id,delta}*` →
  `{type:"text-end",id}`. text-start MUST precede the first delta for an id.
- Tools: `{type:"tool-input-start",toolCallId,toolName}` →
  `{type:"tool-input-available",toolCallId,toolName,input}` →
  `{type:"tool-output-available",toolCallId,output}`.
- Terminal: `{type:"error",errorText}` (mapped through the router's error
  classifier), `{type:"finish"}` exactly once per run, `{type:"message-
  metadata",messageMetadata}` for usage + run metadata.
- Tool naming: `Bash`, `Edit`, `WebSearch`, `Thinking` (reasoning),
  `mcp__<server>__<tool>` for MCP tools, native names otherwise.
- Plan/summary/unsupported items: emit as text trios or skip (document the
  choice); never emit unknown chunk types.
- Transient errors (retry scheduled upstream): log + wait, do NOT emit error
  chunks or settle the turn.

Accept: the accumulated parts match what the ACP/AI-SDK path would persist
(text parts + `tool-<Name>` parts with `state:"result"`).

## 5. Server-request / permission policy

Catalog every inbound request the backend can make and fix a default answer:

- Approvals (exec/edit/permissions/legacy): auto-grant session-wide (parity
  with the ACP path) using each method's OWN literals (they differ per
  method — let tsc verify, never cast).
- User-input prompts: answer with first options (+`"ok"` fallback).
- Elicitations: decline. Client tool calls: fail (we expose none).
- Token refresh / attestation: fail (the CLI owns that auth, not us).
- Unknown methods: log + fail with the method name (forward-compat).

Accept: tsc verifies every payload/response shape with zero `as never` on
protocol types; the policy is documented in the adapter header.

## 6. Router (tRPC surface contract)

Mirror `codex.ts`. Procedures: `chat` (subscription), `cancel`, `cleanup`,
`getIntegration`, `getAllMcpConfig`/`getMcpConfig`/`refreshMcpConfig` (or
document why native config covers it). Inputs: `subChatId, runId, cwd,
projectPath?, mode, prompt, model, sessionId?, forceNewSession?, images?,
authConfig?`.

- Fingerprint sessions on `(cwd, auth, mcp, effort, model)`; mismatch →
  dispose + respawn. Reuse rebinds the chunk sink.
- Persist: user message immediately (dedup by prompt), assistant message on
  completion with metadata `{model, sessionId, <nativeIds>, durationMs,
  resultSubtype, ...usage}`. `resultSubtype` is `"error"` ONLY on true
  errors (interrupts render without the Failed badge, like sibling routers).
- Usage: prefer native surfaces (session files, stats endpoints); poll
  best-effort, never fail the turn.
- Supersede: a new run for a subChat aborts + disposes the old run's session
  before starting. Cleanup on abort/cancel/stale only — completed runs keep
  the warm session.
- Images: stage to temp files when the protocol wants paths; delete after.

Accept: renderer untouched; old chats resume (or degrade with a warning);
cancel is silent-ish; completion persists exactly one assistant message.

## 7. Capability manifest

Author `src/main/lib/providers/<backend>.ts`: static profile (transport,
auth, sandbox, approvals, egress/retention, streaming, tools, attachments,
resume, models, license, billing) + async `probe()` (binary present?
version? logged in?). Register in `src/main/lib/providers/index.ts`
(`registry.ts` only holds the map + accessors).
The `providers` tRPC router serves profiles + probes + `evaluateViolations`
against policy (local-only etc.) to Settings; chat surfaces only violations.

Accept: profile renders in Settings with zero hardcoded renderer branches.

## 8. Mock + tests

- Mock the transport, not the adapter: stdio JSON-RPC peer (newline or
  Content-Length framed), in-process HTTP+SSE server, or CLI fixture script.
  Mocks live in `test/fixtures/` and are ours (NOT verbatim) unless ported.
- Assert: full turn chunk sequence, resume paths, interrupt result, error +
  transient-error behavior, dispose kills everything, temp cleanup.
- Keep protocol-shape fidelity: mocks must satisfy the real decoders (they
  caught real bugs: tagged-union statuses, required keys).

Accept: `npx vitest run src/main/lib/<backend>` green without any binary.

## 9. Gates + review (every backend, every change)

1. Run the typecheck gate the way CI runs it:
   `node scripts/ci/typecheck-ratchet.mjs`. It compares `tsc --noEmit`
   against `.github/ci-baselines/typecheck.txt`, which is empty, so zero
   errors is the gate. The baseline policy lives in `CONTRIBUTING.md`.
   Locally, `npm run typecheck` and `npm run ts:check` run the two
   typecheckers without the baseline comparison. Never typecheck a config
   that does not exist; verify any `-p` target.
2. `npx vitest run src/main/lib/<backend> src/shared/contracts` — green.
3. `node --test --experimental-strip-types src/main/lib/runtime/*.test.ts`
   — 27/27 (if runtime touched; else still run).
4. Secrets sweep on touched files (key/token patterns; mind false
   positives like `task-list-item`).
5. 3–5 review passes over the new code, then a final line-by-line diff read:
   every line checked for behavior, edge cases, and fidelity to this recipe.
6. Tick the spec tasks, commit, push to the session branch only.

## 10. Upstream tracking

- Harvest ref per ported upstream; port log in the adapter README (ref,
  date, what changed); regen attempts time-boxed with fallback documented.
- Unknown-method tolerance is mandatory for generated clients (drift
  absorption). Breaking upstream changes get an adapter patch + test, never
  a verbatim edit.

## 11. Customization guide (tuning without forking the recipe)

- Models/effort: pass through per-turn when the protocol allows; spawn-time
  `-c` overrides only as session defaults. Never invent `model/effort`
  concat hacks — use native fields.
- Permissions: strictness is a per-backend setting (opencode ask/allow/deny,
  codex approvalPolicy, cursor `--force`); the manifest reports the
  effective posture; policy changes are user-facing → ask the human.
- MCP: prefer the CLI's native config; dynamic injection only when the
  protocol supports it race-free; fingerprint on resolved config so changes
  respawn sessions.
- Timeouts/retries: transport connect (5s), turn watchdog (none by default —
  agents run long), usage polling (bounded, best-effort). Structured-output
  retries stay backend-default.
- Multi-instance: free ports, temp config overlays, per-session servers;
  never a global singleton unless the backend forces it (document + mutex).

## 12. Edge-case catalog (check every item, every backend)

Abort before/during/after turn · run supersede · session reuse sink rebind ·
double error/finish emits · transient vs terminal errors · partial-message
persistence · stale/legacy resume ids · fingerprint mismatch respawn ·
forceNewSession · duplicate-prompt dedup · non-authoritative-run persistence
guard · temp file/dir cleanup on throw · port conflicts + free-port retry ·
binary missing (bundled vs PATH) · auth loops (app-key vs CLI-auth state) ·
Windows paths/exe · asar unpacked binaries · Electron sandbox (no raw
sockets from renderer) · SSE reconnect/backpressure · unknown methods/
notifications/items · schema-decode failures (log + degrade) · large outputs
(coalesce text, cap tool outputs) · concurrent turns (forbid) · dispose
idempotency · process kill fallback · zombie child on crash · clock skew in
usage polling · model id drift (list + validate, fallback default).
