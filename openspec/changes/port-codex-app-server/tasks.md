# Tasks: port-codex-app-server

- [x] 1. Regen attempt: FAILED (time-boxed) — sandbox blocks raw.githubusercontent (worked around via API envelope), then generator chokes on new `$ref` shape (`ApplyPatchApprovalParams__ThreadId`); generator shims are July-specific. FALLING BACK to July port; client tolerates unknown methods.
- [x] 2. Port 18 files to src/main/lib/codex-app-server/ + attribution; vitest green (17 .ts + fixture verbatim, README + session adapter mausCode-authored)
- [x] 3. Promote platform-node[-shared] to runtime deps (exact pins)
- [x] 4. Session module: Effect client bridged to promises, fingerprint keying, thread start/resume (+legacy session lookup, auto approvals, interrupt/dispose)
- [x] 5. Stream rewrite: turn/start + event→chunk mapping; keep tRPC surface, login, usage, MCP, cancel, persistence
- [x] 6. Remove codex-acp dep (+asarUnpack); KEPT acp-ai-provider (still used by gemini/cursor routers) and normalizer (shared with cursor) + coalescer (still used)
- [x] 7. Gates: tsc zero-delta, node--test, vitest (contracts + app-server), secrets; commit + push
