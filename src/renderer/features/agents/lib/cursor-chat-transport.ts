/**
 * NOTE (transplant): CursorChatTransport: ChatTransport<UIMessage> over trpc.cursor.chat.
 * Source: SamSammane/1code-ui (Apache-2.0), commit 51b79a5.
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from "ai"
import { toast } from "sonner"
import { normalizeCodexStreamChunk } from "../../../../shared/codex-tool-normalizer"
import { DEFAULT_CURSOR_UI_MODEL } from "../../../../shared/cursor-model-id"
import { cursorLoginModalOpenAtom, type SessionInfo, sessionInfoAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { trpcClient } from "../../../lib/trpc"
import { pendingAuthRetryMessageAtom, subChatCursorModelIdAtomFamily } from "../atoms"
import { useAgentSubChatStore } from "../stores/sub-chat-store"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import { CURSOR_MODELS } from "./models"

/**
 * Stream chunks arriving on the provider subscription: the AI SDK chunk
 * dialect plus session extras (session-init/auth-error) emitted upstream.
 */
interface TransportStreamChunk {
  type: string
  id?: string
  delta?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: unknown
  errorText?: string
  messageMetadata?: unknown
  tools?: string[]
  mcpServers?: SessionInfo["mcpServers"]
  plugins?: SessionInfo["plugins"]
  skills?: string[]
  [key: string]: unknown
}

type CursorChatTransportConfig = {
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

function getSelectedCursorModel(subChatId: string): string {
  const selectedModelId = appStore.get(subChatCursorModelIdAtomFamily(subChatId))
  const selectedModel =
    CURSOR_MODELS.find((model) => model.id === selectedModelId) || CURSOR_MODELS[0]

  return selectedModel?.id || DEFAULT_CURSOR_UI_MODEL
}

export class CursorChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: CursorChatTransportConfig) {}

  async sendMessages(options: {
    messages: UIMessage[]
    abortSignal?: AbortSignal
  }): Promise<ReadableStream<UIMessageChunk>> {
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
    const selectedModel = getSelectedCursorModel(this.config.subChatId)

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

        sub = trpcClient.cursor.chat.subscribe(
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
            onData: (chunk: TransportStreamChunk) => {
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
                    const integration = await trpcClient.cursor.getIntegration.query()
                    isConnected = Boolean(integration.isConnected)
                  } catch {
                    // Open login modal on integration check failure.
                  }

                  appStore.set(pendingAuthRetryMessageAtom, {
                    subChatId: this.config.subChatId,
                    provider: "cursor",
                    prompt,
                    ...(images.length > 0 && { images }),
                    readyToRetry: false,
                  })

                  appStore.set(cursorLoginModalOpenAtom, true)
                  if (isConnected) {
                    toast.error("Cursor authentication failed", {
                      description:
                        "CLI login looks valid, but the agent session was rejected. Sign in again.",
                    })
                  }
                })()

                void trpcClient.cursor.cleanup
                  .mutate({ subChatId: this.config.subChatId })
                  .catch(() => {
                    // No-op
                  })

                controller.error(new Error("Cursor authentication required"))
                return
              }

              if (chunk.type === "error") {
                toast.error("Cursor error", {
                  description: chunk.errorText || "An unexpected Cursor error occurred.",
                })
              }

              try {
                const normalizedChunk = normalizeCodexStreamChunk(chunk) as UIMessageChunk
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
              toast.error("Cursor request failed", {
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
          const cancelPromise = trpcClient.cursor.cancel
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

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.cursor.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {
      // No-op
    })
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message?.parts) return ""

    const textParts: string[] = []
    const fileContents: string[] = []

    for (const part of message.parts) {
      if (part.type === "text" && part.text) {
        textParts.push(part.text)
      } else {
        const filePart = part as { type?: string; filePath?: unknown; content?: unknown }
        if (filePart.type === "file-content") {
          const filePath = typeof filePart.filePath === "string" ? filePart.filePath : undefined
          const fileName = filePath?.split("/").pop() || filePath || "file"
          fileContents.push(`\n--- ${fileName} ---\n${filePart.content}`)
        }
      }
    }

    return textParts.join("\n") + fileContents.join("")
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message?.parts) return []

    const images: ImageAttachment[] = []

    for (const part of message.parts) {
      const imagePart = part as { type?: string; data?: unknown }
      if (imagePart.type === "data-image" && imagePart.data) {
        const data = imagePart.data
        if (typeof data === "object" && data !== null) {
          const record = data as Record<string, unknown>
          const base64Data = record.base64Data
          const mediaType = record.mediaType
          const filename = record.filename
          if (typeof base64Data === "string" && typeof mediaType === "string") {
            images.push({
              base64Data,
              mediaType,
              filename: typeof filename === "string" ? filename : undefined,
            })
          }
        }
      }
    }

    return images
  }
}
