# P1 verification record (`add-native-local-execution`, commit `e482f5e`)

Date: 2026-09-11. Track: app (`arena/01a08de4-mauscode`). Status: static
verification complete; live verification (dev machine/CI) still open.

## Environment

Sandbox only: node available; no bun, no Electron binary, no display. There is
no dev machine in this session, so the Electron smoke test (engine toggle,
native message send, legacy-path confirmation, live quit/reload guards) and
all performance measurement were NOT run here. No numbers below are performance
claims; the benchmark gate stays CLOSED.

## Static verification (this session, all at `e482f5e`)

- Unit tests: 13/13 green (`node --test --experimental-strip-types` on
  `src/main/lib/runtime/translate.test.ts` + `manager.test.ts`), incl. a real
  daemon launch and cross-restart session persistence. No stray daemons left
  (`pkill` guard after each run).
- Typecheck (`tsc --noEmit`): zero errors in any P1-new file. Touched legacy
  files show only baseline-confirmed pre-existing errors (proven by
  stash-compared runs during P1; e.g. `chat-input-area.tsx` unused
  `@ts-expect-error`, `index.ts` `app.dock`). Repo-blessed `ts:check` (tsgo)
  cannot run: binary not installed in this env.
- Main-process bundle: `npm run build` emits `out/main/index.js` containing
  the P1 runtime code (verified: `NativeTranslator`, `NATIVE_STARTUP_FAILED`
  present) — main + preload bundles succeed.
- Renderer bundle: BLOCKED pre-existing. Both HEAD and stash-baseline builds
  fail identically on `Missing "./ayu-light" specifier in "@shikijs/themes"`
  (npm-resolved tree vs `bun.lock`; unrelated to P1 — no P1 file touches
  shiki). CI/dev (`bun install`) must confirm the renderer bundle.
- Quit/reload guards (wiring audit by inspection, 10 sites): quit-confirm and
  reload-confirm in `src/main/index.ts` (2 conditions + 3 aborts incl.
  `before-quit` daemon shutdown), Cmd+Shift+R intercept + window-close confirm
  in `src/main/windows/main.ts` (2 conditions + 3 aborts). All call
  `hasActiveNativeTurns()` / `abortAllNativeTurns()`. Live firing untested.
- Legacy non-interference (diff audit): `claude`/`codex` routers untouched
  except shared-helper dedup (safeStorage → `token-crypto.ts`, identical
  logic); IPC transport refactor is a verbatim move onto shared helpers;
  selection order keeps remote/codex ahead of native; engine flag defaults to
  `legacy`. No legacy behavior change by construction; live confirmation open.
- Package identity: `package.json` name untouched (`21st-desktop`); workspace
  dep is `@maus-inc/runtime-client` per standing provisional names. No renames
  performed (held for the naming decision).

## OpenSpec validation gap

`openspec validate --strict` was NOT run for `add-native-local-execution` or
any new scaffold: the CLI is unobtainable from verified sources (prior finding
in `decisions/2026-09-11-openspec-cli.md`: npm `openspec` is a stub,
`@openspec/cli` doesn't exist, `github.com/openspecio/openspec` 404s). Every
change's `tasks.md` carries a validation task for an environment with the CLI.
Scaffolds were matched to `openspec/AGENTS.md` by hand (proposal/tasks/design-
where-needed/delta specs with ≥1 Scenario per requirement).

## Still open (dev machine / CI owned)

1. `bun install` then Electron smoke: toggle Native on an empty chat, send a
   message, confirm legacy paths unaffected, confirm quit/reload guards fire.
2. Renderer bundle success under the bun-resolved tree.
3. Benchmarks vs Claude path (cold start, first-token, create/resume, RSS) —
   gate numbers; regressions block.
4. Live daemon kill/re-attach (crash recovery) test.
5. `openspec validate --strict` on all six changes where the CLI exists.
6. Live approval-path verification — blocked until the runtime permissions
   patch (see `add-runtime-permissions`) is approved AND implemented.
