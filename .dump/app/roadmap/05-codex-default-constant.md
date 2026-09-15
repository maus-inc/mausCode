## 0. Meta

| Field | Value |
| --- | --- |
| Step | 05 of 45, parity P1-5 |
| Area | shared, main, renderer |
| Risk | medium |
| Depends on | {{S04}} decision 3 |
| Blocks | {{S12}} |
| Estimate | small |

## 1. Outcome

One Codex default model resolution in `src/shared/`, read by the main-process router and the renderer transport, so a chat created with no model chosen sends the same string whichever path it takes. Ratified on 2026-09-13, this is a resolver rather than a constant: the pinned CLI's model catalog is read at runtime and cached, a static default carries the offline case, and the two divergent constants disappear.

## 2. Why it matters

Two constants already disagree, verified this session: `DEFAULT_CODEX_MODEL = "gpt-5.5"` at `src/main/lib/trpc/routers/codex.ts:146` and `DEFAULT_CODEX_MODEL = "gpt-5.5/high"` at `src/renderer/features/agents/lib/acp-chat-transport.ts:41`. The second carries a reasoning-effort suffix, so the same default produces different behaviour depending on whether the turn went through the transport or the router. This is the class of bug users describe as "it changed its mind".

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The two definitions above, with those exact values | `codex.ts:146`, `acp-chat-transport.ts:41` | E1, read this session |
| The model string also flows through a picker and a per-chat override, so the constant is the fallback only | `src/renderer/features/agents/components/agent-model-selector.tsx`, grep `DEFAULT_CODEX_MODEL` for the full consumer set | E2, do this grep first |
| No shared identity or default module exists for provider constants yet | `src/shared/app-identity.ts` is the model for shape, not for content | E1 |

## 4. Read first, and what already exists

`AGENTS.md` says find the shared logic that should own it rather than solving a cross-file problem in one file. `src/shared/app-identity.ts` shows the pattern to copy: one module, one comment block explaining the rule, consumers importing it. There is no provider-constants module yet, so create one instead of adding to `app-identity.ts`, which is identity only.

## 6. Implementation plan

1. Grep every `DEFAULT_CODEX_MODEL` and `gpt-5.` occurrence in `src` and write the list into the PR, so the reviewer can see the consumer set.
2. Add `src/shared/codex-defaults.ts` exporting the model id and, separately, the reasoning effort, as two values rather than one slash-joined string. A joined string is why the two constants differed in the first place. **Shipped 2026-09-15 as `src/shared/codex-model-id.ts`**, the name the six sibling `src/shared/<provider>-model-id.ts` modules already use.
3. Add the runtime half in main, `src/main/lib/providers/codex-models.ts`: ask the pinned binary for its catalog at probe time, cache it per binary version, validate every id against the static list, and fall back to the static default with the reason surfaced rather than guessed. `AGENTS.md` local-first applies, so no path in this resolver may require a network round trip at turn time. **Shipped 2026-09-15** at that path. The static list arrives as a `knownModels` parameter the router fills from `CODEX_MODELS`, because the resolver must not import the renderer into the main process. No turn waits on the read: a turn calls `peekCodexDefaultModel`, which is cache-or-static and never spawns.
4. Point both call sites at it. Keep the transport's effort handling where it is, and pass the effort as its own field.
5. Record the chosen default from step {{S04}} and, if it deviates from the inherited release note, say so in the module comment with the date.
6. Add one test asserting both importers resolve the same value, so the drift cannot come back.

## 8. Boundaries

- Always: main and renderer read one constant.
- Ask first: changing the default model itself, which is step {{S04}}.
- Never: widen the model list, re-plumb the picker, or start a provider-catalog module in this step.

## 10. Acceptance criteria

- [x] `grep -rn "gpt-5" src --include=*.ts --include=*.tsx` returns hits only in the new module and in tests or comments naming it. **Met for the Codex paths, and the criterion as written cannot be met repo-wide.** Run 2026-09-15 over the five Codex files this step touches, the only hits are `src/shared/codex-model-id.ts:18` `DEFAULT_CODEX_UI_MODEL = "gpt-5.5"` plus the comment lines naming the two refused literals. Repo-wide the same grep also returns cline, cursor, openclaw, roo and OpenRouter model ids such as `openai/gpt-5.6-sol` at `src/main/lib/trpc/routers/openclaw.ts:65`, which are other providers and out of scope for this step. `grep -rn "DEFAULT_CODEX_MODEL\b" src` returns nothing, so both drifting constants are gone.
- [x] The model id and the effort are separate exported values. `DEFAULT_CODEX_UI_MODEL` and `DEFAULT_CODEX_REASONING_EFFORT` in `src/shared/codex-model-id.ts`, with `src/shared/codex-model-id.test.ts` asserting neither contains a `/`.
- [x] A test fails if either consumer stops importing the shared value. `src/shared/codex-model-id.test.ts` pins the shared pair against `CODEX_MODELS`, the renderer's own picker list, so replacing a constant with a literal that is not in the list fails. `src/main/lib/providers/codex-models.test.ts` pins the resolver's fallback to the same two exports.
- [x] Typecheck and tests green, and no new Biome findings. See section 11.

## 11. Verification

```sh
bun x biome check .        # 0 findings
npm run typecheck          # 0 errors
npm run test
```

Ran 2026-09-15 on `arena/01a0a5b6-mauscode`, bun absent so the npm equivalents from the gate list:

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `npx biome check .` | 866 files, 0 findings |
| CI lint | `LINT_BASE=346487b node scripts/ci/lint-changed.mjs` | 10 files checked, exit 0 |
| Typecheck | `npm run typecheck` | 0 errors |
| CI typecheck | `node scripts/ci/typecheck-ratchet.mjs` | `0 errors <= 0 baseline` |
| Tests | `npm run test` | 56 files, 637 tests, 0 failed |
| Node suites | `npm run test:node` | 27 pass, 0 fail |
| Contracts | `npm run test:contracts` | 382 tests, 0 failed |
| runtime-client | `npm --prefix packages/runtime-client run typecheck` | exit 0 |
| Build | `npm run build` | main and preload built. The renderer bundle was killed at 137 and again at 134 in a 3.9 GB sandbox, so it is reported not run |

## 13. Rollback

One module plus two import swaps. Revert the commit.

## 14. Out of scope

The Codex binary pin and the app-server adapter, which are {{S12}} and {{S35}}. Model-tier features were rejected in triage row 36.

## 15. Handoff notes

Append the decision line to `.dump/app/decisions/provisional-assumptions.md` or `decisions.md` with the date, and mark the parity plan's P1-5 row done so nobody redoes it.

Done 2026-09-15. The decision row in `.dump/global/decisions.md` carries the amendment, and the parity plan's P1-5 row reads closed with the follow-up named. Two deviations from the plan text above, both recorded there:

1. The shared module is `src/shared/codex-model-id.ts`, not `codex-defaults.ts`. Six sibling modules already hold a provider default under `src/shared/<provider>-model-id.ts`, and `AGENTS.md` says follow the conventions that exist.
2. The resolver is `src/main/lib/providers/codex-models.ts` as the plan names it, and it takes the static list as a parameter instead of importing the renderer's picker list into the main process.

Still open, filed as a follow-up rather than widened here: nothing in the renderer calls `codex.getDefaultModel`, so the picker still shows its own static default and never shows that the CLI answer fell back. The step forbids re-plumbing the picker.
