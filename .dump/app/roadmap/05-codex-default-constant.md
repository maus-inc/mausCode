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

One Codex default model constant in `src/shared/`, read by the main-process router and the renderer transport, so a chat created with no model chosen sends the same string whichever path it takes.

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
2. Add `src/shared/codex-defaults.ts` exporting the model id and, separately, the reasoning effort, as two values rather than one slash-joined string. A joined string is why the two constants differed in the first place.
3. Point both call sites at it. Keep the transport's effort handling where it is, and pass the effort as its own field.
4. Record the chosen default from step {{S04}} and, if it deviates from the inherited release note, say so in the module comment with the date.
5. Add one test asserting both importers resolve the same value, so the drift cannot come back.

## 8. Boundaries

- Always: main and renderer read one constant.
- Ask first: changing the default model itself, which is step {{S04}}.
- Never: widen the model list, re-plumb the picker, or start a provider-catalog module in this step.

## 10. Acceptance criteria

- [ ] `grep -rn "gpt-5" src --include=*.ts --include=*.tsx` returns hits only in the new module and in tests or comments naming it.
- [ ] The model id and the effort are separate exported values.
- [ ] A test fails if either consumer stops importing the shared value.
- [ ] Typecheck and tests green, and no new Biome findings.

## 11. Verification

```sh
bun x biome check .        # 0 findings
npm run typecheck          # 0 errors
npm run test
```

## 13. Rollback

One module plus two import swaps. Revert the commit.

## 14. Out of scope

The Codex binary pin and the app-server adapter, which are {{S12}} and {{S35}}. Model-tier features were rejected in triage row 36.

## 15. Handoff notes

Append the decision line to `.dump/app/decisions/provisional-assumptions.md` or `decisions.md` with the date, and mark the parity plan's P1-5 row done so nobody redoes it.
