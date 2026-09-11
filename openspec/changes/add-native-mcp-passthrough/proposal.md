# Change: add-native-mcp-passthrough

## Why

Native sessions run in the daemon with its own config, so project MCP servers
configured for the legacy path are invisible on native: MCP tools don't appear,
and MCP-backed workflows silently lose capabilities when the user flips the
engine toggle. This change resolves the project's MCP configuration and makes
it available to native sessions.

## What changes

- Resolution: the daemon host reads the same project MCP configuration the
  legacy path uses (same files, same precedence) for the session's project.
- Injection: resolved servers are made available to the native session via the
  daemon's config surface (mechanism decided at implementation: daemon-level
  config file vs per-session attachment; the daemon owns a shared MCP pool, so
  the design must say how project scoping is preserved).
- Renderer parity: MCP tools appear in the native tool list and the MCP panels
  with the same names/shapes as legacy (no transport-specific tool rendering).
- Failure behavior: an unresolvable/unreachable MCP server fails that server
  with a visible notice; the session still starts (matches legacy tolerance).

## Non-goals

- No new MCP protocol features; no changes to MCP server implementations.
- No MCP OAuth flow changes (existing auth flows are reused as-is).
- No remote-placement MCP (local daemon only; placements inherit later).

## Impact

- Additive: resolution + injection in the daemon host, no UI changes expected.
- Daemon MCP pool is shared across sessions — the design must preserve project
  scoping (no cross-project tool leakage); the spec below makes this a
  requirement, not an aspiration.
- Approval requested before implementation.
