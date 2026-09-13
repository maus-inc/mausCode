## 0. Meta

| Field | Value |
| --- | --- |
| Step | 28 of 35, wave W13 |
| Area | main, renderer, db |
| Risk | critical, it touches another product's config and MCP credentials |
| Depends on | {{S10}}, {{S11}} |
| Blocks | {{S27}}, {{S33}}, {{S35}} |
| Estimate | medium |

## 1. Outcome

mausCode owns its MCP server list in its own store, and each provider's config file is a projection written from that list. One add, one edit, one delete, one place a credential goes, and a per-server approval posture the app shows rather than guesses.

## 2. Why it matters

There is no MCP source of truth. Adding a server in settings calls `trpc.claude.addMcpServer`, verified at `src/renderer/components/dialogs/settings-tabs/mcp/add-mcp-server-dialog.tsx:22`, which lands on a procedure in the Claude router at `src/main/lib/trpc/routers/claude.ts:2916`, while `codex.ts:1427` carries its own `addMcpServer`. Eleven provider modules read each CLI's own file: 6 at `src/main/lib/*-mcp.ts` and 5 at `src/main/lib/*-print/mcp-config.ts`, verified by listing both globs this session, and `src/main/lib/db/schema/index.ts` holds no MCP table, verified by grep. So a server added for one provider is invisible to the others, and the app's settings screen edits a file the user also edits in another product.

## 3. Evidence

| Fact | Path | Level |
| --- | --- | --- |
| Two routers each with their own add procedure | `src/main/lib/trpc/routers/claude.ts:2916`, `src/main/lib/trpc/routers/codex.ts:1427` | E1, this session |
| The settings tab calls the Claude one | `src/renderer/components/dialogs/settings-tabs/mcp/add-mcp-server-dialog.tsx:22` | E1, this session |
| No MCP table exists, so nothing survives except in provider files | `grep -n "mcp" src/main/lib/db/schema/index.ts` returns nothing | E3, this session |
| Plugin view aggregates per-plugin configs read-only | `src/main/lib/trpc/routers/plugins.ts:177-215` | E1, this session |
| Per-provider readers already differ in what they can report, which is why a single schema must name the gaps | `.dump/app/decisions/{qwen,cline,openclaw}-provider-adoption-2026-09-11.md` MCP posture sections: qwen scrapes a human-readable list, cline's list command omits definitions, openclaw's loader resolves JSON5 and includes | recorded |
| There is a prior proposal for the native runtime's MCP passthrough | `openspec/changes/add-native-mcp-passthrough/proposal.md` | E1, this session |
| MCP credentials already have an owner | `src/main/lib/mcp-auth.ts`, plus step 11 | E1, this session |

## 4. Read first, and what already exists

`docs/backend-porting-recipe.md` §7, since a server's tool list is a capability. The shared stdio and HTTP tool fetchers the provider records describe already exist, so reuse them for enumeration. `src/main/lib/runtime/mcp-config.ts` is the runtime's projection point, and the openspec proposal above is the seam it expects, so read both before designing the writer.

## 6. Implementation plan

1. `mcp_servers` table: `id`, `name`, `transport`, `command`, `argsJson`, `envRefsJson`, `url`, `headersRefsJson`, `disabled`, `toolAllowlistJson`, `scope` global or project path, `providersJson`, `createdAt`, `updatedAt`. Env and headers are references into the step 11 store, never values.
2. `src/main/lib/mcp/registry.ts` owning reads, writes and the projection contract, plus one writer per provider that regenerates only the entries mausCode created, preserving every unknown user key. Read-before-write, atomic replace, and a failed write leaves the previous file intact, which is the rule in `FULL-REVIEW.md` §6.4.
3. Replace the 11 readers' discovery with registry plus provider reader for ambient entries. Ambient servers stay visible and marked `source: "provider"`, and are never rewritten or deleted by us.
4. Collapse the two procedures into one `mcp.*` surface, keep thin deprecated aliases for one release, and update the settings tab to use them.
5. Tool enumeration once, cached per server with an explicit refresh, feeding both the UI and the allow-list that step 10 enforces.
6. Per-server approval posture as a field with three values, defaulting to ask, and rendering a `disabled` server as disabled rather than deleting it.
7. Tests: projection preserving an unknown user key, a failed write leaving the file intact, ambient entries never written, an env reference resolving at spawn and never serialising to disk, and a rename updating the projection rather than duplicating.

## 8. Boundaries

- Always: references not values for secrets, one owner, ambient entries read-only, and the user's file structure preserved.
- Ask first: any projection that grants a server tools we did not list, and any hosted or relayed MCP surface, which triage row 48 keeps deferred.
- Never: writing a secret into a provider config file, overwriting a user key we did not create, or auto-approving a server because a CLI would accept it.

## 10. Acceptance criteria

- [ ] Adding a server in settings makes it visible to every opted-in provider, proven by two projections from one row.
- [ ] A hand-edited entry in `~/.claude.json` survives untouched, with a test comparing the file byte-for-byte outside our block.
- [ ] No value in a provider file came from our store's secret references, checked by a grep for `apiKey` in projection output.
- [ ] The settings tab shows source, scope, enabled state and tool count from one read.
- [ ] One add path exists, the alias is marked deprecated in code, and no new caller imports the router-specific procedures.

## 11. Verification

```sh
npm run test && npm run typecheck && bun x biome check .
node scripts/ci/lint-changed.mjs
```

## 13. Rollback

Read the registry, write both places for one release, then revert the writer and keep the table.

## 14. Out of scope

A marketplace, MCP-over-HTTP hosting, and exposing mausCode itself as an MCP server, which the competitive record calls a later compatibility layer. The client-name choices in `src/main/lib/mcp-auth.ts` stay as they are, since a fallback name there is a compatibility decision.

## 15. Handoff notes

Record the projection rules and the ambient-entry policy in `.dump/app/plans/2026-09-13-mcp-registry.md`, and note the settings UX standard applied, since triage row 47 asked for our own UI standards rather than an inherited paste-a-key panel.
