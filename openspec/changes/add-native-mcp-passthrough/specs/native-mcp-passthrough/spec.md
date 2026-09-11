# Capability: native-mcp-passthrough

## ADDED Requirements

### Requirement: Project MCP resolution for native sessions

The daemon host SHALL resolve the project MCP configuration using the same
files and precedence as the legacy path, and SHALL make the resolved servers
available to the native session.

#### Scenario: MCP tools appear on native

- WHEN a project configures an MCP server and the user flips the sub-chat to
  the native engine
- THEN the server's tools appear in the native session with the same
  names/shapes as on legacy, and MCP-backed prompts work unchanged.

### Requirement: Project scoping without cross-project leakage

MCP servers resolved for one project SHALL NOT be visible to native sessions of
another project, even though the daemon pool is shared. Scoping SHALL be
enforced by the injection mechanism, not by naming convention.

#### Scenario: Two projects stay isolated

- WHEN project A configures server X and project B configures server Y
- THEN a native session on A sees X and not Y, and a native session on B sees
  Y and not X.

### Requirement: Tolerant per-server failure

A server that cannot be resolved or reached SHALL fail individually with a
visible notice naming the server. The session SHALL still start with the
remaining servers.

#### Scenario: One server down

- WHEN project config lists two servers and one is unreachable at session start
- THEN the user sees a notice naming the failed server, and the session runs
  with the healthy server's tools.
