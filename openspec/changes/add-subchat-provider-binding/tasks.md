# Tasks: Persist sub-chat provider binding in the database

- [x] 1. Schema: add `provider` TEXT (nullable) to `subChats`; generate
      drizzle migration 0010; verify journal/snapshot
- [x] 2. Shared: provider-union const + zod schema importable from main
      (single home; renderer AgentProviderId stays the UI union)
- [x] 3. chats router: `create`/`createSubChat` accept `provider`;
      `forkSubChat` copies binding; `updateSubChatProvider` mutation
- [x] 4. Renderer read-through: stored binding first in
      `inferProviderFromMessages`; keep override/infer fallbacks
- [x] 5. Renderer write-through: create (form + programmatic), provider
      switch, continue-with-provider, fork; lazy backfill on NULL
- [x] 6. Verify: tsc zero-new, node--test, secrets; manual smoke
      (new chat per provider routes correctly after reload)

Verify: tsc zero-delta (25), node--test 27/27, secrets clean; migration
applied against node:sqlite (column + insert round-trip OK).
