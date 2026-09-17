/**
 * Mention token prefixes. Kept in a module with no React or store imports so
 * logic that builds mention tokens (the queue sender) can be tested and reused
 * without pulling the editor in.
 */
export const MENTION_PREFIXES = {
  FILE: "file:",
  FOLDER: "folder:",
  SKILL: "skill:",
  AGENT: "agent:",
  TOOL: "tool:", // MCP tools
  QUOTE: "quote:", // Selected text from assistant messages
  DIFF: "diff:", // Selected text from diff sidebar
  PASTED: "pasted:", // Large pasted text saved as files
  CHAT_HISTORY: "chatHistory:", // Chat history from another sub-chat/provider
} as const
