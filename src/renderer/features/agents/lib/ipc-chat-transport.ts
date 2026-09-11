import * as Sentry from "@sentry/electron/renderer"
import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import {
  claudeLoginModalConfigAtom,
  agentsLoginModalOpenAtom,
  autoOfflineModeAtom,
  type CustomClaudeConfig,
  customClaudeConfigAtom,
  enableTasksAtom,
  extendedThinkingEnabledAtom,
  historyEnabledAtom,
  normalizeCustomClaudeConfig,
  selectedOllamaModelAtom,
  sessionInfoAtom,
  showOfflineModeFeaturesAtom,
} from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  MODEL_ID_MAP,
  pendingAuthRetryMessageAtom,
  subChatModelIdAtomFamily,
} from "../atoms"
import {
  applyCompactingChunks,
  applyQuestionChunks,
  clearStalePendingQuestion,
  extractPromptImages,
  extractPromptText,
} from "./chat-chunk-atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"

// Error categories and their user-friendly messages
const ERROR_TOAST_CONFIG: Record<
  string,
  {
    title: string
    description: string
    action?: { label: string; onClick: () => void }
  }
> = {
  AUTH_FAILED_SDK: {
    title: "Not logged in",
    description: "Run 'claude login' in your terminal to authenticate",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("claude login"),
    },
  },
  INVALID_API_KEY_SDK: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  INVALID_API_KEY: {
    title: "Invalid API key",
    description:
      "Your Claude API key is invalid. Check your CLI configuration.",
  },
  RATE_LIMIT_SDK: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () =>
        trpcClient.external.openExternal.mutate(
          "https://claude.ai/settings/usage",
        ),
    },
  },
  RATE_LIMIT: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () =>
        trpcClient.external.openExternal.mutate(
          "https://claude.ai/settings/usage",
        ),
    },
  },
  OVERLOADED_SDK: {
    title: "Claude is busy",
    description:
      "The service is overloaded. Please try again in a few moments.",
  },
  PROCESS_CRASH: {
    title: "Claude crashed",
    description:
      "The Claude process exited unexpectedly. Try sending your message again or rollback.",
  },
  SESSION_EXPIRED: {
    title: "Session expired",
    description:
      "Your previous chat session expired. Send your message again to start fresh.",
  },
  EXECUTABLE_NOT_FOUND: {
    title: "Claude CLI not found",
    description:
      "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
    action: {
      label: "Copy command",
      onClick: () =>
        navigator.clipboard.writeText(
          "npm install -g @anthropic-ai/claude-code",
        ),
    },
  },
  NETWORK_ERROR: {
    title: "Network error",
    description: "Check your internet connection and try again.",
  },
  AUTH_FAILURE: {
    title: "Authentication failed",
    description: "Your session may have expired. Try logging in again.",
  },
  USAGE_POLICY_VIOLATION: {
    title: "Anthropic API hiccup",
    description: "The request was rejected by Anthropic's servers. Please try again shortly.",
  },
  // SDK_ERROR and other unknown errors use chunk.errorText for description
}

type UIMessageChunk = any // Inferred from subscription

type IPCChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string // Original project path for MCP config lookup (when using worktrees)
  mode: "plan" | "agent"
  model?: string
}

export class IPCChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: IPCChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
    // Extract prompt and images from last user message
    const lastUser = [...options.messages]
      .reverse()
      .find((m) => m.role === "user")
    const prompt = extractPromptText(lastUser)
    const images = extractPromptImages(lastUser)

    // Get sessionId for resume (server preserves sessionId on abort so
    // the next message can resume with full conversation context)
    const lastAssistant = [...options.messages]
      .reverse()
      .find((m) => m.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    // Read extended thinking setting dynamically (so toggle applies to existing chats)
    const thinkingEnabled = appStore.get(extendedThinkingEnabledAtom)
    // Max thinking tokens for extended thinking mode
    // SDK adds +1 internally, so 64000 becomes 64001 which exceeds Opus 4.5 limit
    // Using 32000 to stay safely under the 64000 max output tokens limit
    const maxThinkingTokens = thinkingEnabled ? 32_000 : undefined
    const historyEnabled = appStore.get(historyEnabledAtom)
    const enableTasks = appStore.get(enableTasksAtom)

    // Read model selection dynamically per sub-chat (so split panes stay independent)
    const selectedModelId = appStore.get(subChatModelIdAtomFamily(this.config.subChatId))
    const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP["opus"]

    const storedCustomConfig = appStore.get(
      customClaudeConfigAtom,
    ) as CustomClaudeConfig
    const customConfig = normalizeCustomClaudeConfig(storedCustomConfig)

    // Get selected Ollama model for offline mode
    const selectedOllamaModel = appStore.get(selectedOllamaModelAtom)
    // Check if offline mode is enabled in settings
    const showOfflineFeatures = appStore.get(showOfflineModeFeaturesAtom)
    const autoOfflineMode = appStore.get(autoOfflineModeAtom)
    const offlineModeEnabled = showOfflineFeatures && autoOfflineMode

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)
        ?.mode || this.config.mode

    // Stream debug logging
    const subId = this.config.subChatId.slice(-8)
    let chunkCount = 0
    let lastChunkType = ""
    console.log(`[SD] R:START sub=${subId} cwd=${this.config.cwd} projectPath=${this.config.projectPath || "(not set)"} customConfig=${customConfig ? "set" : "not set"}`)

    return new ReadableStream({
      start: (controller) => {
        const sub = trpcClient.claude.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            prompt,
            cwd: this.config.cwd,
            projectPath: this.config.projectPath, // Original project path for MCP config lookup
            mode: currentMode,
            sessionId,
            ...(maxThinkingTokens && { maxThinkingTokens }),
            ...(modelString && { model: modelString }),
            ...(customConfig && { customConfig }),
            ...(selectedOllamaModel && { selectedOllamaModel }),
            historyEnabled,
            offlineModeEnabled,
            enableTasks,
            ...(images.length > 0 && { images }),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              chunkCount++
              lastChunkType = chunk.type

              applyQuestionChunks(chunk, {
                subChatId: this.config.subChatId,
                chatId: this.config.chatId,
              })
              applyCompactingChunks(chunk, this.config.subChatId)

              // Handle session init - store MCP servers, plugins, tools info
              if (chunk.type === "session-init") {
                console.log("[MCP] Received session-init:", {
                  tools: chunk.tools?.length,
                  mcpServers: chunk.mcpServers,
                  plugins: chunk.plugins,
                  skills: chunk.skills?.length,
                  // Debug: show all tools to check for MCP tools (format: mcp__servername__toolname)
                  allTools: chunk.tools,
                })
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools,
                  mcpServers: chunk.mcpServers,
                  plugins: chunk.plugins,
                  skills: chunk.skills,
                })
              }

              clearStalePendingQuestion(chunk, this.config.subChatId)

              // Handle authentication errors - show Claude login modal
              if (chunk.type === "auth-error") {
                // Store the failed message for retry after successful auth
                // readyToRetry=false prevents immediate retry - modal sets it to true on OAuth success
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  provider: "claude-code",
                  prompt,
                  ...(images.length > 0 && { images }),
                  readyToRetry: false,
                })
                appStore.set(claudeLoginModalConfigAtom, {
                  hideCustomModelSettingsLink: false,
                  autoStartAuth: false,
                })
                // Show the Claude Code login modal
                appStore.set(agentsLoginModalOpenAtom, true)
                // Use controller.error() instead of controller.close() so that
                // the SDK Chat properly resets status from "streaming" to "ready"
                // This allows user to retry sending messages after failed auth
                console.log(`[SD] R:AUTH_ERR sub=${subId}`)
                controller.error(new Error("Authentication required"))
                return
              }

              // Handle retry notification - show friendly toast instead of scary error
              if (chunk.type === "retry-notification") {
                toast.info("Retrying request", {
                  description: chunk.message || "Request was unsuccessful, trying again...",
                  duration: 4000,
                })
                return // don't enqueue retry-notification as a stream chunk
              }

              // Handle errors - show toast to user FIRST before anything else
              if (chunk.type === "error") {
                const category = chunk.debugInfo?.category || "UNKNOWN"

                // Detailed SDK error logging for debugging
                console.error(`[SDK ERROR] ========================================`)
                console.error(`[SDK ERROR] Category: ${category}`)
                console.error(`[SDK ERROR] Error text: ${chunk.errorText}`)
                console.error(`[SDK ERROR] Chat ID: ${this.config.chatId}`)
                console.error(`[SDK ERROR] SubChat ID: ${this.config.subChatId}`)
                console.error(`[SDK ERROR] CWD: ${this.config.cwd}`)
                console.error(`[SDK ERROR] Mode: ${currentMode}`)
                if (chunk.debugInfo) {
                  console.error(`[SDK ERROR] Debug info:`, JSON.stringify(chunk.debugInfo, null, 2))
                }
                console.error(`[SDK ERROR] Full chunk:`, JSON.stringify(chunk, null, 2))
                console.error(`[SDK ERROR] ========================================`)

                // Track error in Sentry
                Sentry.captureException(
                  new Error(chunk.errorText || "Claude transport error"),
                  {
                    tags: {
                      errorCategory: category,
                      mode: currentMode,
                    },
                    extra: {
                      debugInfo: chunk.debugInfo,
                      cwd: this.config.cwd,
                      chatId: this.config.chatId,
                      subChatId: this.config.subChatId,
                    },
                  },
                )

                // Build detailed error string for copying (available for ALL errors)
                const errorDetails = [
                  `Error: ${chunk.errorText || "Unknown error"}`,
                  `Category: ${category}`,
                  `Chat ID: ${this.config.chatId}`,
                  `SubChat ID: ${this.config.subChatId}`,
                  `CWD: ${this.config.cwd}`,
                  `Mode: ${currentMode}`,
                  `Timestamp: ${new Date().toISOString()}`,
                  chunk.debugInfo ? `Debug Info: ${JSON.stringify(chunk.debugInfo, null, 2)}` : null,
                ].filter(Boolean).join("\n")

                // Show toast based on error category
                const config = ERROR_TOAST_CONFIG[category]
                const title = config?.title || "Claude error"
                // For auth/API key failures, prefer original backend error to aid debugging
                const preferOriginalError =
                  category === "AUTH_FAILURE" ||
                  category === "INVALID_API_KEY_SDK" ||
                  category === "INVALID_API_KEY"
                // Use config description if set, otherwise fall back to errorText
                const rawDescription = preferOriginalError
                  ? chunk.errorText || config?.description || "An unexpected error occurred"
                  : config?.description || chunk.errorText || "An unexpected error occurred"
                // Truncate long descriptions for toast (keep first 300 chars)
                const description = rawDescription.length > 300
                  ? rawDescription.slice(0, 300) + "..."
                  : rawDescription

                toast.error(title, {
                  description,
                  duration: 12000,
                  action: {
                    label: "Copy Error",
                    onClick: () => {
                      navigator.clipboard.writeText(errorDetails)
                      toast.success("Error details copied to clipboard")
                    },
                  },
                })
              }

              // Try to enqueue, but don't crash if stream is already closed
              try {
                controller.enqueue(chunk)
              } catch (e) {
                // CRITICAL: Log when enqueue fails - this could explain missing chunks!
                console.log(`[SD] R:ENQUEUE_ERR sub=${subId} type=${chunk.type} n=${chunkCount} err=${e}`)
              }

              if (chunk.type === "finish") {
                console.log(`[SD] R:FINISH sub=${subId} n=${chunkCount}`)
                try {
                  controller.close()
                } catch {
                  // Already closed
                }
              }
            },
            onError: (err: Error) => {
              console.log(`[SD] R:ERROR sub=${subId} n=${chunkCount} last=${lastChunkType} err=${err.message}`)
              // Track transport errors in Sentry
              Sentry.captureException(err, {
                tags: {
                  errorCategory: "TRANSPORT_ERROR",
                  mode: currentMode,
                },
                extra: {
                  cwd: this.config.cwd,
                  chatId: this.config.chatId,
                  subChatId: this.config.subChatId,
                },
              })

              controller.error(err)
            },
            onComplete: () => {
              console.log(`[SD] R:COMPLETE sub=${subId} n=${chunkCount} last=${lastChunkType}`)
              // Note: Don't clear pending questions here - let active-chat.tsx handle it
              // via the stream stop detection effect. Clearing here causes race conditions
              // where sync effect immediately restores from messages.
              try {
                controller.close()
              } catch {
                // Already closed
              }
            },
          },
        )

        // Handle abort
        options.abortSignal?.addEventListener("abort", () => {
          console.log(`[SD] R:ABORT sub=${subId} n=${chunkCount} last=${lastChunkType}`)
          sub.unsubscribe()
          // trpcClient.claude.cancel.mutate({ subChatId: this.config.subChatId })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null // Not needed for local app
  }


}
