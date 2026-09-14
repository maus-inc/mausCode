# Project context

Roadmap step 01 measured every path, name and count on this page against the tree at `7c89af0` on 2026-09-14. When a path here disagrees with the tree, the tree wins and your change corrects this file in the same commit. The architecture map is `CLAUDE.md` and the binding rules for agents are `AGENTS.md`.

## Purpose

**mausCode** is a local-first agent workspace by maus-inc. Users create chat sessions linked to local project folders, run coding agents in isolated git worktrees, and watch tool execution in real time. The product and interface foundation came from the archived 1Code project under Apache-2.0, recorded in `UPSTREAM.md`.

## Tech stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 39.4.0, electron-vite 3.1.0, electron-builder 25.1.8 |
| UI | React 19.2.1, TypeScript declared `^5.4.5` and resolved to 5.9.3, Tailwind CSS 3.4.19 |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC over Electron IPC, Drizzle ORM, better-sqlite3 |
| AI | `@anthropic-ai/claude-agent-sdk` 0.2.45, plus the Codex app-server adapter |
| Schemas | `effect` 4.0.0-rc.112, an exact pin, load bearing for `src/shared/contracts` |
| Lint and format | Biome 2.5.13, every rule at error |
| Tests | Vitest 4.1.11 and `node --test` |
| Package Manager | bun |

The `effect` pin is exact on purpose. `src/shared/contracts` holds 44 ported source files built on that release candidate, so a floating range would let a new rc enter without a decision. Do not widen it outside the step that owns dependency changes.

## Project conventions

### Code style

Files are kebab-case. Symbols carry the casing that suits them.

- Component files are kebab-case and their exported symbols are PascalCase, for example `src/renderer/features/agents/main/active-chat.tsx` exports `ChatView`
- Hook files are kebab-case and start with `use`, for example `src/renderer/features/agents/hooks/use-changed-files-tracking.ts`
- Zustand store files are kebab-case, for example `src/renderer/features/agents/stores/sub-chat-store.ts`
- Jotai atoms are camelCase with an `Atom` suffix, for example `selectedAgentChatIdAtom`
- The tree holds 228 kebab-case `.tsx` files against 4 PascalCase ones, and the four are `src/renderer/App.tsx`, `src/renderer/contexts/TRPCProvider.tsx`, `src/renderer/contexts/WindowContext.tsx` and `src/renderer/features/terminal/TerminalSearch.tsx`
- Simplicity over complexity, and do not overcomplicate things

### Architecture patterns

- **IPC Communication**: tRPC with `trpc-electron` for type-safe main to renderer communication, with `superjson` as the transformer. Every backend call goes through a router rather than raw IPC.
- **State Management**:
  - Jotai: UI state, with atoms colocated beside their feature
  - Zustand: sub-chat tabs and message stores, keyed per window and persisted to localStorage
  - React Query: server state read through tRPC, with caching and refetch
- **Database**: Drizzle ORM with SQLite, migrated on app startup. The schema is `src/main/lib/db/schema/index.ts` and it declares 11 tables.
- **Claude Integration**: a dynamic import of `@anthropic-ai/claude-agent-sdk`, because the bundle must not require it statically. `src/main/lib/trpc/routers/claude.ts` turns the agent mode into permissions. Five modes exist, `plan`, `ask`, `edit`, `agent` and `turbo`, declared in `src/renderer/features/agents/atoms/index.ts` and described in `CLAUDE.md` under Agent modes.

### Testing strategy

Tests are colocated with the code they cover and the runners are split by what the test needs.

| Runner | Command | What it covers | Files |
|-------|---------|----------------|-------|
| Vitest | `npm run test` | Main-process logic, pure modules, the vendored contracts | 54 under `src/` |
| `node --test` | `npm run test:node` | `src/main/lib/runtime/*.test.ts`, run with `--experimental-strip-types` | 5 |
| `node --test` | `npm --prefix packages/runtime-client run test` | The runtime client package, which builds before it tests | 6 |
| Vitest, scoped | `npm run test:contracts` | Re-runs the `src/shared/contracts` subset alone | part of the 54 |

`vitest.config.ts` sets `environment: "node"`, includes `src/**/*.test.ts`, and excludes `src/main/lib/runtime/*.test.ts` because those run under `node --test` instead. The node environment is deliberate, since the tests cover main-process logic rather than the renderer.

An adapter that talks to a foreign CLI ships a mock peer and lifecycle tests that need no binary, following `docs/backend-porting-recipe.md` section 2. The mock lives at `src/main/lib/<backend>/test/fixtures/<backend>-mock-peer.*`, and nine such `test/` directories exist today under `src/main/lib`, including `codex-app-server` and the six print adapters. Do not skip the mock, and do not make a test depend on a downloaded binary.

`runtime/jcode/sdk/typescript/test/` holds 6 more test files. They belong to the vendored JCode engine, and CI does not run them.

### Git workflow

- Main branch: `main`, which stays releasable
- One branch per roadmap step, based on the branch that step names
- Pull requests for review, and never a direct push to `main`

## Domain context

- **Projects**: a local folder, with its git remote detected from the folder
- **Chat Sessions**: a chat belongs to one project and owns the worktree and the pull request link
- **Sub-chats**: a sub-chat belongs to one chat and owns the runtime session, the provider binding and the agent mode
- **Agent Modes**: five values in autonomy order, `plan`, `ask`, `edit`, `agent` and `turbo`. Shift and Tab cycles them.
- **Work Modes**: `local` or `worktree`, which chooses where the chat runs
- **Tool Execution**: real-time display of the agent's tool calls, including bash, file edits and web search
- **Session Resume**: a session resumes through the `session_id` stored on the sub-chat

## Important constraints

- Local-first: all data stays on the machine in SQLite at `{userData}/data/agents.db`
- Auth: provider OAuth with credentials encrypted through Electron `safeStorage` in `src/main/auth-store.ts`, which is the only sanctioned place a secret lives
- Release artifacts are unsigned by design. The human refused signing and notarization for mausCode on 2026-09-14, `SHA256SUMS` is the integrity story, and a signing or notarization step must never be reintroduced
- Dev and production are separated by the userData folder name and by the deep link protocol, both declared in `src/main/constants.ts`
- Nothing leaves the machine that the user did not ask for. The full rule is in `AGENTS.md`.

## External dependencies

- **Claude Agent SDK**: `@anthropic-ai/claude-agent-sdk` for AI interactions
- **mausCode control plane**: not yet public, configured via `MAIN_VITE_API_URL` at build time, empty by default which selects local-only mode
- **Update feed**: not yet public, configured via `MAIN_VITE_UPDATE_FEED_URL` at build time, empty by default which disables auto-update
- **OAuth Provider**: control-plane authentication flow, available once the control plane ships
