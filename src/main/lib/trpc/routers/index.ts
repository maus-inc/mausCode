import { router } from "../index"
import { projectsRouter } from "./projects"
import { chatsRouter } from "./chats"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { claudeUsageRouter } from "./claude-usage"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { ollamaRouter } from "./ollama"
import { codexRouter } from "./codex"
import { cursorRouter } from "./cursor"
import { devServerRouter } from "./dev-server"
// Transplanted from erenbertr/1code (Apache-2.0): provider + usage routers
import { geminiRouter } from "./gemini"
import { openrouterRouter } from "./openrouter"
import { githubRouter } from "./github"
import { terminalRouter } from "./terminal"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
import { debugRouter } from "./debug"
import { skillsRouter } from "./skills"
import { agentsRouter } from "./agents"
import { worktreeConfigRouter } from "./worktree-config"
import { sandboxImportRouter } from "./sandbox-import"
import { commandsRouter } from "./commands"
import { voiceRouter } from "./voice"
import { pluginsRouter } from "./plugins"
import { runtimeRouter } from "./runtime"
import { usageRouter } from "./usage"
import { createGitRouter } from "../../git"
import { BrowserWindow } from "electron"

/**
 * Create the main app router
 * Uses getter pattern to avoid stale window references
 */
export function createAppRouter(getWindow: () => BrowserWindow | null) {
  return router({
    projects: projectsRouter,
    chats: chatsRouter,
    claude: claudeRouter,
    claudeCode: claudeCodeRouter,
    claudeSettings: claudeSettingsRouter,
    claudeUsage: claudeUsageRouter,
    anthropicAccounts: anthropicAccountsRouter,
    ollama: ollamaRouter,
    codex: codexRouter,
    cursor: cursorRouter,
    devServer: devServerRouter,
    gemini: geminiRouter,
    openrouter: openrouterRouter,
    github: githubRouter,
    terminal: terminalRouter,
    external: externalRouter,
    files: filesRouter,
    debug: debugRouter,
    skills: skillsRouter,
    agents: agentsRouter,
    worktreeConfig: worktreeConfigRouter,
    sandboxImport: sandboxImportRouter,
    commands: commandsRouter,
    voice: voiceRouter,
    plugins: pluginsRouter,
    runtime: runtimeRouter,
    usage: usageRouter,
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
