# Working plan — MausAgent (foundation track)

## Role in the parallel setup

Three independent agents share this repo; I assume nothing about their branches.
To minimize merge-conflict surface, this track owns **foundation + protocol-facing
groundwork** and avoids touching the same product files others are likely
rebranding/restructuring:

- `.dump/app/` — my second brain (exclusive to the app track).
- `UPSTREAM.md`, `docs/protocol.md`, `docs/architecture.md`, `docs/vision.md`,
  `benchmarks/` — proposed new files (low conflict risk; will coordinate via human
  if another agent claims them).
- No edits to `src/` until the protocol draft exists, except read-only inspection.

## Sequence

1. [x] Assimilate source-of-truth doc → `00-thesis.md`.
2. [x] Baseline inventory → `01-baseline-inventory.md`.
3. [ ] Recover upstream SHAs (1Code archive state; JCode vendor point) → `UPSTREAM.md`.
4. [ ] Draft `docs/vision.md` (product thesis, one page + non-goals).
5. [ ] Draft `docs/architecture.md` (seam diagram, RuntimeProvider, device layer,
   control-plane boundary) — after reading JCode + T3/Hermes sources.
6. [ ] Draft `docs/protocol.md` v0 (envelope, hello/capabilities, workspace, session,
   message, tool, approval, terminal, fs, git, events) — the source of truth.
7. [ ] Upstream research notes: JCode harness API doc, T3 remote/t3-connect docs,
   Hermes backends, OpenCode session model → `.dump/app/research/`.
8. [ ] Establish `benchmarks/` harness skeleton + record 1Code-baseline numbers that
   are measurable without bun (tsgo check time, bundle size; runtime benches need
   the JCode vendor step).
9. [ ] OpenSpec proposal for the protocol (`add-runtime-protocol-v0`) once the human
   confirms direction — spec work follows `openspec/AGENTS.md`.

## Explicitly NOT doing on this track (yet)

- Renaming product/branding strings in `src/` (likely another agent's track; also
  needs the human's wordmark/default decisions first).
- Vendoring JCode (needs SHA decision + human call on MIT-attribution placement).
- Touching the `allowDangerouslySkipPermissions` call site (needs the fresh
  permission-model design; will flag, not patch).
- Adding dependencies (bun not present in sandbox; protocol work is doc-first).

## Risks

- Parallel-agent file collisions on `docs/*` and `UPSTREAM.md` — mitigate by keeping
  drafts in `.dump/app/` until the human confirms ownership.
- 1Code baseline SHA may be unrecoverable from this checkout (single squashed init
  commit) — fallback is documenting init SHA + archive date + tree hash.
- No bun in sandbox limits build/test verification — mitigate with node-based checks
  and explicit documentation of what was/wasn't verified.

## Questions for the human (user-facing only, batched)

1. Wordmark: which of the 5 PNGs in `new mauscode branding/` is canonical, or is a
   new mark coming? (Blocks visual-identity work, not protocol work.)
2. Package/app identity: `mauscode` CLI name and app id (e.g. `dev.maus-inc.mauscode`)?
   Blocks the strip-21st rename.
3. JCode vendor form: git subtree/submodule vs copied tree under `runtime/jcode`?
   (Affects history preservation + MIT attribution placement.)
