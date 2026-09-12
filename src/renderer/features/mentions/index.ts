/**
 * Scalable Mention System
 *
 * A plugin-based mention system inspired by VS Code's extension model.
 * Supports unlimited mention types through a provider system.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { registerBuiltInProviders, useMentionProviders } from './mentions'
 *
 * // Register built-in providers at app startup
 * registerBuiltInProviders()
 *
 * // Use providers in React components
 * function MyComponent() {
 *   const providers = useMentionProviders()
 *   // ...
 * }
 * ```
 *
 * ## Creating Custom Providers
 *
 * ```typescript
 * import { createMentionProvider, registerProvider } from './mentions'
 *
 * const myProvider = createMentionProvider({
 *   id: 'my-provider',
 *   name: 'My Provider',
 *   category: { label: 'My Category', priority: 50 },
 *   search: async (context) => {
 *     // Return matching items
 *     return { items: [...], hasMore: false }
 *   },
 *   serialize: (item) => `@[my:${item.id}]`,
 *   deserialize: (token) => {
 *     if (!token.startsWith('my:')) return null
 *     // Parse and return item
 *   },
 * })
 *
 * registerProvider(myProvider)
 * ```
 */

// Hooks
export {
  type UseMentionSearchOptions,
  type UseMentionSearchResult,
  useMentionSearch,
} from "./hooks"
export type { AgentData, FileData, SkillData, ToolData, ToolsSearchContext } from "./providers"
// Providers
export {
  agentsProvider,
  builtInProviders,
  filesProvider,
  registerBuiltInProviders,
  registerProvider,
  skillsProvider,
  toolsProvider,
} from "./providers"
// Registry
export {
  mentionProvidersAtom,
  mentionRegistry,
  syncedMentionProvidersAtom,
  useAvailableMentionProviders,
  useMentionCategories,
  useMentionProvider,
  useMentionProviders,
  useMentionProvidersByTrigger,
} from "./registry"
// Search
export {
  GitAwareCache,
  gitAwareCache,
  MentionCache,
  MentionSearchEngine,
  mentionCache,
  mentionSearchEngine,
} from "./search"
// Types
export type {
  AggregatedSearchResult,
  MentionCategory,
  MentionItem,
  MentionPrefix,
  MentionProvider,
  MentionProviderId,
  MentionProviderOptions,
  MentionSearchContext,
  MentionSearchOptions,
  MentionSearchResult,
  MentionTrigger,
  RelevanceScore,
  TypedMentionProvider,
} from "./types"
export {
  calculateRelevance,
  createMentionProvider,
  createProviderId,
  getMentionPrefix,
  isMentionType,
  MENTION_PREFIXES,
  sortByRelevance,
} from "./types"
