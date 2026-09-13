## 0. Meta

| Field | Value |
| --- | --- |
| Step | 45 of 45, the fork harvest, `ken-jo` behaviour, adopted by the human on 2026-09-13 |
| Area | renderer, main, docs |
| Risk | high, it removes a surface users have today |
| Depends on | {{S04}}, {{S11}}, {{S25}}, {{S31}} |
| Blocks | {{S42}} |
| Estimate | small to medium, smaller than the audit implied |

## 1. Outcome

mausCode has no built-in app sign-in. The window opens into local work, a provider credential is configured in settings, and the account scaffolding that implied a hosted identity is removed rather than hidden. Provider and MCP OAuth keep working, because those are credential paths, not an app account.

## 2. Why it matters

The harvest catalog recorded `ken-jo/1code` as a rejection, "remove auth, we want our login", and the human reversed that verdict on 2026-09-13, so the behaviour is in scope while the fork's diff stays out, per the standing rule that no fork is merged wholesale and no fork's deletions are taken. The product reason is already written in `CONTRIBUTING.md`, the app is local-first and there is no control plane, so today the app carries a login modal and a multi-account router for an identity service that does not exist here.

## 3. Evidence

Measured this session, and the measurements matter because they are smaller than the inherited audit implies.

| Fact | Path | Level |
| --- | --- | --- |
| The login modal has exactly one importer | `src/renderer/features/layout/agents-layout.tsx`, importing `src/renderer/components/dialogs/claude-login-modal.tsx`, whose component is declared at `:46` | E1 |
| The multi-account router is mounted and has three consumers | `src/main/lib/trpc/routers/index.ts:53`, consumers `claude-login-modal.tsx:149-150` and `src/renderer/components/dialogs/settings-tabs/agents-models-tab.tsx:169`, `:173`, `:184`, `:204` for `list`, `getActive`, `migrateLegacy` and `setActive` | E1 |
| The OAuth callback server is shared with MCP auth, so it must stay | `src/main/lib/oauth.ts`, used by `src/main/lib/mcp-auth.ts` and the per-provider `*-mcp.ts` family, and bound at `src/main/index.ts:285` | E1 |
| The credential store is provider auth, not app auth | `src/main/auth-manager.ts` exporting `AuthManager`, `initAuthManager` and `getAuthManager`; `src/main/auth-store.ts` read by the `gemini`, `openrouter`, `github` and `usage` routers | E1 |
| There is no account column to unwind, unlike the audit's note | `grep -rn "accountIds" src/main/lib/trpc/routers/chats.ts` returns 0, and `src/main/lib/db/schema/index.ts` has no `workspaceId` or `subscriptionEmail` column | E3 |
| There is no subscription gate module either | `ls src/shared/subscription-gate.ts` fails, and `isFeatureAvailable` has 0 hits in `src` | E3 |
| `CLAUDE.md` documents all three absent things | its subscription section, `src/main/lib/subscription/{auth,plan-gate}.ts` and `src/shared/subscription-gate.ts` | E1 |
| The rule this step obeys | `.dump/ci/research/fork-network-harvest-catalog.md` Category D, "no fork deletions, no wholesale merge" | E1 |

## 4. Read first, and what already exists

`AGENTS.md` on the credential store owner and on identity, then `agents-models-tab.tsx`, because the account list is woven into the models settings surface and that is the file most at risk of becoming dead markup. `src/main/auth-manager.ts` stays, it is the provider token model.

## 6. Implementation plan

1. Ask the human the scope question first, one question, three options, because two of them are irreversible for some users. Option A, remove the app-level sign-in gate only. Option B, the recommendation, remove the gate and the sign-in modal while keeping provider OAuth and the account list in settings as credential management. Option C, remove all Anthropic OAuth sign-in and keep API keys only, which strands Pro and Max users who have no key. Record the answer in `.dump/global/decisions.md`.
2. Remove the gate from window bootstrap and from `agents-layout.tsx`, and delete `claude-login-modal.tsx` rather than hiding it. Its OAuth success retry at `:128` needs a home, so move the retry into the settings flow where a credential is added, and prove an added credential resumes a stalled turn.
3. Rename what option B keeps rather than deleting it, `anthropic-accounts` becomes credentials management, since `agents-models-tab.tsx` uses `list`, `getActive` and `setActive` for switching between provider tokens, which is a real feature. `migrateLegacy` stays if it still migrates something, and goes if the legacy path is gone.
4. Delete `src/main/lib/subscription/` references, and the plan-gate or analytics-identity plumbing that would consult a hosted subscription, then correct `CLAUDE.md`, which documents a `subscription/` module and a `src/shared/subscription-gate.ts` that do not exist, verified above.
5. Leave the callback server, `src/main/index.ts:285` and `AUTH_SERVER_PORT`, alone except to confirm it stays loopback-bound and keeps redacting codes, since MCP OAuth depends on it.
6. Empty states: no account means the first screen is the project picker, and a provider with no credential says so inline in the composer instead of opening a login dialog. This is user-facing design, so prototype both empty states in HTML, research how two other local-first agent tools handle "no account, one key", and bring two or three layout options to the human before building.
7. Tests: boot with no account and no key reaches a usable empty state, a configured credential authenticates a turn, MCP OAuth still completes through the retained callback server, and no code path renders the removed modal.

## 8. Boundaries

- Always: provider credentials and MCP OAuth keep working, and the docs are corrected in the same PR.
- Ask first: the option in step 1, and any change to `agents-models-tab.tsx`'s account switcher, because that is how a user with two provider tokens chooses between them.
- Never: take `ken-jo`'s diff, its `src/main/index.ts` or `App.tsx` rework or any of its deletions, drop `safeStorage` encryption, remove the callback server MCP depends on, leave a disabled sign-in control behind, or ship a half-removed gate.

## 10. Acceptance criteria

- [ ] The human's chosen option is recorded in `.dump/global/decisions.md` with its date, and the implementation matches it exactly.
- [ ] `grep -rn "claude-login-modal" src` returns nothing, and no route or keyboard path opens a removed dialog.
- [ ] A provider credential added in settings resumes a turn that previously required sign-in, shown by a test on the retry path.
- [ ] An MCP server using OAuth connects after the change, proven against the retained callback server.
- [ ] `CLAUDE.md` no longer documents a subscription module or a shared plan gate, and `npm run test` plus the typecheck and lint gates are green.
- [ ] No database migration is needed or shipped, since the measurements above show no account columns to unwind.

## 11. Verification

```sh
bun x biome check . && npm run typecheck && npm run test && npm run test:node
NODE_OPTIONS=--max-old-space-size=4096 bun run build
```

Manual, a packaged build with nothing configured: launch, reach the project picker, add one provider credential, run one turn, then connect an OAuth-backed MCP server.

## 12. Benchmark record

Startup time to first interactive frame with the gate removed, before and after, in `.dump/app/benchmarks/`. A removed network round trip should show up, and if it does not, that is also worth knowing.

## 13. Rollback

Nothing is destroyed except UI, so a revert restores the modal and the router is untouched in option B. Option C would strand users, which is the reason it needs an explicit answer rather than a default.

## 14. Out of scope

Any hosted account, billing or plan system, all of it outside a local-first app, and `ken-jo`'s passwordless pattern, which the catalog suggests studying only if we ever want a second auth mode.

## 15. Handoff notes

Flip the `ken-jo` row in `.dump/ci/research/fork-network-harvest-catalog.md` from "REJECT for us" to "behaviour adopted by the human's decision on 2026-09-13, diff still refused", and write the reversal into `.dump/global/decisions.md`, since {{S42}} closes the ledger against those annotations and the harvest's "never" list must stay honest about who changed what.
