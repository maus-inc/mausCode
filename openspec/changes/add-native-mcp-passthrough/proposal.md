# Change: add-native-mcp-passthrough

## Why

Native sessions run in the daemon with its own config, so project MCP servers
configured for the legacy path are invisible on native: MCP tools don't appear,
and MCP-backed workflows silently lose capabilities when the user flips the
engine toggle. This change makes the native session's MCP configuration visible
again.

## Evidence that reshaped this change

Live probing proved two decisive facts:

1. The daemon resolves project MCP **itself** at subscribe time (log:
   `MCP: Found 1 server(s)` + `register_mcp_tools=true` with a project
   `.mcp.json`). There is nothing to "inject" — no per-session attach surface
   is needed for stdio servers; the earlier injection-mechanism question is
   moot for Phase 1.
2. The v1 harness exposes **zero** MCP surface: no MCP events/requests, the
   bridge drops `McpStatus`, `Attached` carries `SessionInfo` only, and no
   request enumerates tools. Live connect state (connecting/failed/needs-auth,
   late-registered tools) is unknowable app-side without a Rust relay.

## What changes

- Phase 1 (this change, TS only, implemented): the app mirrors the daemon's
  own `McpConfig::load_for_dir` resolution over the same files and precedence
  (jcode global → `~/.claude.json` + per-project entries → legacy Claude
  global → project `.jcode/mcp.json` → `.mcp.json` → `.claude/mcp.json`, with
  the preferring-runnable collision rule and the `disabled`-wins enabled rule)
  and reads connection evidence from the daemon's version-gated
  `mcp-schema-cache.json`. Servers show as `connected` (cached tool schemas)
  or `pending` (configured, no cache evidence yet); unparseable files surface
  as config-failure notices; the session still starts either way.
- Phase 2 (future Rust, specified here, not implemented): bridge relay of
  `McpStatus` + a tool snapshot so live failures, needs-auth, and
  late-registered tools become visible. Needs a Rust-capable environment.
- Renderer parity: cached MCP tools appear as `mcp__server__tool` names in the
  native tool list and the existing MCP panels/widgets with zero
  transport-specific rendering (only an honest "full tool list unavailable"
  note, owned by `add-native-session-init`).

## Non-goals

- No new MCP protocol features; no changes to MCP server implementations.
- No MCP OAuth flow changes (existing auth flows are reused as-is).
- No remote-placement MCP (local daemon only; placements inherit later).
- No `failed`/`needs-auth` statuses in Phase 1 (unknowable without the relay;
  never guessed).

## Impact

- Additive: `mcp-config.ts` mirror + 7 tests; consumed by the session-init
  snapshot. No daemon, protocol, or legacy-path changes.
- The daemon's own behavior is unchanged: it already resolves and connects
  project MCP; Phase 1 only reports what the app can independently verify.
