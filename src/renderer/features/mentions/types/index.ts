/**
 * Mention System Types
 *
 * This module exports all types for the scalable mention system.
 * Import from here for a clean API.
 */

// Core types
export type {
  MentionCategory,
  MentionItem,
  MentionPrefix,
  MentionProviderId,
  MentionTrigger,
} from "./core"
export { createProviderId, getMentionPrefix, isMentionType, MENTION_PREFIXES } from "./core"

// Provider types
export type {
  MentionProvider,
  MentionProviderOptions,
  TypedMentionProvider,
} from "./provider"
export { createMentionProvider } from "./provider"

// Search types
export type {
  AggregatedSearchResult,
  MentionSearchContext,
  MentionSearchOptions,
  MentionSearchResult,
  RelevanceScore,
} from "./search"
export { calculateRelevance, sortByRelevance } from "./search"
