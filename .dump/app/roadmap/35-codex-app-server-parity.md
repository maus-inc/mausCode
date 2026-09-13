## 0. Meta

| Field | Value |
| --- | --- |
| Step | 35 of 35, the follow-up the phase 5 spike recommended |
| Area | main, deps |
| Risk | high |
| Depends on | {{S12}} |
| Blocks | nothing, it is verification of a shipped port |
| Estimate | small to medium |

## 1. Outcome

The Codex adapter is proven against the CLI version this repository actually ships: the generated protocol schema matches the pinned binary, the parity checklist has a verdict per row, and the `effect` pins are exact after the bump.

## 2. Why it matters

The port is real, not planned, and the record in the roadmap has to say so. `src/main/lib/codex-app-server/` holds the ported T3 client with `session.ts` at 479 lines and mock-peer tests, and `src/main/lib/trpc/routers/codex.ts:7-9` states the legacy ACP path was removed, with `app-server` spawned at `:1233`, all verified this session. What is unproven is drift: the schema was generated from upstream `678157ac` on 2026-07-19, a regeneration attempt on 2026-09-11 failed, and the binary pin here is `0.137.0` while step {{S12}} moves it to `rust-v0.154.0`. Unknown server methods are tolerated by design, so a protocol change does not fail loudly, it quietly does nothing. That is the exact failure mode this step exists to rule out.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The ported client, the boundary rule, and the failed regeneration | `src/main/lib/codex-app-server/README.md`, lines recording `211618f`, `678157ac`, the 2026-09-11 attempt, and `handleUnknownServer*` tolerance | E1, this session |
| Only two trees may import `effect/*` | same README boundary rule, plus `.dump/app/decisions/effect-adoption-t3-layers-2026-09-11.md` | E1 |
| `@zed-industries/codex-acp` is gone from the manifest while `@mcpc-tech/acp-ai-provider` remains, used by the gemini and hermes routers only | `package.json` dependencies, `src/main/lib/trpc/routers/gemini.ts`, `src/main/lib/trpc/routers/hermes.ts` | E3, this session |
| A shared tool normaliser now serves ten routers, so it is not an ACP leftover and must not be deleted by mistake | `src/shared/codex-tool-normalizer.ts`, imported by `codex`, `cline`, `cursor`, `grok`, `hermes`, `openclaw`, `opencode`, `qwen`, `roo` routers | E3, this session |
| The chunk coalescer is still in the Codex path | `codex.ts:22`, `:1595` | E1, this session |
| Pin state: `effect` exact at `4.0.0-rc.112`, `@pierre/diffs` exact at `1.0.10`, SDK exact at `0.2.45` | `package.json` | E1, this session |

## 4. Read first, and what already exists

`docs/backend-porting-recipe.md` §0 and §7, and the port log in the adapter README, which already lists the regeneration procedure and why `scripts/generate.ts` was deliberately not ported. Read the spike in `.dump/app/research/phase5-codex-app-server-spike.md` for the gates the author set, which are the checklist this step completes.

## 6. Implementation plan

1. Run `bun run codex:download` for the pinned version, then `codex app-server --help` style probes, and record the CLI version against the schema generation ref. Version mismatch is the finding, not an error to route around.
2. Work the parity list with a verdict each: streaming deltas, MCP tools, reasoning effort, login, usage polling, cancel, resume. Each row says how it was verified, with the command or the test name.
3. Decide the drift question explicitly: absorb it through unknown-method tolerance, regenerate the schema, or pin the CLI to the version the schema was generated from. Record the choice and the reason in the port log, and prefer the narrowest option that keeps the two in step.
4. After the step {{S12}} bump, re-verify every `@effect/*` pin resolves exact with no caret escaping, and re-run the mock-peer suite, since the transitive drift the decision record documents is what broke suites before.
5. Add a version-pair assertion: one test that fails when the bundled CLI version and the schema ref are further apart than the recorded allowance, so the drift becomes a red run rather than a silent no-op.
6. Leave the coalescer in place unless a measured reason exists to remove it, and say what you found either way. Do not delete shared behaviour that ten routers depend on.

## 8. Boundaries

- Always: verbatim stays verbatim, attribution headers stay, and the port log is updated in the same commit.
- Ask first: any change to what the adapter approves automatically, since `turn/start` carries approval handlers and step 10 owns the floor.
- Never: hand-edit `schema.gen.ts`, widen `effect` to a range, add a third `effect`-importing tree, or remove the tool normaliser because one router no longer needs it.

## 10. Acceptance criteria

- [ ] Each of the seven parity rows has a verdict and a named verification.
- [ ] The pinned CLI version and the schema ref pair is recorded in the README, and a test enforces the allowance.
- [ ] `npm run test:contracts` and the adapter's own suites are green on the new pins, with the counts reported.
- [ ] `grep -n '"' package.json | grep effect` shows only exact pins, and the PR names every `@effect/*` version resolved.
- [ ] `.dump/app/research/phase5-codex-app-server-spike.md` carries a verdict line pointing at this step's outcome, so the spike is not re-run.

## 11. Verification

```sh
bun run codex:download
npm run test && npm run test:contracts && npm run typecheck && bun x biome check .
node scripts/ci/typecheck-ratchet.mjs
```

## 12. Benchmark record

Time to first chunk on a Codex turn before and after the pin move, and app-server spawn cost, in `.dump/app/benchmarks/`.

## 13. Rollback

Version pair moves as a unit with the lockfile, so revert the pins together. The port itself is not reverted; it is what the router already depends on.

## 14. Out of scope

Any OAuth provisioning through the runtime, which the spike keeps WONTFIX, and the other nine providers' parity, which their own adoption records own.

## 15. Handoff notes

Update the adapter README's port log with the new ref pair and what was absorbed by tolerance, and mark this step in `.dump/app/plans/2026-09-13-mauscode-roadmap.md` as verification rather than feature work, so a later reader does not look for a feature that already shipped.
