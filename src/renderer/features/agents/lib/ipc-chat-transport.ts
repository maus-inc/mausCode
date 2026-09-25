/**
 * NOTE (transplant): the question/compact chunk handling, the stale-question
 * clearing fix, the prompt and image extraction, and the log removals were
 * transplanted from erenbertr/1code (Apache-2.0). The first three now live in
 * `./chat-chunk-atoms`, which both transports share, and the provenance record
 * is NOTICE and UPSTREAM.md. Their auth-error toast replacement was NOT taken
 * — this tree keeps the login-modal retry flow.
 */

import * as Sentry from "@sentry/electron/renderer"
import type { ChatTransport, UIMessageChunk as SDKUIMessageChunk, UIMessage } from "ai"
import { toast } from "sonner"
import type { AgentMode } from "../../../../shared/agent-mode"
import {
  agentsLoginModalOpenAtom,
  autoOfflineModeAtom,
  type CustomClaudeConfig,
  claudeLoginModalConfigAtom,
  customClaudeConfigAtom,
  enableTasksAtom,
  extendedThinkingEnabledAtom,
  historyEnabledAtom,
  normalizeCustomClaudeConfig,
  promptSuggestionsEnabledAtom,
  selectedOllamaModelAtom,
  sessionInfoAtom,
  showOfflineModeFeaturesAtom,
  subChatClaudeEffortAtomFamily,
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
import type { AgentMessageMetadata } from "../ui/agent-message-usage"
import {
  applyCompactingChunks,
  applyQuestionChunks,
  type ChatChunkContext,
  clearStalePendingQuestion,
  type ImageAttachment,
  lastUserPrompt,
  type SendMessagesOptions,
  type SubscriptionChunk,
} from "./chat-chunk-atoms"
import { mayStoreSuggestion } from "./suggestion-ownership"

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
    description: "Your Claude API key is invalid. Check your CLI configuration.",
  },
  INVALID_API_KEY: {
    title: "Invalid API key",
    description: "Your Claude API key is invalid. Check your CLI configuration.",
  },
  RATE_LIMIT_SDK: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () => trpcClient.external.openExternal.mutate("https://claude.ai/settings/usage"),
    },
  },
  RATE_LIMIT: {
    title: "Session limit reached",
    description: "You've hit the Claude Code usage limit.",
    action: {
      label: "View usage",
      onClick: () => trpcClient.external.openExternal.mutate("https://claude.ai/settings/usage"),
    },
  },
  OVERLOADED_SDK: {
    title: "Claude is busy",
    description: "The service is overloaded. Please try again in a few moments.",
  },
  PROCESS_CRASH: {
    title: "Claude crashed",
    description:
      "The Claude process exited unexpectedly. Try sending your message again or rollback.",
  },
  SESSION_EXPIRED: {
    title: "Session expired",
    description: "Your previous chat session expired. Send your message again to start fresh.",
  },
  EXECUTABLE_NOT_FOUND: {
    title: "Claude CLI not found",
    description: "Install Claude Code CLI: npm install -g @anthropic-ai/claude-code",
    action: {
      label: "Copy command",
      onClick: () => navigator.clipboard.writeText("npm install -g @anthropic-ai/claude-code"),
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

type IPCChatTransportConfig = {
  chatId: string
  subChatId: string
  cwd: string
  projectPath?: string // Original project path for MCP config lookup (when using worktrees)
  mode: AgentMode
  model?: string
}

/** The session id off a `message-metadata` chunk, whose payload the subscription
 * types as unknown. */
function hasSessionId(value: unknown): value is { sessionId: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { sessionId?: unknown }).sessionId === "string"
  )
}

/**
 * What the chunk handlers decided: `enqueue` hands the chunk to the AI SDK,
 * `consumed` ends handling for a chunk the SDK has no type for, and `failed`
 * means the stream was already errored.
 */
type ChunkOutcome = "enqueue" | "consumed" | "failed"

/**
 * What a handler needs besides the chunk: the shared question context both
 * transports pass, widened with the turn this transport was built with and the
 * session id the stream reports about itself.
 */
type ChunkContext = ChatChunkContext & {
  /** The last 8 characters of the sub-chat id, which is what the stream logs tag. */
  subId: string
  cwd: string
  mode: AgentMode
  prompt: string
  images: ImageAttachment[]
  /** Written by this stream's own metadata chunk, read by the suggestion after it. */
  sessionId: string | null
  /**
   * The turn generation this stream bumped when it started. A suggestion is
   * stored under it, so a late chunk arriving after a newer send is refused
   * instead of overwriting the newer turn's own.
   */
  turnGeneration: number
}

type ChunkController = ReadableStreamDefaultController<SDKUIMessageChunk>

/**
 * What this session opened with. `chat-chunk-atoms.ts` leaves this one in each
 * transport on purpose: the native runtime reads a cached snapshot and fills
 * the gaps, while the Claude CLI reports the full set on init.
 */
function recordSessionInfo(chunk: SubscriptionChunk): void {
  if (chunk.type !== "session-init") return
  appStore.set(sessionInfoAtom, {
    tools: chunk.tools,
    mcpServers: chunk.mcpServers,
    plugins: chunk.plugins,
    skills: chunk.skills,
  })
}
/**
 * An auth failure keeps this tree's modal-and-retry flow rather than a toast:
 * park the turn so the modal can resend it after OAuth, then error the stream
 * instead of closing it so the chat leaves "streaming" and the user can retry.
 */
function failTurnForAuth(ctx: ChunkContext, controller: ChunkController): ChunkOutcome {
  // Store the failed message for retry after successful auth.
  // readyToRetry=false prevents immediate retry; the modal sets it to true.
  appStore.set(pendingAuthRetryMessageAtom, {
    subChatId: ctx.subChatId,
    provider: "claude-code",
    prompt: ctx.prompt,
    ...(ctx.images.length > 0 && { images: ctx.images }),
    readyToRetry: false,
  })
  appStore.set(claudeLoginModalConfigAtom, {
    hideCustomModelSettingsLink: false,
    autoStartAuth: false,
  })
  // Show the Claude Code login modal
  appStore.set(agentsLoginModalOpenAtom, true)
  console.log(`[SD] R:AUTH_ERR sub=${ctx.subId}`)
  // controller.error() rather than controller.close(), so the SDK Chat resets
  // status from "streaming" to "ready".
  controller.error(new Error("Authentication required"))
  return "failed"
}

/**
 * A prompt suggestion belongs to the turn that produced it. The session id
 * arrives on the metadata chunk the transform emits before the suggestion, so a
 * late suggestion from an aborted or older run in the same sub-chat is dropped
 * instead of overwriting this turn's. Neither chunk is one the AI SDK knows:
 * the suggestion is consumed, the metadata is passed on.
 */
function routePromptSuggestion(chunk: SubscriptionChunk, ctx: ChunkContext): ChunkOutcome {
  // Learn the session before the suggestion that follows it. The subscription's
  // chunk type carries the metadata as unknown, so it is read through a
  // predicate rather than a cast at the use site.
  if (chunk.type === "message-metadata" && hasSessionId(chunk.messageMetadata)) {
    ctx.sessionId = chunk.messageMetadata.sessionId
  }
  if (chunk.type !== "prompt-suggestion") return "enqueue"
  if (ctx.sessionId && chunk.sessionId !== ctx.sessionId) return "consumed"
  // The preference and the turn generation decide together: an inherited
  // environment variable can make the CLI emit this while the app's switch is
  // off, and a session id is reused across turns, so neither the switch nor
  // the session alone answers whether the composer may still offer it.
  const mayStore = mayStoreSuggestion({
    preferenceOn: appStore.get(promptSuggestionsEnabledAtom),
    capturedTurn: ctx.turnGeneration,
    currentTurn: appStore.get(subChatTurnGenerationAtomFamily(ctx.subChatId)),
  })
  if (!mayStore) return "consumed"
  appStore.set(subChatPromptSuggestionAtomFamily(ctx.subChatId), {
    text: chunk.suggestion,
    turn: ctx.turnGeneration,
    engine: "legacy",
  })
  return "consumed"
}

/** A retry the CLI is already performing: said once, and not a stream chunk. */
function announceRetry(chunk: SubscriptionChunk): ChunkOutcome {
  if (chunk.type !== "retry-notification") return "enqueue"
  toast.info("Retrying request", {
    description: chunk.message || "Request was unsuccessful, trying again...",
    duration: 4000,
  })
  return "consumed"
}

/**
 * The copy an error toast shows, and the full text its copy action hands over.
 * The category and debug payload come from the caller, which already read them
 * for the log and Sentry, so the fallback is not decided twice.
 */
function errorToastCopy(
  chunk: Extract<SubscriptionChunk, { type: "error" }>,
  ctx: ChunkContext,
  category: string,
  debugInfo: unknown,
): { title: string; description: string; details: string } {
  // Available for every error, not only the categories this app recognizes.
  const details = [
    `Error: ${chunk.errorText || "Unknown error"}`,
    `Category: ${category}`,
    `Chat ID: ${ctx.chatId}`,
    `SubChat ID: ${ctx.subChatId}`,
    `CWD: ${ctx.cwd}`,
    `Mode: ${ctx.mode}`,
    `Timestamp: ${new Date().toISOString()}`,
    debugInfo ? `Debug Info: ${JSON.stringify(debugInfo, null, 2)}` : null,
  ]
    .filter(Boolean)
    .join("\n")

  const config = ERROR_TOAST_CONFIG[category]
  // For auth and API key failures the backend's own wording wins: it names the
  // credential that failed, which this app's copy cannot.
  const prefersBackendError =
    category === "AUTH_FAILURE" ||
    category === "INVALID_API_KEY_SDK" ||
    category === "INVALID_API_KEY"
  const rawDescription = prefersBackendError
    ? chunk.errorText || config?.description || "An unexpected error occurred"
    : config?.description || chunk.errorText || "An unexpected error occurred"
  return {
    title: config?.title || "Claude error",
    // Truncate long descriptions for the toast (keep the first 300 chars).
    description:
      rawDescription.length > 300 ? `${rawDescription.slice(0, 300)}...` : rawDescription,
    details,
  }
}

/**
 * An error chunk is logged, sent to Sentry and toasted, and then still handed to
 * the AI SDK: its message part is what the transcript shows afterwards.
 */
function reportErrorChunk(chunk: SubscriptionChunk, ctx: ChunkContext): void {
  if (chunk.type !== "error") return
  const debugInfo = "debugInfo" in chunk ? chunk.debugInfo : undefined
  const category = debugInfo?.category || "UNKNOWN"

  // Detailed SDK error logging for debugging
  console.error(`[SDK ERROR] ========================================`)
  console.error(`[SDK ERROR] Category: ${category}`)
  console.error(`[SDK ERROR] Error text: ${chunk.errorText}`)
  console.error(`[SDK ERROR] Chat ID: ${ctx.chatId}`)
  console.error(`[SDK ERROR] SubChat ID: ${ctx.subChatId}`)
  console.error(`[SDK ERROR] CWD: ${ctx.cwd}`)
  console.error(`[SDK ERROR] Mode: ${ctx.mode}`)
  if (debugInfo) {
    console.error(`[SDK ERROR] Debug info:`, JSON.stringify(debugInfo, null, 2))
  }
  console.error(`[SDK ERROR] Full chunk:`, JSON.stringify(chunk, null, 2))
  console.error(`[SDK ERROR] ========================================`)

  Sentry.captureException(new Error(chunk.errorText || "Claude transport error"), {
    tags: { errorCategory: category, mode: ctx.mode },
    extra: { debugInfo, cwd: ctx.cwd, chatId: ctx.chatId, subChatId: ctx.subChatId },
  })

  const { title, description, details } = errorToastCopy(chunk, ctx, category, debugInfo)
  toast.error(title, {
    description,
    duration: 12000,
    action: {
      label: "Copy Error",
      onClick: () => {
        navigator.clipboard.writeText(details)
        toast.success("Error details copied to clipboard")
      },
    },
  })
}

/** Enqueue without crashing on a stream that is already closed. */
function enqueueChunk(controller: ChunkController, chunk: SubscriptionChunk): void {
  try {
    controller.enqueue(chunk as SDKUIMessageChunk)
  } catch {
    // Stream already closed, ignore enqueue failure
  }
}

/** Close without crashing on a stream that is already closed. */
function closeQuietly(controller: ChunkController): void {
  try {
    controller.close()
  } catch {
    // Already closed
  }
}

/**
 * The side effects a chunk has, in the order the stream needs them: questions
 * first, so the stale-question clear sees the one just asked, then compaction
 * and session info, then the chunks that end the turn or belong to this app
 * rather than to the AI SDK.
 */
function routeChunk(
  chunk: SubscriptionChunk,
  ctx: ChunkContext,
  controller: ChunkController,
): ChunkOutcome {
  applyQuestionChunks(chunk, ctx)
  applyCompactingChunks(chunk, ctx.subChatId)
  recordSessionInfo(chunk)
  clearStalePendingQuestion(chunk, ctx.subChatId)

  if (chunk.type === "auth-error") return failTurnForAuth(ctx, controller)
  const suggestion = routePromptSuggestion(chunk, ctx)
  if (suggestion !== "enqueue") return suggestion
  const retry = announceRetry(chunk)
  if (retry !== "enqueue") return retry
  reportErrorChunk(chunk, ctx)
  return "enqueue"
}

export class IPCChatTransport implements ChatTransport<UIMessage> {
  constructor(private config: IPCChatTransportConfig) {}

  async sendMessages(options: SendMessagesOptions): Promise<ReadableStream<SDKUIMessageChunk>> {
    const { prompt, images } = lastUserPrompt(options.messages)

    // Get sessionId for resume (server preserves sessionId on abort so
    // the next message can resume with full conversation context)
    const lastAssistant = [...options.messages].reverse().find((m) => m.role === "assistant")
    const metadata = lastAssistant?.metadata as AgentMessageMetadata | undefined
    const sessionId = metadata?.sessionId

    // Read extended thinking setting dynamically (so toggle applies to existing chats)
    const thinkingEnabled = appStore.get(extendedThinkingEnabledAtom)
    // Adaptive lets the model pick its own budget; disabled is what the toggle
    // off has always meant but could not say while the field was a token count.
    const thinking = thinkingEnabled
      ? ({ type: "adaptive" } as const)
      : ({ type: "disabled" } as const)
    // null is "let the CLI choose", so a chat that never opened the picker keeps
    // the model's own default instead of a level this app guessed. Read from
    // THIS sub-chat's slot: two split panes carry two answers.
    const effort = appStore.get(subChatClaudeEffortAtomFamily(this.config.subChatId))
    const promptSuggestions = appStore.get(promptSuggestionsEnabledAtom)
    const historyEnabled = appStore.get(historyEnabledAtom)
    const enableTasks = appStore.get(enableTasksAtom)

    // Read model selection dynamically per sub-chat (so split panes stay independent)
    const selectedModelId = appStore.get(subChatModelIdAtomFamily(this.config.subChatId))
    const modelString = MODEL_ID_MAP[selectedModelId] || MODEL_ID_MAP.opus

    const storedCustomConfig = appStore.get(customClaudeConfigAtom) as CustomClaudeConfig
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
        .allSubChats.find((subChat) => subChat.id === this.config.subChatId)?.mode ||
      this.config.mode

    // A suggestion belongs to the turn that produced it, so starting a turn
    // bumps the generation — the store refuses a late chunk from the stream
    // this send supersedes — and clears the last one: the composer must not
    // offer a previous request's next step, and clicking it must not insert
    // that into this prompt.
    const turnGeneration = appStore.get(subChatTurnGenerationAtomFamily(this.config.subChatId)) + 1
    appStore.set(subChatTurnGenerationAtomFamily(this.config.subChatId), turnGeneration)
    appStore.set(subChatPromptSuggestionAtomFamily(this.config.subChatId), null)
    // Aborting or failing this turn takes its suggestion with it, but only if
    // it is still this turn's: a superseding send may already have begun, and
    // its own suggestion must not be wiped by the stream it replaced.
    const clearOwnSuggestion = () => {
      const entry = appStore.get(subChatPromptSuggestionAtomFamily(this.config.subChatId))
      if (entry?.turn === turnGeneration) {
        appStore.set(subChatPromptSuggestionAtomFamily(this.config.subChatId), null)
      }
    }

    // Stream tracking
    let _chunkCount = 0
    let _lastChunkType = ""
    // One context for the chunk handlers, so the session id this stream reports
    // about itself is visible to the suggestion that follows it.
    const ctx: ChunkContext = {
      chatId: this.config.chatId,
      subChatId: this.config.subChatId,
      subId: this.config.subChatId.slice(-8),
      cwd: this.config.cwd,
      mode: currentMode,
      prompt,
      images,
      sessionId: null,
      turnGeneration,
    }

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
            thinking,
            ...(effort && { effort }),
            // Sent in both directions: with the option absent, an inherited
            // `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` in the shell decides,
            // and the app's switch stops being the switch.
            promptSuggestions,
            ...(modelString && { model: modelString }),
            ...(customConfig && { customConfig }),
            ...(selectedOllamaModel && { selectedOllamaModel }),
            historyEnabled,
            offlineModeEnabled,
            enableTasks,
            ...(images.length > 0 && { images }),
          },
          {
            onData: (chunk: SubscriptionChunk) => {
              _chunkCount++
              _lastChunkType = chunk.type

              // A provider failure arrives as an ordinary data chunk and is
              // toasted by `routeChunk` — it never hits this subscription's
              // `onError`. A failed turn leaves no next step behind: withdraw
              // this turn's suggestion under the same generation guard as
              // abort and transport failure, so a row stored before the
              // failure cannot still be offered afterwards.
              if (chunk.type === "error" || chunk.type === "auth-error") {
                clearOwnSuggestion()
              }

              if (routeChunk(chunk, ctx, controller) !== "enqueue") return
              enqueueChunk(controller, chunk)
              if (chunk.type === "finish") closeQuietly(controller)
            },
            onError: (err: Error) => {
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

              clearOwnSuggestion()
              controller.error(err)
            },
            onComplete: () => {
              // Note: Don't clear pending questions here - let active-chat.tsx handle it
              // via the stream stop detection effect. Clearing here causes race conditions
              // where sync effect immediately restores from messages.
              closeQuietly(controller)
            },
          },
        )

        // Handle abort
        options.abortSignal?.addEventListener("abort", () => {
          // A stopped turn leaves no next step behind: whatever arrived from
          // it is withdrawn with the same generation guard as the error path.
          clearOwnSuggestion()
          sub.unsubscribe()
          // trpcClient.claude.cancel.mutate({ subChatId: this.config.subChatId })
          closeQuietly(controller)
        })
      },
    })
  }

  async reconnectToStream(): Promise<ReadableStream<SDKUIMessageChunk> | null> {
    return null // Not needed for local app
  }
}
