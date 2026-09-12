/**
 * Mention Providers
 *
 * This module exports all built-in mention providers and provides
 * utilities for registering them with the mention registry.
 */

// Re-export types
export type { MentionProvider } from "../types"
export { type AgentData, type AgentModel, agentsProvider } from "./agents-provider"
export { type FileData, filesProvider } from "./files-provider"
export { type SkillData, skillsProvider } from "./skills-provider"
export { type ToolData, type ToolsSearchContext, toolsProvider } from "./tools-provider"

import { mentionRegistry } from "../registry"
import type { MentionProvider } from "../types"
import { agentsProvider } from "./agents-provider"
import { filesProvider } from "./files-provider"
import { skillsProvider } from "./skills-provider"
import { toolsProvider } from "./tools-provider"

/**
 * All built-in providers
 */
export const builtInProviders: MentionProvider[] = [
  filesProvider,
  skillsProvider,
  agentsProvider,
  toolsProvider,
]

/**
 * Register all built-in providers with the registry
 * Returns an unregister function
 */
export function registerBuiltInProviders(): () => void {
  return mentionRegistry.registerAll(builtInProviders)
}

/**
 * Register a single provider
 */
export function registerProvider(provider: MentionProvider): () => void {
  return mentionRegistry.register(provider)
}
