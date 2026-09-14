# `mock-api.ts` stays, and the plan that called it dead is corrected

Decision taken 2026-09-14 by roadmap step 01, issue #3, on
`arena/01a09f45-mauscode` at `7c89af0`.

## Decision

`src/renderer/lib/mock-api.ts` is KEEP. It is not deprecated and it is not dead code.

## What contradicted it

Two `.dump` files disagreed, and roadmap section 5 carried the disagreement as an
open item for step 01 to settle.

`.dump/app/research/current-system-map.md` section 18 said KEEP, because the file is
"actively imported by 6 chat UI files".

`.dump/app/plans/mauscode-architecture-plan.md` P0 said to "kill dead code
(`credential-manager.ts`, mock-api) after confirming zero refs".

## Measurement

`grep -rln "mock-api" src/renderer` returns five files, one of which is the module
itself. The four importers are:

- `src/renderer/features/agents/main/active-chat.tsx:61`
- `src/renderer/features/agents/mentions/agents-file-mention.tsx:23`
- `src/renderer/features/agents/ui/agents-content.tsx:44`
- `src/renderer/features/agents/ui/sub-chat-selector.tsx:34`

Four is not zero, so the plan's own precondition fails. The system map's verdict was
right and its count was wrong: it said six, and six is not what the tree holds.

## Why the archive plan's reasoning failed

The plan gated deletion on confirming zero references. That gate was never run against
this tree. The corpus then carried the deletion as an intended act, and two documents
ended up asserting opposite verdicts about one module. The rule that resolves it is
already written down in `AGENTS.md`: the tree wins.

## What changed as a result

- `CLAUDE.md` no longer labels the file DEPRECATED. It reads as the live tRPC
  stand-in with four importers.
- The system map's section 18 row names the four importers and the section 2 dead
  code note is corrected in the same pass.
- `.dump/app/plans/mauscode-architecture-plan.md` P0 now records the measurement
  rather than the intended deletion.
- Roadmap section 5 can close the row it opened.

## Rejected

Deleting the file and rewiring the four importers onto the real tRPC client. That is
a renderer change with its own test surface, it is not a docs change, and no roadmap
step owns it. If someone wants it, it needs a step, and the four importers are listed
above so the step can be sized.

Deleting `credential-manager.ts` again. That one was genuinely dead and it is already
gone, so the architecture plan's reference to it is spent rather than pending.
