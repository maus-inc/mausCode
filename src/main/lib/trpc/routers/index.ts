import type { BrowserWindow } from "electron"
import { createGitRouter } from "../../git"
import { router } from "../index"
import { agentsRouter } from "./agents"
import { anthropicAccountsRouter } from "./anthropic-accounts"
import { chatsRouter } from "./chats"
import { claudeRouter } from "./claude"
import { claudeCodeRouter } from "./claude-code"
import { claudeSettingsRouter } from "./claude-settings"
import { claudeUsageRouter } from "./claude-usage"
import { clineRouter } from "./cline"
import { codexRouter } from "./codex"
import { commandsRouter } from "./commands"
import { cursorRouter } from "./cursor"
import { debugRouter } from "./debug"
import { devServerRouter } from "./dev-server"
import { terminalRouter } from "./terminal"
import { externalRouter } from "./external"
import { filesRouter } from "./files"
// Transplanted from erenbertr/1code (Apache-2.0): provider + usage routers
import { geminiRouter } from "./gemini"
import { githubRouter } from "./github"
import { grokRouter } from "./grok"
import { hermesRouter } from "./hermes"
import { ollamaRouter } from "./ollama"
import { openclawRouter } from "./openclaw"
import { opencodeRouter } from "./opencode"
import { openrouterRouter } from "./openrouter"
import { pluginsRouter } from "./plugins"
import { projectsRouter } from "./projects"
import { providersRouter } from "./providers"
import { qwenRouter } from "./qwen"
import { rooRouter } from "./roo"
import { runtimeRouter } from "./runtime"
import { sandboxImportRouter } from "./sandbox-import"
import { skillsRouter } from "./skills"
import { usageRouter } from "./usage"
import { voiceRouter } from "./voice"
import { worktreeConfigRouter } from "./worktree-config"

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
    grok: grokRouter,
    qwen: qwenRouter,
    cline: clineRouter,
    openclaw: openclawRouter,
    roo: rooRouter,
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
    providers: providersRouter,
    opencode: opencodeRouter,
    hermes: hermesRouter,
    // Git operations - named "changes" to match Superset API
    changes: createGitRouter(),
  })
}

/**
 * Export the router type for client usage
 */
export type AppRouter = ReturnType<typeof createAppRouter>
