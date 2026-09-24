<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file is the architecture map for mausCode. The binding rules for agents live in `AGENTS.md` and the review protocol lives in `FULL-REVIEW.md`. For any UI, UX, motion, typography or copy work, also load `DESIGN.md`, then `docs/design-system-baseline.md`, then the skill routing and execution limits in `docs/design-skills.md`; the design skills are read for their rules and none of their installers, downloads or remote generators run here. Roadmap step 01 measured every path and count on this page against the tree at `7c89af0` on 2026-09-14. When a path here disagrees with the tree, the tree wins and your change corrects this file in the same commit.

## What is this?

**mausCode** is a local-first agent workspace by maus-inc. A user creates chat sessions linked to local project folders, runs coding agents in isolated git worktrees, and watches tool execution in real time. The product and interface foundation came from the archived 1Code project under Apache-2.0, recorded in `UPSTREAM.md`.

The data model has three levels. A project is a local folder. A chat belongs to one project and owns the worktree and the pull request link. A sub-chat belongs to one chat and owns the runtime session, the provider binding and the agent mode.

## Agent modes

`AgentMode` has five values and `AGENT_MODES` orders them by autonomy. Shift and Tab cycle them in that order. The declaration is `src/renderer/features/agents/atoms/index.ts`.

| Mode | Behaviour |
| --- | --- |
| `plan` | Read-only. The agent plans and does not change files. |
| `ask` | The agent asks before editing files and before running commands. |
| `edit` | The agent edits files freely, and the runtime blocks dangerous deletions. |
| `agent` | The default and the canonical value. The agent edits and runs commands, and the runtime blocks dangerous deletions. |
| `turbo` | The agent runs everything without asking, and dangerous deletions are not blocked. |

Two files hold the mode behaviour and they must stay in step. `src/renderer/features/agents/lib/mode-display.ts` holds the label and the tooltip per mode, and `src/main/lib/trpc/routers/claude.ts` holds the `canUseTool` switch that enforces them. The tooltip comment in `src/renderer/features/agents/lib/mode-display.ts` requires the two to match.

Each mode also has a slash command. `src/renderer/features/agents/commands/builtin-commands.ts` declares 13 of them, `/plan`, `/ask`, `/edit`, `/agent` and `/turbo` for the modes, and `/clear`, `/compact`, `/review`, `/pr-comments`, `/release-notes`, `/security-review`, `/commit` and `/worktree-setup` for the rest.

Three other unions use the word mode. Only the first list above is made of agent modes.

- `WorkMode` is `local` or `worktree`, declared in the same renderer atoms file. It chooses where the chat runs, not how much the agent may do.
- `ProviderInteractionMode` is `default` or `plan`, declared in `src/shared/contracts/orchestration.ts`. That tree is vendored vocabulary with no importer outside its own directory.
- `RuntimeMode` is `approval-required`, `auto-accept-edits`, `auto` or `full-access`, declared in the same contracts file, and unused today.

The five agent mode names are written out in 38 places beside the declaration. That is 14 inline `z.enum` literals across 12 routers in `src/main/lib/trpc/routers`, and 24 TypeScript unions across the transports, the print adapters and the stores. `sub_chats.mode` carries a column default of `agent`. Change the renderer declaration first, and read roadmap step 06 before you add another copy.

## Commands

`package.json` holds 29 scripts. These are the ones that matter for a code change.

```bash
# Development
bun run dev              # Electron with hot reload

# Gates. These are the local forms, and two of them are not what CI runs.
npm run typecheck        # tsc --noEmit, the plain run, not the CI job
npm run lint             # node scripts/ci/lint-changed.mjs, the CI form
npm run test             # vitest, the CI form
npm run test:node        # node:test suites under src/main/lib/runtime, the CI form
npm run test:contracts   # vitest over src/shared/contracts, the CI form
npm run ratchet:typecheck  # the typecheck job, against the baseline
npm run ratchet:audit      # the audit job, no new critical advisories

# Build and package
bun run build            # electron-vite build, three targets
bun run package          # electron-builder --dir, no publish
bun run package:mac      # macOS DMG and ZIP
bun run package:win      # Windows NSIS and portable
bun run package:linux    # Linux AppImage and DEB

# Database, Drizzle and SQLite
npm run db:generate      # generate a migration from the schema
npm run db:push          # push the schema directly, dev only

# Bundled agent binaries, version pinned in the script
npm run claude:download  # 2.1.270
npm run codex:download   # 0.154.0
```

Three scripts need a note.

`npm run typecheck` runs `tsc --noEmit`. The job CI runs is `npm run ratchet:typecheck`, which compares the error set against `.github/ci-baselines/typecheck.txt`, and that file holds a single newline, so no error is permitted. The rules for adding a baseline row live in `CONTRIBUTING.md`.

`npm run ts:check` runs `tsgo --noEmit` through `@typescript/native-preview`. The CI `quality` job runs it as a second typecheck gate, and `tsc` owns the baseline record. The 2026-09-14 measurement found zero disagreement between the two tools, recorded in `.dump/app/benchmarks/2026-09-14-tsc-vs-tsgo-typecheck.md`.

`npm run prebuild` runs `npm run build:runtime-client`, and electron-vite triggers it automatically. `@maus-inc/runtime-client` resolves through the `file:packages/runtime-client` dependency to that package's `dist`, so a stale or missing `dist` breaks typecheck with confusing errors. CI installs with `--ignore-scripts` and then builds that package explicitly for this reason.

## Architecture

```
src/
├── main/                      # Electron main process, the Node side
│   ├── index.ts               # App entry, window lifecycle, OAuth deep links, menus
│   ├── constants.ts           # IS_DEV, PROTOCOL, AUTH_SERVER_PORT, DEV_USER_DATA_NAME
│   ├── auth-manager.ts        # OAuth flow and token refresh
│   ├── auth-store.ts          # Encrypted credentials through Electron safeStorage
│   ├── windows/main.ts        # Windows and the raw ipcMain surface behind desktopApi
│   └── lib/
│       ├── db/                # Drizzle schema plus startup migrate()
│       ├── runtime/           # Native runtime host: manager, translate, sessions,
│       │                      #   endpoints, credentials, mcp-config
│       ├── codex-app-server/  # Codex app-server adapter and its mock peer
│       ├── providers/         # Ten capability profiles
│       └── trpc/routers/      # 37 files, 36 routers mounted by createAppRouter
│
├── preload/                   # IPC bridge under context isolation
│   └── index.ts               # Exposes desktopApi plus the tRPC bridge
│
└── renderer/                  # React 19 UI, mapped by the @/ alias
    ├── App.tsx                # Root providers and onboarding routing
    ├── features/              # 14 folders, listed below
    ├── components/ui/         # Radix UI wrappers
    └── lib/
        ├── atoms/             # Global Jotai atoms
        ├── stores/            # Global Zustand stores
        ├── trpc.ts            # Real tRPC client
        └── mock-api.ts        # In-process tRPC stand-in, still imported by 4 files
```

The 14 folders under `src/renderer/features/` are `agents`, `automations`, `changes`, `details-sidebar`, `file-viewer`, `hooks`, `kanban`, `layout`, `mentions`, `onboarding`, `projects`, `settings`, `sidebar` and `terminal`.

`src/main/lib/trpc/routers/` holds 37 files. Thirty-five of them are router modules, `src/main/lib/trpc/routers/agent-utils.ts` holds the agent markdown parser, and `src/main/lib/trpc/routers/index.ts` mounts 36 routers. The 36th is `changes`, built by `createGitRouter()` in `src/main/lib/git`.

Repositories outside `src/` that a step may need:

| Path | What it is |
| --- | --- |
| `packages/runtime-client` | Fork of the JCode SDK, recorded in `UPSTREAM.md` and `NOTICE`. Its `dist` is a build input for main. |
| `runtime/jcode` | The pinned JCode engine, vendored at commit `ce4e789`, MIT. `runtime/jcode/UPSTREAM.md` records the pin, the licence and what is excluded. |
| `src/shared` | What the main process and the renderer must agree on. |
| `src/shared/contracts` | Ported Effect schemas, 44 source files and 23 test files, with no importer outside the directory yet. Start at `src/shared/contracts/README.md`. |
| `scripts/ci` | The gate scripts CI runs, `scripts/ci/lint-changed.mjs`, `scripts/ci/typecheck-ratchet.mjs` and `scripts/ci/audit-ratchet.mjs`. |
| `benchmarks` | Performance records. `CONTRIBUTING.md` requires a measured delta here for any change that moves startup, memory, rendering or file weight. |
| `drizzle` | Generated migration SQL, applied at startup. |
| `.dump` | The engineering memory. Research, plans, decisions, audits and benchmarks per capability. |
| `openspec` | Change proposals and their specs. Read `openspec/AGENTS.md` before writing one. |

## Database

SQLite through better-sqlite3 and Drizzle. The schema is one file, `src/main/lib/db/schema/index.ts`, and it declares 13 tables.

The five that carry the product:

```typescript
projects    → id, name, path, git remote fields, iconPath, accentColor, rail fields
chats       → id, name, projectId, worktree fields, baseBranch, prUrl, prNumber
sub_chats   → id, name, chatId, sessionId, streamId, mode, provider, messages
runs        → id, subChatId, status, startedAt, endedAt, stopReason, approvalPending, engine, provider, model, lastSeq
run_events  → id, runId, seq, kind, payload (JSON text), at; unique (runId, seq)
```

`runs` and `run_events` are the main-owned record of each agent turn (roadmap step 07). The state machine, transitions and the event feed live in `src/main/lib/runs/run-state.ts`; the tRPC surface is `runs.get`, `runs.list` and `runs.subscribe` in `src/main/lib/trpc/routers/runs.ts`; the renderer projection into the streaming status store is `src/renderer/features/agents/stores/run-feed-projection.ts`. The design contract is `.dump/app/plans/2026-09-13-run-state.md`.

The other eight hold credentials and per-provider settings, `anthropic_accounts`, `anthropic_settings`, `native_endpoint_settings`, and one credential table each for `claude_code`, `qwen`, `cline`, `openclaw` and `roo`.

Every primary key gets its value from `createId()` in `src/main/lib/db/utils.ts`.

The database lives at `{userData}/data/agents.db`. `initDatabase()` in `src/main/lib/db/index.ts` calls `migrate()` on startup. Dev reads migration SQL from `drizzle/`, and a packaged build reads it from the app's `resources/migrations`, which `extraResources` in `package.json` copies from `drizzle/`.

```typescript
import { eq } from "drizzle-orm"
import { chats, getDatabase, projects } from "../lib/db"

const db = getDatabase()
const allProjects = db.select().from(projects).all()
const projectChats = db.select().from(chats).where(eq(chats.projectId, id)).all()
```

Never hand-write migration SQL that `drizzle-kit generate` can emit, and never edit or renumber a migration that has shipped. `AGENTS.md` carries the full rule set under Database migrations.

## Key patterns

### IPC

The main process exposes tRPC over Electron IPC through `trpc-electron` and `superjson`. Every backend call goes through a router rather than raw IPC. `src/main/windows/main.ts` registers a separate raw `ipcMain.handle` surface that backs `window.desktopApi` for window controls, clipboard, dialogs, notifications, theme and the git watcher.

### State

Jotai holds UI state, atoms live beside their feature, and `src/renderer/lib/window-storage.ts` scopes a chat selection per window. Zustand holds the sub-chat tabs and the message stores, and their keys carry a window id prefix. React Query holds server state read through tRPC.

### Claude integration

The Claude Code path imports `@anthropic-ai/claude-agent-sdk` dynamically, so the bundle never statically requires it. `src/main/lib/trpc/routers/claude.ts` owns the `chat` subscription, the mode switch that enforces permissions, and session resume through the `session_id` stored on the sub-chat. Streaming reaches the renderer as UI message chunks.

The provider surface is wider than Claude. Thirteen providers have a router: `claude`, `codex`, `cursor`, `grok`, `qwen`, `cline`, `openclaw`, `roo`, `opencode`, `gemini`, `openrouter`, `ollama` and `hermes`.

Ten of those have a capability profile in `src/main/lib/providers/`: `claude`, `cline`, `codex`, `cursor`, `grok`, `hermes`, `openclaw`, `opencode`, `qwen` and `roo`. The manifest shape is `providerCapabilitySchema` in `src/shared/provider-capabilities.ts`, with `security`, `performance` and `features` sections, and `src/main/lib/trpc/routers/providers.ts` serves it. `gemini`, `openrouter` and `ollama` have a router and no profile, so a step that needs a capability answer for one of those three has to write the profile first.

## Tech stack

Versions are the ones `bun.lock` resolves.

| Layer | Tech |
| --- | --- |
| Desktop | Electron 39.4.0, electron-vite 3.1.0, electron-builder 25.1.8 |
| UI | React 19.2.1, TypeScript declared `^5.4.5` and resolved to 5.9.3, Tailwind CSS 3.4.19 |
| Components | Radix UI, Lucide icons, Motion, Sonner |
| State | Jotai, Zustand, React Query |
| Backend | tRPC over Electron IPC, Drizzle ORM, better-sqlite3 |
| AI | `@anthropic-ai/claude-agent-sdk` 0.3.270, plus the Codex app-server adapter |
| Schemas | Effect 4.0.0-rc.112, an exact pin, load bearing for `src/shared/contracts` |
| Lint and format | Biome 2.5.13, every rule at error |
| Tests | Vitest 4.1.11 and `node --test` |
| Package manager | bun |

## File naming

Files are kebab-case. Component symbols are PascalCase. Examples taken from the tree:

- `src/renderer/features/agents/main/active-chat.tsx` exports `ChatView`
- `src/renderer/features/sidebar/agents-sidebar.tsx` exports `AgentsSidebar`
- `src/renderer/features/agents/ui/agent-diff-view.tsx` exports `AgentDiffView`

The tree holds 228 kebab-case `.tsx` files against 4 PascalCase ones. The four are `src/renderer/App.tsx` as the entry point, `src/renderer/contexts/TRPCProvider.tsx`, `src/renderer/contexts/WindowContext.tsx` and `src/renderer/features/terminal/TerminalSearch.tsx`.

Hooks are kebab-case files whose names start with `use`, such as `src/renderer/features/agents/hooks/use-changed-files-tracking.ts`. Zustand stores are kebab-case, such as `src/renderer/features/agents/stores/sub-chat-store.ts`. Jotai atoms are camelCase with an `Atom` suffix, such as `selectedAgentChatIdAtom`.

## Important files

- `src/main/lib/db/schema/index.ts` is the schema source of truth.
- `src/main/lib/db/index.ts` initializes the database and runs migrations.
- `src/renderer/features/agents/atoms/index.ts` declares the agent modes and the agent UI state atoms.
- `src/renderer/features/agents/main/active-chat.tsx` is the main chat surface.
- `src/main/lib/trpc/routers/claude.ts` holds the Claude SDK integration and the permission switch.
- `src/main/lib/trpc/routers/index.ts` mounts every router.
- `electron.vite.config.ts` defines the main, preload and renderer entries.

## Debugging first install issues

To simulate a fresh install, clear the app data and run dev again.

```bash
# 1. Clear app data, which holds auth, the database and settings
rm -rf ~/Library/Application\ Support/mausCode\ Dev/

# 2. Reset the macOS protocol handler registration when testing deep links
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -kill -r -domain local -domain system -domain user

# 3. Run with clean state
bun run dev
```

Dev and production are kept apart by two mechanisms, both declared in `src/main/constants.ts`. Dev derives its userData folder name from `DEV_USER_DATA_NAME`, which is `mausCode Dev`, so the two installs never share a database. Dev registers the `mauscode-dev` deep link protocol while production registers `mauscode`. Both installs share the `dev.mausinc.mauscode` app id from `package.json`, and `AUTH_SERVER_PORT` differs so the two can run side by side.

Two first-install bugs are known. The OAuth deep link may need a second click on first launch, because macOS Launch Services does not always register a protocol handler immediately. The folder dialog can also miss the first attempt when the window is not yet focused, and the fix is to focus the window before `dialog.showOpenDialog()`.

## Releasing a new version

Release artifacts are unsigned by design. The human refused signing and notarization for mausCode on 2026-09-14, and `.dump/global/decisions.md` records that decision with the rejected option named. There is no notarization identity, no keychain profile and no plan to add one, so a signing or notarization step must never be reintroduced here.

`SHA256SUMS` is the integrity story. A user who wants to run a build confirms the checksum, and the README states the one-time right-click Open that Gatekeeper requires.

Auto-update stays off until a build sets `MAIN_VITE_UPDATE_FEED_URL`. That default is what makes publishing an unsigned artifact safe, and `src/shared/app-identity.ts` holds `DEFAULT_UPDATE_FEED_URL` as empty. Never reintroduce a third-party update host. The inherited `cdn.21st.dev` channel served 1Code's manifests and must not come back.

Roadmap step 32 builds the release workflow and owns the artifact matrix, the alpha and stable channels, and the manifest paths. Until that step lands, the only release surface in the tree is `electron-builder.yml`, the `package:*` scripts, and `dist:manifest` which runs `scripts/generate-update-manifest.mjs`.

## Where the live status lives

This file describes architecture, and it does not carry a status list. A status list inside an instruction file is how the drift this page just corrected happened. The current state of the product, what shipped and what is open, lives in `.dump/app/second-brain.md`. The ordered work sequence lives in `.dump/app/plans/2026-09-13-mauscode-roadmap.md`, and every step closes with a dated record under `.dump`.
