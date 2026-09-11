# roo-print

Native headless runner for the Roo Code CLI (`roo -p --output-format
stream-json`), ours, NOT verbatim. One process per turn; prompt via
`--prompt-file`; transcript-in-prompt for continuity (resume rejects
prompt upstream).

Source-verified against RooCodeInc/Roo-Code at cli-v0.1.17 (repo
archived 2026-05-15, CLI frozen). Primary sources: `apps/cli` (run
flags, validation, stream protocol), `packages/types/src/cli.ts`
(event zod schemas), `agent/json-event-emitter.ts` (emission
mechanics), `src/api/providers/*` (model-id handling),
`src/services/mcp/McpHub.ts` (MCP schema + paths).

## Files

- `args.ts` — argv builder (`-p --output-format stream-json -w
  --provider -m --mode --prompt-file`), mode map, prompt-file writer,
  auth-error classifier.
- `session.ts` — NDJSON projector to UIMessage chunks (text dedupe,
  Thinking protocol, tool/command/mcp correlation, cost capture).
  Never emits message-metadata/finish; the router owns completion.
- `auth-config.ts` — provider env map, cli-settings reader,
  ambient-auth probe, provider-scoped model tables.
- `mcp-config.ts` — global + project `mcpServers` file readers.

## Contract notes

- Exit 0 ok / 1 error; `[CLI] Error: ...` pre-run validation on
  stderr; SIGINT→130 / SIGTERM→143 graceful.
- Print runs auto-approve (no `-a` passed, posture session-auto).
- Unknown `-m` ids silently fall back to the provider default for
  anthropic/openai-native/gemini; openrouter/vercel pass `-m`
  through verbatim. Only verified ids are offered.
- Generic tool outputs are not emitted upstream; open calls close
  output-less at settle (never synthesized).
- `result.content` duplicates streamed text; projected only when the
  turn streamed zero assistant text.
