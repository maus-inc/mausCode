## 0. Meta

| Field | Value |
| --- | --- |
| Step | 30 of 42, CI phase 2, plus the plan's performance gate |
| Area | build, renderer, ci |
| Risk | medium |
| Depends on | {{S03}}, {{S29}} |
| Blocks | {{S32}} |
| Estimate | medium |

## 1. Outcome

The renderer build stops needing more than 2.5 GB of heap, every chunk has a recorded byte budget that CI checks, and the build and runtime benchmark harness exists so later steps quote a number instead of an opinion.

## 2. Why it matters

The renderer build OOMs at the default Node heap and needs the 4 GB override CI exports, and the cause is structural rather than incidental: `electron.vite.config.ts` has `rollupOptions` for all three targets and no `manualChunks` anywhere, verified this session, and the renderer contains 17 static imports of mermaid, monaco, shiki or streamdown against **zero** `lazy(` calls, verified this session. One graph holds every heavy viewer, so every developer machine pays the memory, CI pays the time, and the app ships code a first paint never uses. The same missing discipline is why bundle and asset claims in this repository are anecdotal.

## 3. Evidence

| Fact | Value | Path |
| --- | --- | --- |
| No chunking config | `grep -n "manualChunks" electron.vite.config.ts` returns nothing | E3, this session |
| No lazy boundaries in the renderer | `grep -rn "lazy(" src/renderer --include=*.tsx` returns 0 | E3, this session |
| 17 static heavy-viewer imports | mermaid, monaco, shiki, streamdown across `src/renderer` | E3, this session |
| Renderer build OOMs at 2 GB and 2.5 GB, needs 4 GB | `.dump/ci/second-brain.md` facts list, `.dump/ci/research/repository-infrastructure-audit.md` §2 and §6 | recorded, reproduced in CI |
| `src/renderer/assets` is 2.3 MB, of which fonts are 2.1 MB across 20 files and app icons 184 KB | `du -sh src/renderer/assets/*` | E3, this session |
| Main bundle was 865 kB and preload 11.95 kB in the last recorded build | `.dump/ci/research/repository-infrastructure-audit.md` §6 | recorded |
| The benchmark harness for the runtime exists and is runnable from the repo root | `benchmarks/runtime-harness/stock-baseline.mjs`, results in `.dump/app/benchmarks/2026-09-11-stock-jcode-sandbox.md` | E1, this session |

## 4. Read first, and what already exists

`.dump/ci/plans/initial-ci-plan.md` phase 2, which already specifies build-time and RSS wrappers, a renderer chunk budget and main-process micro benchmarks; and `docs/design-system-baseline.md` before changing any loading affordance, since a lazily loaded viewer that flashes is a UI regression, not a win.

## 6. Implementation plan

1. Baseline first, before touching config: record build wall time per target, peak heap during the renderer build, and bytes per emitted chunk, into `.dump/app/benchmarks/2026-09-13-renderer-before.md`.
2. Split the graph. Move each viewer, monaco, mermaid, shiki and the diff renderer, behind a dynamic import at its mount point, and add explicit `manualChunks` for those vendors so a chunk boundary is a decision rather than a rollup accident.
3. Fonts: 2.1 MB across 20 files is the largest single asset group. Keep the weights actually used, subset the rest, and record the byte delta, which is the rule `AGENTS.md` already states.
4. Wrap the build in a measurement script that prints time and peak RSS per target, and fail the job when a chunk exceeds its recorded budget unless the PR carries an updated budget with a reason.
5. Add the main-process micro benchmarks the CI plan named, headless: migration time, `git status` on a synthetic fixture, terminal data-batcher throughput, router cold init.
6. Wire all of it into the `quality` job, in the same PR as the ratchet file it writes, and make the failure message print the exact command that reproduces it.
7. Re-run the renderer build at the default heap and record whether it now fits. If it still needs more than 2 GB, say so with the number rather than hiding behind the flag.

## 8. Boundaries

- Always: measure before and after, and keep the budget file as the only place a number lives.
- Ask first: any change to the design system's loading treatment, and any new dependency such as a subsetting tool, which needs step 29's pin discipline.
- Never: raise a budget to make CI green without a reason in the PR, delete a viewer to hit a number, or add a suppression to silence a lint finding produced by the restructure.

## 10. Acceptance criteria

- [ ] `bun run build` completes with the default heap on a machine with 4 GB, and the record shows the peak it used.
- [ ] First paint loads no monaco, mermaid or shiki chunk, proven by the emitted chunk list and a network trace of a cold start.
- [ ] The renderer assets are under a recorded number that includes the font decision.
- [ ] CI fails when a chunk grows past its budget, demonstrated by a red run on a deliberate overage attached in the PR.
- [ ] The micro benchmarks print comparable numbers on two consecutive runs, with their variance stated.

## 11. Verification

```sh
NODE_OPTIONS=--max-old-space-size=4096 bun run build
node scripts/ci/bundle-budget.mjs      # the script you add here
npm run test && bun x biome check .
```

## 12. Benchmark record

This step is itself the record. Both files, before and after, stay in `.dump/app/benchmarks/`, and the after file names the chunk sizes per viewer.

## 13. Rollback

`manualChunks` and the dynamic imports revert cleanly together. The budget script can land first and report without failing, which is the safer order if you want the baseline committed alone.

## 14. Out of scope

Runtime protocol and engine benchmarks beyond the existing harness, the packaging matrix, and any visual redesign of the loading state beyond what the baseline document requires.

## 15. Handoff notes

Update `.dump/ci/second-brain.md` so the 4 GB note becomes "CI sets it; the tree fits by default since step 30", and record the budget file's location so no later step invents a second budget.
