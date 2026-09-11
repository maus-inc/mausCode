/**
 * Pure helpers for the mcpServers sections of ~/.claude.json.
 *
 * Every function here takes an already-resolved `scope` and returns a new
 * config object, leaving its input untouched. Keeping this module free of
 * imports lets it be unit tested without pulling in the database or electron;
 * claude-config.ts owns scope resolution and wraps these.
 */

export interface McpServerConfig {
  command?: string
  args?: string[]
  url?: string
  authType?: "oauth" | "bearer" | "none"
  _oauth?: {
    accessToken: string
    refreshToken?: string
    clientId?: string
    expiresAt?: number
  }
  [key: string]: unknown
}

export interface ProjectConfig {
  mcpServers?: Record<string, McpServerConfig>
  [key: string]: unknown
}

export interface ClaudeConfig {
  mcpServers?: Record<string, McpServerConfig> // User-scope (global) MCP servers
  projects?: Record<string, ProjectConfig>
  [key: string]: unknown
}

/**
 * Copy `source` without `key`. Used instead of `delete` on a computed key,
 * which pushes the object onto the dictionary-mode hidden class.
 */
export function omitKey<T extends object>(source: T, key: string): T {
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(source)) {
    if (k !== key) next[k] = v
  }
  return next as T
}

/**
 * Read a server from the global (root-level) section when `scope` is null,
 * otherwise from that project's section.
 */
export function getMcpServerByScope(
  config: ClaudeConfig,
  scope: string | null,
  serverName: string
): McpServerConfig | undefined {
  if (scope === null) return config.mcpServers?.[serverName]
  return config.projects?.[scope]?.mcpServers?.[serverName]
}

/**
 * Return a copy of `config` with `update` merged into the named server,
 * creating the server entry if it does not exist yet.
 */
export function updateMcpServerByScope(
  config: ClaudeConfig,
  scope: string | null,
  serverName: string,
  update: Partial<McpServerConfig>
): ClaudeConfig {
  if (scope === null) {
    return {
      ...config,
      mcpServers: {
        ...config.mcpServers,
        [serverName]: { ...config.mcpServers?.[serverName], ...update },
      },
    }
  }

  const projectEntry = config.projects?.[scope]
  return {
    ...config,
    projects: {
      ...config.projects,
      [scope]: {
        ...projectEntry,
        mcpServers: {
          ...projectEntry?.mcpServers,
          [serverName]: { ...projectEntry?.mcpServers?.[serverName], ...update },
        },
      },
    },
  }
}

/**
 * Return a copy of `config` with the named server removed, or the *same*
 * reference when there was nothing to remove so callers can cheaply detect a
 * no-op. Hollow containers left behind are dropped rather than kept empty.
 */
export function removeMcpServerByScope(
  config: ClaudeConfig,
  scope: string | null,
  serverName: string
): ClaudeConfig {
  if (scope === null) return removeGlobalMcpServer(config, serverName)
  return removeProjectMcpServer(config, scope, serverName)
}

function removeGlobalMcpServer(
  config: ClaudeConfig,
  serverName: string
): ClaudeConfig {
  if (!config.mcpServers?.[serverName]) return config
  return { ...config, mcpServers: omitKey(config.mcpServers, serverName) }
}

function removeProjectMcpServer(
  config: ClaudeConfig,
  scope: string,
  serverName: string
): ClaudeConfig {
  const projectEntry = config.projects?.[scope]
  if (!projectEntry?.mcpServers?.[serverName]) return config

  const mcpServers = omitKey(projectEntry.mcpServers, serverName)

  // Drop the mcpServers key once it empties, so no hollow entry stays behind.
  const nextProject: ProjectConfig =
    Object.keys(mcpServers).length > 0
      ? { ...projectEntry, mcpServers }
      : omitKey(projectEntry, "mcpServers")

  // Same for the project entry itself when removing left nothing behind.
  const projects =
    Object.keys(nextProject).length === 0
      ? omitKey(config.projects ?? {}, scope)
      : { ...config.projects, [scope]: nextProject }

  return { ...config, projects }
}
