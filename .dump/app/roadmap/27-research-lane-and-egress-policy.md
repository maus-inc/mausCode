## 0. Meta

| Field | Value |
| --- | --- |
| Step | 27 of 45, wave W12 |
| Area | main, shared, renderer |
| Risk | critical, it is the app deciding to talk to the internet |
| Depends on | {{S10}}, {{S11}}, {{S26}}, {{S28}} |
| Blocks | {{S33}} |
| Estimate | medium |

## 1. Outcome

A research lane: the agent can search and fetch on its own initiative when the task needs it, and every such call passes one egress policy that names the allowed hosts, the byte caps and the redaction. The policy is a capability the app reports, not a hope.

## 2. Why it matters

Triage row 51 accepted proactive web search and left the shape to this plan, and the plan's answer is that the search is not the risky part. The risky part is an unattended run reaching the network with no record. Ten provider profiles already declare `egress: ["provider-configured"]` in `src/main/lib/providers/`, verified this session, which is the honest statement that we currently know nothing about what those CLIs fetch on their own. This step makes the app's own fetches governed and visible, and records the boundary of what we cannot govern.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Every provider profile declares one egress value, and none of them declares a research or fetch surface | `src/main/lib/providers/claude.ts:73`, and the same key in `cline.ts:39`, `codex.ts:51`, `cursor.ts:38`, `grok.ts:40` | E1, this session |
| Capability profiles are read by one router and by no renderer file | `src/main/lib/trpc/routers/providers.ts`; a repo-wide grep for the registry import returns only `src/main/lib/providers/index.ts` and `types.ts` | E3, this session |
| Codex already has a typed web-search tool shape we must not pretend to control | `src/main/lib/codex-app-server/src/_generated/schema.gen.ts:20523`, `:21235` web search tool config | E1, this session |
| Grok's ask posture is an explicit tool allow-list, which is the model for a bounded surface | `.dump/app/backend-landscape-2026-09-11.md` §5, `--tools read_file,grep,list_dir,web_search,web_fetch` | recorded |
| No egress policy module exists | `grep -rn "webEgress\|egress" src` returns only the provider profiles above | E3, this session |
| The CSP already permits local origins, so an added host is visible in one file | `src/renderer/index.html`, recorded in `FULL-REVIEW.md` §6.2 with the current allowances | recorded, re-read before touching |

## 4. Read first, and what already exists

`docs/backend-porting-recipe.md` §7, the capability manifest, because this step both consumes and updates it. `src/shared/local-only.ts` is the existing host-blocklist shape, and `AGENTS.md` states the local-only promise. Read `src/main/lib/providers/types.ts` before adding a field, so the profile stays one type rather than a per-provider ad-hoc object.

## 6. Implementation plan

1. `src/shared/web-egress.ts`: one policy type with `mode` off, allow-listed, or provider-default; `allowedHosts`; byte cap; timeout; a redirect hop cap; and a redaction list. Defaults deny, allow-list explicit, and the whole policy serialised so it can be shown and stored.
2. One fetch implementation in main that enforces the policy and nothing else calls the network for research: validate scheme, resolve and re-check the host after redirect, cap bytes while streaming rather than trusting `content-length`, delete partial bodies on failure.
3. `research.search` and `research.fetch` as tRPC procedures, plus the two tools the agent may call, gated on the policy. A denial returns the rule that denied, like step 10 does.
4. Persist every call as a run event with the URL host, the bytes, the status and the reason, never the query text, so the log is shareable.
5. The lane: an opt-in per-session toggle in the composer, and results land as cited sources in the transcript rather than as loose prose, using the existing markdown path.
6. Capability honesty: extend the provider profile with a `research` field naming what the provider can do, and set `egress` to reflect what we actually cannot observe, with a note per provider instead of a claim of control we do not have.
7. Tests: blocked host, redirect to a blocked host, oversize body, timeout, the redaction list, and a policy of off producing zero network calls in a mock-recording test.

## 8. Boundaries

- Always: off by default, allow-list rather than block-list, capped bytes, redacted logs, and one enforcement point.
- Ask first: adding a host to the default allow-list, and any change that lets an unattended run search without the flag from step 10 applying.
- Never: a wildcard in the CSP, a fetch from the renderer, trusting `content-length` for the cap, sending repository contents as a query, or storing a fetched page that could carry prompt instructions without marking it untrusted.

## 10. Acceptance criteria

- [ ] A turn with the lane off performs no outbound call, proven by a recording mock.
- [ ] A redirect into a disallowed host is refused after the redirect, with a test that proves the re-check runs.
- [ ] A 50 MB response is cut at the cap and the partial body is deleted.
- [ ] The run record shows host, bytes, status and rule, and shows no query text.
- [ ] Each provider profile states its research capability honestly, and one profile that cannot say is rendered without the control rather than with a fake one.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
grep -rn "fetch(" src/renderer | wc -l   # expected: 0
```

## 12. Benchmark record

Added latency per research turn and bytes per fetch at the cap, in `.dump/app/benchmarks/`.

## 13. Rollback

Policy off is the rollback. Reverting removes the tools; the persisted events stay and are unread by older code.

## 14. Out of scope

Third-party search providers as an account feature, browser automation and screenshots, deferred in triage row 39, and hosted relay of searches, which does not exist.

## 15. Handoff notes

Write the policy shape and the per-provider honesty notes into `.dump/app/research/2026-09-13-web-egress.md`, since {{S33}} reads the machine inventory through the same policy and {{S34}} scopes it per placement.
