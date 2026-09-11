import { z } from "zod"

/**
 * Canonical sub-chat provider binding union. Single home shared by main
 * (drizzle writes, tRPC validation) and renderer (read/write-through).
 *
 * Mirrors the UI `AgentProviderId` in
 * `renderer/features/agents/components/agent-model-selector.tsx`, which stays
 * the UI-side union (it may carry UI-only concerns); keep the two in sync.
 * "native" is an execution engine, not a provider, and is intentionally absent.
 */
export const SUB_CHAT_PROVIDERS = [
  "claude-code",
  "codex",
  "gemini",
  "openrouter",
  "cursor",
] as const

export type SubChatProvider = (typeof SUB_CHAT_PROVIDERS)[number]

export const subChatProviderSchema = z.enum(SUB_CHAT_PROVIDERS)

export function isSubChatProvider(value: unknown): value is SubChatProvider {
  return (
    typeof value === "string" &&
    (SUB_CHAT_PROVIDERS as readonly string[]).includes(value)
  )
}
