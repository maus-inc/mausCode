## 0. Meta

| Field | Value |
| --- | --- |
| Step | 03 of 45, the build gate in §11.2 row 2 |
| Area | ci, build |
| Risk | high |
| Depends on | {{S01}}, {{S02}} |
| Blocks | every later step |
| Estimate | medium, and mostly machine time |

## 1. Outcome

One clean run of the full sequence on a machine with real dependencies, recorded: install, `bun run build:runtime-client`, `bun run build` with a 4 GB heap, `package:mac` or `package:linux`, and the five gates. The numbers go in `.dump/app/benchmarks/2026-09-13-build-gate.md`. After this, no later step may claim a green gate it did not run, because the reference run exists.

## 2. Why it matters

The standing instruction was to finish the app build before the engine port. Today no step in the roadmap has an end-to-end build record, and the renderer build OOMs at the default heap, which is easy to misread as a code defect. Every perf claim in steps {{S30}} onward is measured against this run.

## 3. Evidence

| Fact | Path | Level | Measured |
| --- | --- | --- | --- |
| Renderer `vite build` OOMs under about 3 GB because monaco, mermaid and shiki are in the static graph; CI exports `NODE_OPTIONS=--max-old-space-size=4096` | `.dump/ci/second-brain.md` facts list, `.github/workflows/ci.yml` `build` job | E3 in CI, E2 local | this session reads |
| Native modules are rebuilt by `postinstall`, so `--ignore-scripts` is fine for gates and wrong for packaging | `package.json` `postinstall`, `CONTRIBUTING.md` | E1 | this session |
| `claude:download` and `codex:download` fetch and sha256-verify binaries into gitignored `resources/bin` | `package.json` scripts `2.1.45` and `0.137.0` pins | E1 | this session |
| The sandbox this plan was written in cannot run the renderer build | `.dump/app/plans/2026-09-12-jules-port-plan.md` §11.1 | recorded | do not retry locally |

## 4. Read first, and what already exists

`AGENTS.md` verification gate lists the commands verbatim; this step runs them and writes the record. `docs/ci-gotchas.md` records the environment traps so you can tell an environment failure from a code failure. The `package` CI job already does the full install plus binary download plus `electron-builder --dir`, so compare your local numbers with that job rather than inventing a new procedure.

## 6. Implementation plan

1. `bun install` with bun 1.4.x. If resolution fails, stop: this step exists to prove the tree, not to fight a proxy.
2. `bun run build:runtime-client`, then `NODE_OPTIONS=--max-old-space-size=4096 bun run build`. Record wall time per target and the emitted bundle bytes for main, preload and renderer chunks.
3. Run the gates: `bun x biome check .`, `npm run typecheck`, `npm run test`, `npm run test:node`, `npm run test:contracts`, `node scripts/ci/lint-changed.mjs`, `node scripts/ci/typecheck-ratchet.mjs`.
4. `bun run claude:download` and `bun run codex:download`, then `bun run package:linux` or `package:mac`. Record artifact names and sizes.
5. Launch the packaged binary once, with no API key configured, and confirm the local-only paths still work: window opens, project picker lists, settings open, sign-in reports unavailable rather than crashing.
6. Write `.dump/app/benchmarks/2026-09-13-build-gate.md` with the environment block, the command list, each number, and each failure. Label anything you could not run.

## 8. Boundaries

- Always: `NODE_OPTIONS=--max-old-space-size=4096` for the renderer build, and say when you forgot it and re-ran.
- Ask first: any change to `package.json` scripts, `electron-builder.yml` or a download pin. That is step {{S12}} or {{S32}}.
- Never: fix a build failure by adding a dependency, an override, or a `--legacy-peer-deps` flag to committed config.

## 10. Acceptance criteria

- [ ] `bun run build` exits 0 with the heap flag set, and the failure without it is recorded as an environment fact, not a defect.
- [ ] All five gates report passed with their counts: findings, errors, test files, tests.
- [ ] One unsigned artifact exists, `unpacked` or packaged, and its size is recorded.
- [ ] The app starts with no control plane configured and no key, and the local-only path is what you saw.
- [ ] The benchmark file exists and every number in it came from that run.

## 11. Verification

```sh
bun install
bun run build:runtime-client
NODE_OPTIONS=--max-old-space-size=4096 bun run build
bun x biome check . && npm run typecheck && npm run test
bun run package:linux
```

## 13. Rollback

No source change expected. If you must change something to get a green build, it is its own commit with its own gate run.

## 14. Out of scope

Fixing the renderer bundle size, which is step {{S30}}; signing and notarization, which the human refused outright on 2026-09-14 so no artifact is ever signed; the dependency bump, which is step {{S12}}.

## 15. Handoff notes

Update `.dump/app/plans/2026-09-12-jules-port-plan.md` §11.1 row "app build, then packaging" with the measured result and the date, so nobody re-derives it. If this step adopts any type under `src/shared/contracts/`, update its row in `.dump/app/plans/contracts-adoption.md` in the same commit; the ledger's measured baseline is 44 source files at 19,439 lines, 23 test files at 5,488 lines, and zero external importers.
