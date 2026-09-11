# mausCode

**mausCode** is a local-first agent workspace by [maus-inc](https://github.com/maus-inc): run
coding agents against your projects in an isolated git worktree per chat, watch every tool
call as it happens, and review the diff before it lands.

- **Multi-agent** — Claude Code and Codex side by side in one app, switch instantly
- **Worktree isolation** — each chat runs in its own git worktree; your main branch is never touched
- **Visual diff & built-in git client** — review, stage, commit, push, and open PRs without leaving the app
- **BYOK** — bring your own provider API keys; local AI chat works without any hosted account
- **MCP servers & skills** — full MCP lifecycle management plus custom skills and slash commands
- **Integrated terminal, file viewer, and live previews** — xterm in a panel, `Cmd+P` file search, dev-server preview
- **Plan mode & extended thinking** — structured plans with markdown preview before execution

Built on Electron, React, and SQLite (local-first: all data lives on your machine).

> **Status.** mausCode is in early development. The desktop app is functional for local agent
> work today. The hosted control plane (sign-in, sync, background agents, hosted changelog,
> auto-updates) is not available yet — see [Origin & Attribution](#origin--attribution) and
> `UPSTREAM.md` for what is inherited and what is ahead.

## Installation

Build from source:

```bash
# Prerequisites: Bun, Python 3.11, setuptools, Xcode Command Line Tools (macOS)
bun install
bun run claude:download  # Download Claude binary (required!)
bun run codex:download   # Download Codex binary (required!)
bun run build
bun run package:mac      # or package:win, package:linux
```

> **Important:** the `claude:download` and `codex:download` steps fetch the agent binaries the
> app drives. If you skip them, the app builds but agent functionality will not work.
>
> **Python note:** Python 3.11 is recommended for native module rebuilds. On Python 3.12+,
> make sure `setuptools` is installed (`pip install setuptools`).

## Development

```bash
bun install
bun run claude:download   # first time only
bun run codex:download    # first time only
bun run dev               # Electron with hot reload
```

The app runs in **local-only mode** by default. To point dev builds at a mausCode control
plane (when available), set `MAIN_VITE_API_URL` in `.env.local` — see `.env.example`.

## CLI launcher

From the application menu (mausCode → Install 'mauscode' Command in PATH...), the app
installs a `mauscode` shell launcher:

```bash
mauscode .                # open the current directory in mausCode
mauscode /path/to/project # open a specific project
```

## Origin & Attribution

mausCode's product and UI foundation was inherited from
[**1Code**](https://github.com/21st-dev/1code) by 21st.dev and contributors, an
[Apache-2.0](LICENSE) project archived on 2026-07-07. Upstream authorship is preserved and
credited — see [`UPSTREAM.md`](UPSTREAM.md) (provenance record and baseline commit
`9f1bc76`) and [`NOTICE`](NOTICE). mausCode is an independent product by maus-inc; it is not
endorsed by or affiliated with the original project or company.

The native execution runtime mausCode is building is derived from
[JCode](https://github.com/1jehuang/jcode) (MIT) and will be documented in `UPSTREAM.md` when
vendored.

## License

Apache License 2.0 — see [LICENSE](LICENSE) for details.
