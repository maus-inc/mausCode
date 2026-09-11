# UPSTREAM — runtime/jcode

Vendored JCode runtime: the native execution engine mausCode refines. This is a
pinned copied tree, not a submodule (see `.dump/app/decisions/provisional-assumptions.md`
PA-3 for the rationale; overturn there, not here).

- Source: https://github.com/1jehuang/jcode
- Pinned commit: ce4e789 (`docs: update weekly stars chart`; JCode v0.84.0)
- Pinned date: 2026-09-11. License: MIT, Copyright (c) 2025 Jeremy Huang —
  preserved verbatim in `LICENSE`. Never remove or alter that file.
- Vendored size: ~35 MB / ~1850 files.

## Excluded from the vendor (deliberate, not drift)

- `.git/` (156 MB history) — history stays upstream; the pin above is the reference.
- `assets/` (170 MB demo videos/GIFs/screenshots) — marketing media, zero build or
  runtime value.
- `target/`, `node_modules/` — build artifacts; excluded defensively (absent at pin time).

Everything else is byte-identical to upstream at the pinned commit except mausCode
patches listed below. Future syncs: re-vendor at a new pin, re-apply patches, record
here, re-run `cargo test -p jcode-harness-api` (needs Rust toolchain; CI-owned) and
`packages/runtime-client` check + live tests.

## mausCode patches (empty at vendor time)

None. The runtime is unmodified stock. The first expected patches (P1+, each with
its own OpenSpec change): `maus.*` extension handlers, node/daemon lifecycle flags
for desktop management, curated default tool policy. TUI crates (`jcode-tui-*`) are
never shipped by mausCode but stay compiling in the workspace.

## Boundaries

- Wire compatibility with `harness-api` v1 is mandatory; `docs/protocol.md` is the
  contract and this tree is its reference implementation.
- `packages/runtime-client` schema-parity tests resolve to
  `runtime/jcode/crates/jcode-harness-api/src` by default.
