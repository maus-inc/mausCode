/**
 * Native runtime chat transport: `ChatTransport` over the `runtime.*` tRPC
 * router (mausCode daemon) instead of the Claude Agent SDK.
 *
 * Question/compacting atoms and prompt extraction are shared with the legacy
 * IPC transport (see chat-chunk-atoms.ts); only credential handling and error
 * categorization differ.
 */

import * as Sentry from "@sentry/electron/renderer"
import type { ChatTransport, UIMessageChunk as SDKUIMessageChunk, UIMessage } from "ai"
import { toast } from "sonner"
import type { AgentMode } from "../../../../shared/agent-mode"
import { NATIVE_ERROR_PREFIX } from "../../../../shared/runtime-protocol"
import {
  autoOfflineModeAtom,
  type CustomClaudeConfig,
  customClaudeConfigAtom,
  normalizeCustomClaudeConfig,
  sessionInfoAtom,
  showOfflineModeFeaturesAtom,
} from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import {
  MODEL_ID_MAP,
  pendingAuthRetryMessageAtom,
  subChatModelIdAtomFamily,
  subChatPromptSuggestionAtomFamily,
  subChatTurnGenerationAtomFamily,
} from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import {
  applyCompactingChunks,
  applyQuestionChunks,
  clearStalePendingQuestion,
  lastUserPrompt,
  type SendMessagesOptions,
  type SubscriptionChunk,
} from "./chat-chunk-atoms"

type NativeChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
  mode: AgentMode
  model?: string
}

// Native error codes (after NATIVE_ prefix) and their user-friendly messages.
const NATIVE_ERROR_TOAST_CONFIG: Record<string, { title: string; description: string }> = {
  STARTUP_FAILED: {
    title: "Native runtime failed to start",
    description:
      "The local runtime daemon could not start. Try again, or switch back to the legacy engine.",
  },
  NO_CREDENTIALS: {
    title: "No provider credentials",
    description: "Connect an Anthropic account or set an API key to use the native engine.",
  },
  SESSION_FAILED: {
    title: "Native session failed",
    description: "Could not create a runtime session. Try sending your message again.",
  },
  TURN_FAILED: {
    title: "Native runtime error",
    description: "The turn failed unexpectedly. Try sending your message again.",
  },
  UNKNOWN_SESSION: {
    title: "Session expired",
    description: "The runtime session is gone; a fresh one will be created on your next message.",
  },
  INVALID_REQUEST: {
    title: "Request rejected",
    description: "The runtime rejected the request. Try again or switch engines.",
  },
}

export class NativeChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: NativeChatTransportConfig) {}

  async sendMessages(options: SendMessagesOptions): Promise<ReadableStream<SDKUIMessageChunk>> {
    const { prompt, images } = lastUserPrompt(options.messages)

    // Read model selection dynamically per sub-chat (so split panes stay independent)
    const selectedModelId = appStore.get(subChatModelIdAtomFamily(this.config.subChatId))
    const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP.opus

    // Offline/Ollama routing is a legacy-path feature; refuse loudly rather
    // than silently running the turn against cloud credentials.
    const offlineModeEnabled =
      appStore.get(showOfflineModeFeaturesAtom) && appStore.get(autoOfflineModeAtom)
    if (offlineModeEnabled) {
      const message =
        "Offline mode is not supported on the Native engine yet. Switch back to Legacy for offline chats."
      toast.error("Offline not supported on Native", {
        description: message,
        duration: 12000,
      })
      // Fail as a stream error (same path as auth-error) so Chat resets to ready.
      return new ReadableStream<SDKUIMessageChunk>({
        start: (controller) => controller.error(new Error(message)),
      })
    }

    // Custom provider configs ride along so the daemon host can apply the
    // token — or refuse custom endpoints with a clear error.
    const storedCustomConfig = appStore.get(customClaudeConfigAtom) as CustomClaudeConfig
    const customConfig = normalizeCustomClaudeConfig(storedCustomConfig)

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode ||
      this.config.mode

    // Turn ownership is shared with the legacy transport: bump the generation
    // so a late suggestion from a still-open legacy stream is refused at the
    // store, and clear whatever the previous turn left — this engine emits no
    // suggestions of its own, and it inherits no stale ones.
    const turnGeneration = appStore.get(subChatTurnGenerationAtomFamily(this.config.subChatId)) + 1
    appStore.set(subChatTurnGenerationAtomFamily(this.config.subChatId), turnGeneration)
    appStore.set(subChatPromptSuggestionAtomFamily(this.config.subChatId), null)

    const subId = this.config.subChatId.slice(-8)
    let chunkCount = 0
    let lastChunkType = ""
    console.log(`[SD] R:NATIVE_START sub=${subId} cwd=${this.config.cwd} model=${modelString}`)

    return new ReadableStream({
      start: (controller) => {
        const sub = trpcClient.runtime.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            prompt,
            cwd: this.config.cwd,
            projectPath: this.config.projectPath,
            mode: currentMode,
            ...(modelString && { model: modelString }),
            ...(customConfig?.token && { customToken: customConfig.token }),
            ...(customConfig?.baseUrl && { customBaseUrl: customConfig.baseUrl }),
            ...(images.length > 0 && { images }),
          },
          {
            onData: (chunk: SubscriptionChunk) => {
              chunkCount++
              lastChunkType = chunk.type

              applyQuestionChunks(chunk, {
                subChatId: this.config.subChatId,
                chatId: this.config.chatId,
              })
              applyCompactingChunks(chunk, this.config.subChatId)
              clearStalePendingQuestion(chunk, this.config.subChatId)

              // Handle session init - store MCP servers, plugins, tools info
              // (native snapshot: cached mcp__ tools + config-resolved servers)
              if (chunk.type === "session-init") {
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools ?? [],
                  mcpServers: chunk.mcpServers ?? [],
                  plugins: chunk.plugins ?? [],
                  skills: chunk.skills ?? [],
                  ...(chunk.toolsUnknown !== undefined && { toolsUnknown: chunk.toolsUnknown }),
                  ...(chunk.mcpConfigErrors !== undefined && {
                    mcpConfigErrors: chunk.mcpConfigErrors,
                  }),
                })
              }

              // Native auth failure: no modal exists for this engine yet —
              // stash the prompt for retry and surface a provider toast.
              if (chunk.type === "auth-error") {
                appStore.set(pendingAuthRetryMessageAtom, {
                  subChatId: this.config.subChatId,
                  provider: "claude-code",
                  prompt,
                  ...(images.length > 0 && { images }),
                  readyToRetry: false,
                })
                const config = NATIVE_ERROR_TOAST_CONFIG.NO_CREDENTIALS
                toast.error(config.title, {
                  description: config.description,
                  duration: 12000,
                })
                console.log(`[SD] R:NATIVE_AUTH_ERR sub=${subId}`)
                controller.error(new Error("Authentication required"))
                return
              }

              if (chunk.type === "retry-notification") {
                toast.info(chunk.message || "Retrying request", { duration: 4000 })
                return // don't enqueue retry-notification as a stream chunk
              }

              if (chunk.type === "error") {
                this.reportError(chunk, currentMode, modelString)
              }

              try {
                controller.enqueue(chunk as SDKUIMessageChunk)
              } catch (e) {
                console.log(
                  `[SD] R:NATIVE_ENQUEUE_ERR sub=${subId} type=${chunk.type} n=${chunkCount} err=${e}`,
                )
              }

              if (chunk.type === "finish") {
                console.log(`[SD] R:NATIVE_FINISH sub=${subId} n=${chunkCount}`)
                try {
                  controller.close()
                } catch {
                  // Already closed
                }
              }
            },
            onError: (err: Error) => {
              console.log(
                `[SD] R:NATIVE_ERROR sub=${subId} n=${chunkCount} last=${lastChunkType} err=${err.message}`,
              )
              Sentry.captureException(err, {
                tags: { errorCategory: "NATIVE_TRANSPORT_ERROR", mode: currentMode },
                extra: {
                  cwd: this.config.cwd,
                  chatId: this.config.chatId,
                  subChatId: this.config.subChatId,
                },
              })
              controller.error(err)
            },
            onComplete: () => {
              console.log(
                `[SD] R:NATIVE_COMPLETE sub=${subId} n=${chunkCount} last=${lastChunkType}`,
              )
              try {
                controller.close()
              } catch {
                // Already closed
              }
            },
          },
        )

        options.abortSignal?.addEventListener("abort", () => {
          console.log(`[SD] R:NATIVE_ABORT sub=${subId} n=${chunkCount} last=${lastChunkType}`)
          sub.unsubscribe()
          void trpcClient.runtime.cancel.mutate({ subChatId: this.config.subChatId })
          try {
            controller.close()
          } catch {
            // Already closed
          }
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<SDKUIMessageChunk> | null> {
    return null // Not needed for local app
  }

  private reportError(
    chunk: Extract<SubscriptionChunk, { type: "error" }>,
    mode: string,
    model: string,
  ): void {
    const rawText: string = chunk.errorText || "Unknown error"
    const code = rawText.startsWith(NATIVE_ERROR_PREFIX)
      ? rawText.slice(NATIVE_ERROR_PREFIX.length).split(":")[0]
      : "TURN_FAILED"
    console.error(`[NATIVE ERROR] Code: ${code} SubChat: ${this.config.subChatId} Model: ${model}`)
    console.error(`[NATIVE ERROR] Error text: ${rawText}`)

    Sentry.captureException(new Error(rawText), {
      tags: { errorCategory: `NATIVE_${code}`, mode },
      extra: {
        cwd: this.config.cwd,
        chatId: this.config.chatId,
        subChatId: this.config.subChatId,
      },
    })

    const errorDetails = [
      `Error: ${rawText}`,
      `Code: NATIVE_${code}`,
      `Chat ID: ${this.config.chatId}`,
      `SubChat ID: ${this.config.subChatId}`,
      `CWD: ${this.config.cwd}`,
      `Mode: ${mode}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n")

    const config = NATIVE_ERROR_TOAST_CONFIG[code]
    const description = config?.description || rawText
    toast.error(config?.title || "Native runtime error", {
      description: description.length > 300 ? `${description.slice(0, 300)}...` : description,
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
}
