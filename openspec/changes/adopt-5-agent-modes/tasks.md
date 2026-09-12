# Tasks: adopt-5-agent-modes

- [x] 1. Core types: widen `AgentMode`, order `AGENT_MODES` plan/ask/edit/agent/turbo, add `mode-display.ts` (label/icon/tooltip)
- [x] 2. Widen zod enums (chats/claude/codex/runtime/cursor routers) + schema comment; no migration
- [x] 3. Widen renderer types (transports, store, cards, mock-api, analytics)
- [x] 4. Claude enforcement: port `detectDangerousDeletion` (reworded), add ask/edit/agent/turbo `canUseTool` branches + ask approval round-trip
- [x] 5. UI: refactor both mode dropdowns to render from `AGENT_MODES`, fix mode-switch revert, add `/ask` `/edit` `/turbo` slash commands
- [x] 6. Gates: tsc zero-delta, node--test, secrets scan; commit + push
