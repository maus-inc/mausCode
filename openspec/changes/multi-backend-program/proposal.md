# Multi-backend program: one agnostic UI over 30+ backends

## Why
mausCode must work with any provider instead of locking into one. Each
backend keeps its native security and performance capabilities, self-reports
them through a capability manifest (tucked in Settings; only violations
surface in chat), and the renderer speaks one shared chunk dialect so
backends are added without UI changes. Upstream-first: verbatim ports +
harvest refs keep every integration re-appliable as CLIs evolve.

## What changes
- Provider foundation (DONE): `src/shared/provider-capabilities.ts` (zod
  manifest + pure violation evaluation), `src/main/lib/providers/`
  (interface + registry + codex/opencode profiles/probes), `providers` tRPC
  router, Settings Backends tab.
- Reference implementation (DONE): opencode adapter (`serve` + official
  SDK + SSE), router mirroring the codex surface, mock-server tests.
- Recipe + landscape (DONE): `docs/backend-porting-recipe.md` (recreatable
  cookbook), `.dump/app/backend-landscape-2026-09-11.md` (30+ CLI survey).
- Per-backend rollouts (QUEUED, in user priority order): claude align,
  hermes full-fidelity, cursor native print/stream-json, grok build,
  qwen (ACP first), cline (SDK), openclaw (gateway RPC), Kilo Code as the
  Roo substitute (Roo archived May 2026), then the wider CLI map.

## Non-goals
- No renderer changes per backend. No credential storage. No PTY scraping
  for core chat. No bundling proprietary binaries.
