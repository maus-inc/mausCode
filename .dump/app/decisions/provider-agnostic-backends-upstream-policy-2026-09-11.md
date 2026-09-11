# Provider-agnostic backends + upstream update policy

Date: 2026-09-11. Provenance: user direction — one agnostic UI over many
backends, every backend reporting its security/performance capabilities, no
provider lock-in, upstream updates always applicable. Proven by the
`port-codex-app-server` migration (commit `c487bde8`), which swapped codex
from ACP to native app-server with the renderer untouched.

## Layering (dependencies point one way only)

1. **Harvest ref (pristine).** Upstream T3 snapshot at `refs/harvest/t3code`.
   Never edited, never merged into main history, never imported by the build.
2. **Port layer (verbatim + attribution header).** Mechanical copies:
   `src/shared/contracts/` (Phase 4), `src/main/lib/codex-app-server/src/`
   (July schema). Byte-identical to upstream except the header comment.
   Effect boundary: ONLY these two trees may import `effect/*`
   (see `effect-adoption-t3-layers-2026-09-11.md`).
3. **Adapters (mausCode-authored, marked NOT verbatim).** e.g.
   `src/main/lib/codex-app-server/session.ts`. Promise-based sessions,
   server-request policy, event→chunk translation, lifecycle.
4. **Provider routers (tRPC).** One per backend (`codex`, `claude`,
   `gemini`, `cursor`, `openrouter`). Each translates its native protocol
   into the shared chunk dialect (AI-SDK UIMessageStream shapes).
5. **Renderer.** Speaks only the shared dialect + shared contracts. Never
   imports a provider SDK, never branches on provider internals.

## Anti-lock-in rule

Adding or replacing a backend = writing a layer-3/4 translator. The UI
is never modified for a backend change. Provider SDKs and binaries live
only in the main process.

## Upstream update runbook

1. Fetch upstream into a new harvest ref (keep the old one for diffing).
2. Diff old vs new harvest for the ported paths only.
3. Mechanical re-port (script-assisted copy + header check). Never hand-edit
   generated files; regen attempts use the pinned matching generator and are
   time-boxed (July regen failed on new `$ref` shapes — see adapter README).
4. Gates must pass: tsc zero-delta vs baseline, vitest (contracts +
   app-server), runtime node--test, secrets sweep.
5. Adapter compat: additive drift is absorbed by unknown-method tolerance
   (`handleUnknownServer*`); breaking changes get an adapter patch + test.
6. Record the new ref + what changed in the port log (adapter README).

## Capability reporting (PLANNED, not yet implemented)

Each adapter self-reports a capability profile over tRPC against one shared
zod schema in `src/shared/contracts`: auth methods, approval/sandbox
posture, data egress/retention, local-only compatibility, streaming, tool
support, attachments, resume, context limits, latency class. The UI adapts
from the manifest (badges, disabled controls); guardrails refuse backends
that don't meet policy. Rule: if a backend can't report a capability, the
UI must not offer it — no silent special powers.
