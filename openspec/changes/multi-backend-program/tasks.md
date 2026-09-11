# Tasks: multi-backend-program

- [x] 1. Deep research: backend landscape (protocols, auth, resume, cancel, MCP, licenses) + primary sources
- [x] 2. Recipe: docs/backend-porting-recipe.md (scaffold/session/chunks/permissions/router/manifest/mock/gates/edge cases)
- [x] 3. Foundation: capability schema + provider interface/registry + providers router + Settings Backends tab
- [x] 4. Reference backend: opencode adapter + router + mock tests + README (serve/SDK/SSE, file:// images, native usage)
- [x] 5. Gates: tsc zero-delta (25), vitest 45/45 (affected) + 427/427 full, contracts 382/382, runtime 27/27, secrets clean, build main+preload green (renderer prod bundle OOMs on 4GB sandbox — env limit); line-by-line diff review; @pierre/diffs pinned to locked 1.0.10 (see .dump/app/decisions/pin-pierre-diffs-2026-09-11.md); commit + push
- [ ] 6. NEXT: claude align (existing SDK router -> provider interface + manifest, no rewrite)
- [ ] 7. NEXT: hermes full-fidelity (ACP chat + cron/skills/plugins/memory/gateway surfaces in manifest)
- [ ] 8. NEXT: cursor native (print/stream-json/resume upgrade from ACP path)
- [ ] 9. NEXT: grok build (official CLI recon; community grok-cli fallback)
- [ ] 10. NEXT: qwen via ACP, then SDK when stable (serialize config-file MCP injection)
- [ ] 11. NEXT: cline via @cline/sdk (Agent run/continue, tools, plugins, hooks)
- [ ] 12. NEXT: openclaw via loopback gateway RPC (sessions, skills, cron stay native)
- [ ] 13. NEXT: Kilo Code (OpenCode-based CLI; reuse opencode adapter) as Roo substitute — needs human ack
- [ ] 14. LATER: wider CLI map per recipe (gemini, aider, crush, goose, copilot, amp, mistral vibe, kiro, gptme, sgpt, llm, mods, local servers)
