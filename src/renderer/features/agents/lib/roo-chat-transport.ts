/**
 * mausCode RooChatTransport: ChatTransport<UIMessage> over trpc.roo.chat.
 * Mirrors ClineChatTransport (ours, NOT verbatim).
 */
import type { ChatTransport, UIMessageChunk as SDKUIMessageChunk, UIMessage } from "ai"
import { toast } from "sonner"
import { normalizeCodexStreamChunk } from "../../../../shared/codex-tool-normalizer"
import { DEFAULT_ROO_UI_MODEL } from "../../../../shared/roo-model-id"
import { rooLoginModalOpenAtom, sessionInfoAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import { pendingAuthRetryMessageAtom, subChatRooModelIdAtomFamily } from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import type { LooseUIPart, PrintChunk } from "./chat-chunk-atoms"
import { ROO_MODELS } from "./models"

type RooChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string
  mode: "plan" | "ask" | "edit" | "agent" | "turbo"
}

type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

const forceFreshSessionSubChats = new Set<string>()

function getSelectedRooModel(subChatId: string): string {
  const selectedModelId = appStore.get(subChatRooModelIdAtomFamily(subChatId))
  const selectedModel = ROO_MODELS.find((model) => model.id === selectedModelId) || ROO_MODELS[0]

  return selectedModel?.id || DEFAULT_ROO_UI_MODEL
}

export class RooChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: RooChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<SDKUIMessageChunk>> {
    const lastUser = [...options.messages].reverse().find((message) => message.role === "user")

    const prompt = this.extractText(lastUser)
    const images = this.extractImages(lastUser)

    const lastAssistant = [...options.messages]
      .reverse()
      .find((message) => message.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    const currentMode =
      useAgentSubChatStore
        .getState()
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode ||
      this.config.mode
    const forceNewSession = forceFreshSessionSubChats.has(this.config.subChatId)
    if (forceNewSession) {
      forceFreshSessionSubChats.delete(this.config.subChatId)
    }
    const selectedModel = getSelectedRooModel(this.config.subChatId)

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false
        let forcedUnsubscribeTimer: ReturnType<typeof setTimeout> | null = null

        const clearForcedUnsubscribeTimer = () => {
          if (!forcedUnsubscribeTimer) return
          clearTimeout(forcedUnsubscribeTimer)
          forcedUnsubscribeTimer = null
        }

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          clearForcedUnsubscribeTimer()
          sub?.unsubscribe()
        }

        sub = trpcClient.roo.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            cwd: this.config.cwd,
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
            model: selectedModel,
            mode: currentMode,
            ...(sessionId ? { sessionId } : {}),
            ...(forceNewSession ? { forceNewSession: true } : {}),
            ...(images.length > 0 ? { images } : {}),
          },
          {
            onData: (chunk: PrintChunk) => {
              if (chunk.type === "session-init") {
                appStore.set(sessionInfoAtom, {
                  tools: chunk.tools || [],
                  mcpServers: chunk.mcpServers || [],
                  plugins: chunk.plugins || [],
                  skills: chunk.skills || [],
                })
              }

              if (chunk.type === "auth-error") {
                forceFreshSessionSubChats.add(this.config.subChatId)

                void (async () => {
                  let isConnected = false
                  try {
                    const integration = await trpcClient.roo.getIntegration.query()
                    isConnected = Boolean(integration.isConnected)
                  } catch {
                    // Open login modal on integration check failure.
                  }

                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    provider: "roo",
                    prompt,
                    ...(images.length > 0 && { images }),
                    readyToRetry: false,
                  })

                  appStore.set(rooLoginModalOpenAtom, true)
                  if (isConnected) {
                    toast.error("Roo Code authentication failed", {
                      description:
                        "Stored credentials look valid, but the agent session was rejected. Reconnect Roo Code.",
                    })
                  }
                })()

                void trpcClient.roo.cleanup
                  .mutate({ subChatId: this.config.subChatId })
                  .catch(() => {
                    // No-op
                  })

                controller.error(new Error("Roo Code authentication required"))
                return
              }

              if (chunk.type === "error") {
                toast.error("Roo Code error", {
                  description: chunk.errorText || "An unexpected Roo Code error occurred.",
                })
              }

              try {
                const normalizedChunk = normalizeCodexStreamChunk(chunk) as SDKUIMessageChunk
                controller.enqueue(normalizedChunk)
              } catch {
                // Stream already closed
              }

              if (chunk.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // Stream already closed
                }
              }
            },
            onError: (error: Error) => {
              toast.error("Roo Code request failed", {
                description: error.message,
              })
              controller.error(error)
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // Stream already closed
              }
              safeUnsubscribe()
            },
          },
        )

        options.abortSignal?.addEventListener("abort", () => {
          const cancelPromise = trpcClient.roo.cancel
            .mutate({ subChatId: this.config.subChatId, runId })
            .catch(() => {
              // No-op
            })

          try {
            controller.close()
          } catch {
            // Stream already closed
          }

          void (async () => {
            try {
              await cancelPromise
            } finally {
              clearForcedUnsubscribeTimer()
              forcedUnsubscribeTimer = setTimeout(() => {
                safeUnsubscribe()
              }, 10000)
            }
          })()
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<SDKUIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.roo.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {
      // No-op
    })
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message?.parts) return ""

    const textParts: string[] = []
    const fileContents: string[] = []

    for (const part of message.parts) {
      const loosePart = part as LooseUIPart
      if (part.type === "text" && loosePart.text) {
        textParts.push(loosePart.text)
      } else if (loosePart.type === "file-content") {
        const fileName = loosePart.filePath?.split("/").pop() || loosePart.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${loosePart.content}`)
      }
    }

    return textParts.join("\n") + fileContents.join("")
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message?.parts) return []

    const images: ImageAttachment[] = []

    for (const part of message.parts) {
      const data = (part as LooseUIPart).data
      if (part.type === "data-image" && data) {
        if (data.base64Data && data.mediaType) {
          images.push({
            base64Data: data.base64Data,
            mediaType: data.mediaType,
            filename: data.filename,
          })
        }
      }
    }

    return images
  }
}
