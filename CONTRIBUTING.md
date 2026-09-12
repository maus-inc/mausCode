# Contributing to mausCode

mausCode is a local-first agent workspace by maus-inc. It inherits its product/UI foundation
from the archived [1Code](https://github.com/21st-dev/1code) project (Apache-2.0) — see
`UPSTREAM.md` and `NOTICE` for the provenance record.

## Building from Source

Prerequisites: Bun, Python 3.11 (with setuptools), Xcode Command Line Tools (macOS).

```bash
bun install
bun run dev          # Development with hot reload
bun run build        # Production build
bun run package:mac  # Create distributable (also: package:win, package:linux)
```

Agent binaries are required for agent functionality:

```bash
bun run claude:download
bun run codex:download
```

## Performance rule

mausCode's product claim is a fast, light agent workspace. No change may materially degrade
runtime performance, memory usage, startup time, rendering performance, or existing UI
behavior without a benchmark and a justification recorded in `.dump/<domain>/`.

- Establish a baseline before changing performance-sensitive code
- Benchmark after the change; document the delta
- Prefer root-cause fixes over patches; keep the UI↔backend hot path thin

## Local-only mode

The app runs without any hosted service. When `MAIN_VITE_API_URL` is unset, sign-in, hosted
changelog, and auto-updates are simply unavailable — all local features work. Do not
reintroduce hardcoded third-party service endpoints; control-plane and update-feed URLs are
build-time configuration (see `.env.example`).

## Analytics & Telemetry

Analytics (PostHog) and error tracking (Sentry) are **disabled by default** in open-source
builds. They only activate if you set the corresponding environment variables in
`.env.local` (see `.env.example`). Never log secrets, and never send project contents.

## Provenance hygiene

When touching inherited code:

- Preserve upstream attribution in `UPSTREAM.md` / `NOTICE` and this file
- Do not claim upstream authorship as mausCode's
- Legacy 1Code data locations (`~/.21st/worktrees`, `.1code/worktree.json`) are
  **detected read-only** — keep them resolving, never write to them
- New mausCode terminology follows `.dump/global/naming.md`

## Contributing

1. Fork the repo
2. Create a feature branch
3. Make your changes (keep commits reviewable)
4. Submit a PR

## License

Apache 2.0
