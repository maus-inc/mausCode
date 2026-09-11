# Upstream Provenance

mausCode is a new product by **maus-inc**. It is **not** a fork left in the wild: it is a new
agent workspace whose product/UI foundation was inherited from an archived open-source
project and whose planned native runtime is derived from a separately-licensed foundation.
This file is the authoritative record of what was inherited, from where, and under what terms.

## 1. Product/UI foundation — 1Code (Apache-2.0)

| Field | Value |
|---|---|
| Upstream project | [21st-dev/1code](https://github.com/21st-dev/1code) |
| License | Apache License 2.0 (see `LICENSE`) |
| Upstream state | Archived (read-only) since 2026-07-07 |
| Baseline commit | [`9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e`](https://github.com/21st-dev/1code/commit/9f1bc76fa4372c18c565b5a4f8daf38ae3595f0e) — "Release v0.0.72", the final commit on `main` |
| Baseline verification | The verbatim upstream commit is present in this repository's `main` branch history (same SHA, same tree); this branch's import (`6b0de32`, "original project init context") matches upstream v0.0.72 exactly apart from the `.dump/` documentation workspace and branding assets |
| Import into mausCode | commit `6b0de32c1c0a2015ed67591fb623ac0ca47a4d3b` |

The inherited code is the entire Electron/React application under `src/`, the build
tooling (`electron.vite.config.ts`, `electron-builder.yml`, `scripts/`), the Drizzle schema
and migrations (`drizzle/`), and the packaging assets. Inherited modules retain their
original behavior; mausCode changes are layered on top (see the modification record below).

### Attribution obligations honored (Apache-2.0 §4)

- **§4(a)** — `LICENSE` (Apache-2.0 full text) is retained at the repository root.
- **§4(b)** — files modified by mausCode carry the mausCode identity; this file plus `NOTICE`
  state the modification history at the repository level.
- **§4(c)** — all upstream copyright and attribution notices are preserved: the original
  authorship of the 1Code codebase is credited in `NOTICE`, this file, and the README.
  mausCode does **not** claim upstream authorship and does not alter upstream credits.
- **§4(d)** — `NOTICE` exists and carries the upstream attribution notices.

## 2. Native runtime foundation — JCode (MIT)

The product thesis (see `new mauscode branding/original chat context leading to creation.md`)
is that mausCode's native execution engine is a runtime **derived and refined from JCode**:

- Upstream project: [1jehuang/jcode](https://github.com/1jehuang/jcode)
- License: MIT
- Status in this repository: **not yet vendored.** JCode is the designated runtime
  foundation; integration is a future workstream. When its code lands, it will be vendored
  with its MIT license file and copyright notices intact, under a dedicated directory, and
  recorded here.
- Public naming: the runtime is presented to users as the **mausCode Runtime** (see
  `.dump/rebrand/decisions/naming-system.md`); "JCode" remains the foundation's name in
  provenance documentation only.

## 3. What was deliberately NOT inherited

- **21st.dev / 1code.dev hosted services** — sign-in, changelog, auto-update CDN, automations,
  and sandbox mode previously pointed at the upstream company's infrastructure. All such
  endpoints were removed in the identity rebrand (2026-09-11). The app now runs in
  local-only mode by default; a mausCode control plane will be configured via
  `MAIN_VITE_API_URL` / `MAIN_VITE_UPDATE_FEED_URL` when it ships (see
  `.dump/rebrand/decisions/open-decisions.md`, D4).
- **21st-specific release tooling** — `scripts/sync-to-public.sh` (synced 21st's private repo
  to the public one) and the R2/wrangler upload steps were removed as out-of-scope
  infrastructure.
- **Security posture of inherited execution permissions** — the archived upstream project has
  a documented critical permission-bypass issue ([21st-dev/1code#104](https://github.com/21st-dev/1code/issues/104)).
  Per the product thesis, inherited agent/permission behavior is treated as **untrusted until
  re-audited**; that audit belongs to the security workstream, not to the rebrand.

## 4. Modification record (mausCode changes to inherited code)

| Area | Change | Why |
|---|---|---|
| Identity | All 1Code/21st branding, metadata, protocols, paths, and service endpoints replaced with the mausCode system | New product identity (rebrand, 2026-09-11) |
| `src/main/lib/config.ts` | Control-plane base URL centralized; empty default = local-only | Root-cause removal of 21st service assumptions |
| `src/main/lib/auto-updater.ts` | Update feed env-gated; off by default | Never update from the upstream CDN |
| `src/main/windows/main.ts` | Trusted IPC origins derived from configured API base | No hardcoded foreign domains |
| `src/main/lib/git/worktree-config.ts`, `src/main/lib/claude-config.ts`, `src/shared/worktree-paths.ts` | New `~/.mauscode/worktrees` + `.mauscode/worktree.json`; legacy `~/.21st` / `.1code` kept read-only | New data locations with migration-friendly detection |
| `src/renderer/lib/themes/*`, `src/renderer/lib/atoms/index.ts` | Default theme ids renamed `mauscode-dark/light` | Product identity (no visual change) |
| `src/renderer/components/ui/logo.tsx` + assets | Official mausCode glyph replaces the inherited mark | Brand assets provided by maus-inc (`new mauscode branding/`) |

## 5. Branding assets

The official mausCode logo files live in [`new mauscode branding/`](new%20mauscode%20branding/).
The app glyph is derived from `logo-tranparentbackgroundblacklogo.png.png` (256px palette PNG
at `src/renderer/assets/logo-mauscode.png`). App icons (`build/icon.*`) are still the
inherited 1Code icons pending the visual-identity workstream.
