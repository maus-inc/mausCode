## 0. Meta

| Field | Value |
| --- | --- |
| Step | 42 of 42, the fork harvest close-out |
| Area | docs |
| Risk | low as code, high as institutional memory |
| Depends on | {{S36}}, {{S37}}, {{S38}}, {{S39}}, {{S40}}, {{S41}} |
| Blocks | nothing |
| Estimate | small |

## 1. Outcome

Every row of the harvest ledger reads adopted, refused with a reason, or parked with a re-entry trigger, the two unsafe instructions in the handoff are marked superseded, and the fetched fork refs are either recorded as still needed or dropped.

## 2. Why it matters

`.dump/ci/research/fork-network-harvest-catalog.md` calls itself the live ledger and instructs the next agent to update it rather than let it go stale, and today most rows are unchecked even though the tree already contains the payload. `HANDOFF-fork-harvest-context.md` also carries two instructions that are wrong for this repository, pushing with a token embedded in a remote URL and co-authoring with a bot identity, and `AGENTS.md` now forbids both, so leaving them standing in the memory invites the next agent to obey a bad rule. An honest close-out is cheaper than a re-survey of 618 forks.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| The ledger's own instruction to stay live, and the unchecked rows | `.dump/ci/research/fork-network-harvest-catalog.md`, header note, Category B rows, Category C rows | E1, this session |
| Category A is nearly complete in the tree, verified file by file | `src/renderer/features/agents/lib/` holds twelve `*-chat-transport.ts` files, and `auto-rename.ts`, `use-changed-files-tracking.ts`, `sub-chat-selector.tsx`, `sub-chat-status-card.tsx`, `mcp-servers-indicator.tsx`, `agent-preview.tsx` and `agent-thinking-tool.tsx` all exist | E1, this session |
| The Cursor integration from `SamSammanne/1code-ui` is already adopted | `src/main/lib/trpc/routers/cursor.ts` with 11 procedures, `src/shared/cursor-model-id.ts`, `src/main/lib/cursor-agent-binary.ts`, `.dump/app/decisions/phase6-cursor-provider-adoption.md` | E1, this session |
| Its web parity half is absent | `src/web-server` does not exist | E3, this session |
| The unsafe instructions to supersede | `.dump/ci/research/HANDOFF-fork-harvest-context.md` §8, a token in the remote URL, and the `openhands` co-author line | E1, this session |
| The rejection rows worth keeping as decisions | same catalog, Category D, `ken-jo` auth removal, `jhckevin` deletions, `aletc1` not ahead, stale forks frozen at old tags | E1, this session |
| Fork refs fetched into the local repository, which a clone does not carry | `refs/harvest/*` and `forkup/*`, `lupan/*` named in §6 of the handoff, verified absent here since this workspace was re-cloned | E3, this session |

## 4. Read first, and what already exists

`AGENTS.md` on `.dump` being durable memory and on never embedding a credential in a remote, then both harvest documents in full, then this roadmap's steps 36 to 41, which are the ledger's open rows expressed as work.

## 6. Implementation plan

1. Walk the catalog top to bottom and mark each row with its state and the step or commit that settled it, adopted, adapted, refused or parked, with a one-line reason. Do not delete a refusal, because a documented refusal is what stops a re-harvest.
2. Record the web and desktop parity decision explicitly: local-first desktop is the product, so a second client is parked with the trigger that reopens it, which is a control plane shipping and a demonstrated user need, and note that the Cursor provider half of that fork is already merged.
3. Take or decline the `PsyberKadi` freeze-recovery snapshot as a dated document, and if taken, place it under `.dump/ci/research/` with its provenance line rather than at the repository root.
4. Add a banner to the top of `HANDOFF-fork-harvest-context.md`, a short dated note that its §8 push and co-author instructions are superseded by `AGENTS.md`, keeping the rest of the record intact because it is a dated artifact, not a live rule.
5. State what happened to the fetched fork refs, `forkup/*`, `lupan/*`, `aadivar`, `ning`, `sylv`, `kevin`, `t3code`, that they live only in the workspace that fetched them, and where to re-fetch from, so the next agent does not assume the data is in the repository.
6. Update `.dump/app/second-brain.md` and `.dump/ci/second-brain.md` with the close-out line, and link the catalog from the roadmap plan's non-goals so both point the same way.

## 8. Boundaries

- Always: dated records get a correction banner and a pointer, not a rewrite, and every refusal keeps its reason.
- Ask first: adopting any new fork at all, since this step's whole purpose is to stop the harvesting.
- Never: a token in a remote URL, a bot co-author line, a wholesale merge from any fork, a fork's deletions, or a fork's `README`, `CLAUDE.md` or branding.

## 10. Acceptance criteria

- [ ] No row in the catalog is left ambiguous, every one reads adopted, refused or parked, with the settling commit or step named.
- [ ] The handoff file carries the superseded banner naming the two instructions, and no other text changed.
- [ ] The web parity decision is recorded with its re-entry trigger.
- [ ] The fork-ref note states where the refs came from and that a fresh clone will not have them.
- [ ] Both second brains link the close-out, and the roadmap plan's non-goals section points at the same document.

## 11. Verification

```sh
node -e "const fs=require('fs');const t=fs.readFileSync('.dump/ci/research/fork-network-harvest-catalog.md','utf8');console.log('unchecked', (t.match(/- \[ \]/g)||[]).length)"
bun x biome check .
```

## 13. Rollback

Documents only, so a revert restores the previous ledger state and nothing else.

## 14. Out of scope

Any porting. If this close-out finds an unadopted piece worth taking, it becomes its own issue with its own evidence, not a line item here.

## 15. Handoff notes

The end state to write down is that the harvest is finished, what it gave us, and what it told us not to do, so the next session reads one page instead of a 618-fork survey.
