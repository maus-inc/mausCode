# mausCode Naming System

**Status:** Approved for implementation in this repository (public items marked ⚠ are pending human confirmation — see `open-decisions.md`).
**Authority:** MausAgent (naming/identity). Other agents should follow this file; the canonical short-form is also mirrored in `.dump/global/naming.md`.

## Ground rules

1. **`mausCode`** is the product display name. Uppercase **C**, lowercase **m** — always, in prose, UI, docs, metadata. Never `MausCode`, `MAUSCODE`, or `mauscode` **except** where an identifier's rules require it (see §4).
2. **`maus-inc`** is the company name. Lowercase, hyphenated — in legal notices, copyright lines, package author fields.
3. Technical identifiers (commands, schemes, ids, directories, env vars) use lowercase `mauscode` — this is a **technical identifier**, not a styling choice. Never use `MausCode` in an identifier.
4. JCode is **upstream provenance**, not product branding. It is named in `UPSTREAM.md` and `NOTICE` as the foundation of the mausCode runtime. User-facing surfaces do not say "JCode" until the runtime ships — and if it ships, the public name is decided in D2.
5. 1Code / 21st.dev appear **only** in: `UPSTREAM.md`, `NOTICE`, the "Origin & Attribution" section of `README.md`, the historical chat-context document, and read-only legacy-detection code (clearly commented as legacy).

## The naming system

### Product

| Concept | Name | Identifier form | Notes |
|---|---|---|---|
| Company | maus-inc | — | Legal entity; copyright holder of mausCode |
| Product / application | mausCode | `mausCode` (display) | The full-stack agent workspace |
| Desktop application | mausCode (desktop) | bundle `mausCode`, appId `dev.mausinc.mauscode` | Electron app |
| Repository | mausCode | `github.com/maus-inc/mausCode` | GitHub keeps case as created |

### Runtime (the deliberate decision)

The product thesis: *mausCode owns a native runtime derived and refined from JCode.* The public language must read as **one product**, not "1Code + JCode + adapters."

| Concept | Public name | Internal name | Rationale |
|---|---|---|---|
| Native execution engine | **mausCode Runtime** ⚠ (D2) | refined JCode core | Users buy *mausCode*, not JCode. JCode's performance is mausCode's performance. The JCode name is the foundation's name — acknowledged in provenance, not sold as a separate product. |
| Runtime daemon on a machine | **mausCode Node** ⚠ (D2) | — | The thing you run on a spare box / remote machine (`mauscode node`). "Node" is the standard term for a remote execution endpoint (cf. t3 connect, Daytona) and reads naturally next to "runtime". |
| Where a runtime runs | **local / remote / container** placement | — | Placement is an attribute, not a product: "mausCode Runtime on this device", "on Docker", "on Daytona". No per-placement product names. |
| Remote execution in general | **remote execution** | — | A capability, not a feature name. |

### Agents & sessions

| Concept | Name | Notes |
|---|---|---|
| A working agent conversation | **session** | Inherited 1Code term ("sub-chat" is the internal/tab concept; keep as-is — renaming is churn without identity benefit). |
| The built-in agent | **mausCode agent** | The native agent running on the mausCode Runtime. |
| External CLIs (Claude Code, Codex, OpenCode, Hermes, …) | **compatibility agents** ⚠ (D5) | Secondary option in the product model. UI grouping label when they need a name: "Compatibility agents". Each keeps its own trademarked product name (Claude Code stays "Claude Code", etc. — we never rename other companies' products). |
| Coding-agent capability in general | **agents** | Generic; the sidebar/feature area stays "agents" — it already means "coding agents", which is exactly right for mausCode. |

### Workspace model

| Concept | Name | Notes |
|---|---|---|
| A connected project folder | **project** | Inherited, correct, keep. |
| Project-local state | **workspace** | Where the product thesis uses "workspace" (= project + runtime + sessions + environment). UI keeps the existing project/workspace split; do not introduce a third top-level noun. |
| Isolated working copy | **worktree** | Git term; keep. Stored under `~/.mauscode/worktrees/`. |
| Isolation unit per chat | **git worktree** (existing UI copy) | Keep. |

### Provider / BYOK

| Concept | Name | Notes |
|---|---|---|
| LLM supplier | **provider** | Inherited, standard. |
| User-supplied credentials | **BYOK** / "your API keys" | Keep the industry term; UI copy "Bring your own keys". |
| Provider config record | `ProviderConfig` (code) | provider / model / endpoint / credential_ref / capabilities |

### Integrations

| Concept | Name | Notes |
|---|---|---|
| Model Context Protocol servers | **MCP servers** | Industry standard; keep. |
| Reusable capability files | **skills** | Inherited (Claude/OpenCode term); keep. |
| Slash commands | **slash commands** | Keep. |
| Imported foreign setups (Claude/Cursor/Hermes configs) | **import / migration** | The future "Import environment" flow. Term: **migrate** (verb), **import** (noun). |

### CLI

| Concept | Name | Identifier |
|---|---|---|
| App launcher command ⚠ (D1) | mauscode | `mauscode .`, `mauscode /path/to/project` — installed via Settings/Menu. (Future: `mauscode node` etc. once the runtime CLI ships — one command, subcommands, not separate binaries.) |

### Data & identity locations

| Concept | Location | Notes |
|---|---|---|
| App user data | OS app-data dir (from productName `mausCode`) | dev: `mausCode Dev` folder |
| Worktrees | `~/.mauscode/worktrees/` | legacy `~/.21st/worktrees/` still **detected** |
| Cloned repos default | `~/.mauscode/repos/` | |
| Project worktree config | `.mauscode/worktree.json` | legacy `.1code/worktree.json` still **detected** |
| Deep-link protocol | `mauscode://` (prod), `mauscode-dev://` (dev) | lowercase per RFC 3986 |
| App id | `dev.mausinc.mauscode` | placeholder domain pending D4 |
| Terminal env | `TERM_PROGRAM=mausCode` | |
| MCP client name | `mauscode-desktop` | |
| MCP OAuth client name | `mauscode` (fallback `Codex`) | |
| Themes | `mauscode-dark`, `mauscode-light` | display: "mausCode Dark"/"mausCode Light" |

## Rejected naming approaches

| Approach | Why rejected |
|---|---|
| Public name "JCode Runtime" | Sells the upstream project, not mausCode. Reads as two products. JCode's value (speed, memory) is absorbed into the mausCode claim; its name stays in provenance. |
| "mausCode/JCode Runtime" (hyphenated dual name) | Clunky in UI; dual branding is exactly the incoherence the thesis warns against. |
| CLI named `maus` | Too short/collides with the company word on its own; `mauscode` is unambiguous and self-documenting. (Still asked — D1 — because it's the one name users type forever.) |
| CLI named `mcode` | Confusable with other tools; drops the brand. |
| Renaming "session"/"project"/"worktree" to mausCode-coined nouns | Churn without identity benefit; these are stable, understood terms. |
| Exposing "node" before the runtime ships | The daemon doesn't exist yet; the term is reserved, not yet printed in UI. |
| Keeping `1code` CLI for migration continuity | Ships the old brand as the primary command of a new product; legacy support belongs in data detection, not in the command name. |
