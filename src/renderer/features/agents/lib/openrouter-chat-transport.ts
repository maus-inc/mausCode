/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
import type { ChatTransport, UIMessage } from "ai"
import { toast } from "sonner"
import { appStore } from "../../../lib/jotai-store"
import { pinnedOpenRouterModelsAtom } from "../../../lib/atoms"
import { trpcClient } from "../../../lib/trpc"
import { lastSelectedOpenRouterModelIdAtom, subChatOpenRouterModelIdAtomFamily } from "../atoms"
import type { AgentMessageMetadata } from "../ui/agent-message-usage"

type UIMessageChunk = any

type OpenRouterChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd?: string
  projectPath?: string
}

type ImageAttachment = {
  base64Data: string
  mediaType: string
  filename?: string
}

function getSelectedOpenRouterModelId(subChatId: string): string {
  const pinned = appStore.get(pinnedOpenRouterModelsAtom)
  const stored = appStore.get(subChatOpenRouterModelIdAtomFamily(subChatId))
  if (stored && pinned.includes(stored)) return stored
  const last = appStore.get(lastSelectedOpenRouterModelIdAtom)
  if (last && pinned.includes(last)) return last
  return pinned[0] ?? ""
}

export class OpenRouterChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: OpenRouterChatTransportConfig) {}

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

    const modelId = getSelectedOpenRouterModelId(this.config.subChatId)

    if (!modelId) {
      return new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "error",
            errorText: "No OpenRouter model selected. Pin a model in Settings → Models.",
          })
          controller.enqueue({ type: "finish" })
          controller.close()
        },
      })
    }

    return new ReadableStream({
      start: (controller) => {
        const runId = crypto.randomUUID()
        let sub: { unsubscribe: () => void } | null = null
        let didUnsubscribe = false

        const safeUnsubscribe = () => {
          if (didUnsubscribe) return
          didUnsubscribe = true
          sub?.unsubscribe()
        }

        sub = trpcClient.openrouter.chat.subscribe(
          {
            subChatId: this.config.subChatId,
            chatId: this.config.chatId,
            runId,
            prompt,
            modelId,
            ...(sessionId ? { sessionId } : {}),
            ...(images.length > 0 ? { images } : {}),
            ...(this.config.cwd ? { cwd: this.config.cwd } : {}),
            ...(this.config.projectPath ? { projectPath: this.config.projectPath } : {}),
          },
          {
            onData: (chunk: UIMessageChunk) => {
              if (chunk?.type === "error") {
                toast.error("OpenRouter error", {
                  description: chunk.errorText || "An unexpected OpenRouter error occurred.",
                })
              }

              try {
                controller.enqueue(chunk)
              } catch {
                // already closed
              }

              if (chunk?.type === "finish") {
                try {
                  controller.close()
                } catch {
                  // already closed
                }
              }
            },
            onError: (error: Error) => {
              toast.error("OpenRouter request failed", {
                description: error.message,
              })
              try {
                controller.error(error)
              } catch {
                // already errored
              }
              safeUnsubscribe()
            },
            onComplete: () => {
              try {
                controller.close()
              } catch {
                // already closed
              }
              safeUnsubscribe()
            },
          },
        )

        options.abortSignal?.addEventListener("abort", () => {
          const cancelPromise = trpcClient.openrouter.cancel
            .mutate({ subChatId: this.config.subChatId, runId })
            .catch(() => {
              // no-op
            })

          try {
            controller.close()
          } catch {
            // already closed
          }

          void cancelPromise.finally(() => {
            safeUnsubscribe()
          })
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  cleanup(): void {
    void trpcClient.openrouter.cleanup.mutate({ subChatId: this.config.subChatId }).catch(() => {
      // no-op
    })
  }

  private extractText(message: UIMessage | undefined): string {
    if (!message?.parts) return ""

    const textParts: string[] = []
    const fileContents: string[] = []

    for (const part of message.parts) {
      if (part.type === "text" && (part as any).text) {
        textParts.push((part as any).text)
      } else if ((part as any).type === "file-content") {
        const filePart = part as any
        const fileName = filePart.filePath?.split("/").pop() || filePart.filePath || "file"
        fileContents.push(`\n--- ${fileName} ---\n${filePart.content}`)
      }
    }

    return textParts.join("\n") + fileContents.join("")
  }

  private extractImages(message: UIMessage | undefined): ImageAttachment[] {
    if (!message?.parts) return []

    const images: ImageAttachment[] = []
    for (const part of message.parts) {
      if (part.type === "data-image" && (part as any).data) {
        const data = (part as any).data
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
