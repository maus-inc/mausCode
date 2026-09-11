# Pin @pierre/diffs to locked 1.0.10 (2026-09-11)

## Decision
`@pierre/diffs`: `^1.0.10` -> exact `1.0.10` in package.json (matches
`bun.lock`).

## Why
The renderer production build failed with `Missing "./ayu-light" specifier
in "@shikijs/themes"`. Root cause chain (verified in the working tree):

- Installed `@pierre/diffs` had floated to 1.4.2 via the `^` range; the
  lockfile pins 1.0.10, which predates the `@pierre/theming` dependency.
- 1.4.2 pulls `@pierre/theming`, which dynamic-imports
  `@shikijs/themes/<name>` for `^3.0.0 || ^4.0.0`.
- npm hoisted `@pierre/theming` to the top level with no nested
  `@shikijs/themes@3/4`, so resolution fell through to the top-level
  `@shikijs/themes@1.29.2`, which no longer exports `./ayu-light`.

Downgrading to the locked 1.0.10 removes the theming chain; the
module-resolution error is gone. The fix restores lockfile intent, so bun
users are unaffected (lock already says 1.0.10).

## Verified
- `electron-vite build`: main + preload bundles green; renderer gets past
  module resolution (full prod bundle then OOMs on this 4GB sandbox — an
  environment limit per PA-6, needs a CI-class machine).
- Gates after the pin: tsc 25 = baseline, vitest 45/45 (affected),
  contracts 382/382, renderer files esbuild-clean.

## Reversal
Delete the pin (restore `^1.0.10`) once upstream `@pierre/diffs` + shiki
resolve consistently, or once the tree is managed by bun + an updated lock.
