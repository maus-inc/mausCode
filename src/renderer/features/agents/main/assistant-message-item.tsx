"use client"

import { useAtomValue } from "jotai"
import { ListTree, MoreHorizontal } from "lucide-react"
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { normalizeCodexToolPart } from "../../../../shared/codex-tool-normalizer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { CollapseIcon, ExpandIcon, QuestionIcon } from "../../../components/ui/icons"
import { TextShimmer } from "../../../components/ui/text-shimmer"
import { soundNotificationsEnabledAtom } from "../../../lib/atoms"
import { appStore } from "../../../lib/jotai-store"
import { keyItems } from "../../../lib/react-keys"
import { cn } from "../../../lib/utils"
import { selectedProjectAtom, showMessageJsonAtom } from "../atoms"
import { isAssistantMessageQuestion } from "../lib/is-question"
import { playQuestionSound } from "../lib/play-question-sound"
import { isSubagentToolType } from "../lib/subagent-tool-types"
import { useFileOpen } from "../mentions"
import type { Message } from "../stores/message-store"
import {
  AgentAskUserQuestionTool,
  type AgentAskUserQuestionToolProps,
} from "../ui/agent-ask-user-question-tool"
import { AgentBashTool } from "../ui/agent-bash-tool"
import { AgentEditTool } from "../ui/agent-edit-tool"
import { AgentExploringGroup } from "../ui/agent-exploring-group"
import { AgentMcpToolCall } from "../ui/agent-mcp-tool-call"
import { type AgentMessageMetadata, AgentMessageUsage } from "../ui/agent-message-usage"
import { AgentPlanFileTool, type AgentPlanFileToolProps } from "../ui/agent-plan-file-tool"
import { AgentPlanTool, type AgentPlanToolProps } from "../ui/agent-plan-tool"
import { AgentTaskTool } from "../ui/agent-task-tool"
import { AgentTaskToolsGroup, type TaskToolPart } from "../ui/agent-task-tools"
import type { ThinkingToolPart } from "../ui/agent-thinking-tool"
import { AgentThinkingTool } from "../ui/agent-thinking-tool"
import { AgentTodoTool, type AgentTodoToolProps } from "../ui/agent-todo-tool"
import { AgentToolCall } from "../ui/agent-tool-call"
import {
  AgentToolRegistry,
  getToolStatus,
  parseMcpToolType,
  type ToolDisplayPart,
} from "../ui/agent-tool-registry"
import { isTerminalStateString } from "../ui/agent-tool-state"
import { isPlanFile, nestingFingerprintOf } from "../ui/agent-tool-utils"
import { AgentWebFetchTool } from "../ui/agent-web-fetch-tool"
import { AgentWebSearchCollapsible } from "../ui/agent-web-search-collapsible"
import { GitActivityBadges } from "../ui/git-activity-badges"
import { CopyButton, getMessageTextContent, PlayButton } from "../ui/message-action-buttons"
import { MessageJsonDisplay } from "../ui/message-json-display"
import { ForkContext } from "./isolated-message-group"
import { MemoizedTextPart } from "./memoized-text-part"

// Map first word of an ACP tool title to a canonical Claude Code tool type.
// Codex tool calls arrive with type = "tool-Read README.md", "tool-Run echo ---",
// "tool-List /Users/...", "tool-Search *.test.ts in backend", etc.
// input.toolName contains the full ACP title, input.args the raw codex parameters.
const ACP_VERB_TO_TOOL_TYPE: Record<string, string> = {
  Read: "Read",
  Run: "Bash",
  List: "Glob",
  Search: "Grep",
  Grep: "Grep",
  Glob: "Glob",
  Edit: "Edit",
  Write: "Write",
  Thought: "Thinking",
  Fetch: "WebFetch",
  // Gemini/Codex CLI tool names
  replace: "Edit",
  write_file: "Write",
  run_shell_command: "Bash",
  read_file: "Read",
  grep_search: "Grep",
  glob: "Glob",
  update_topic: "Thinking",
}

// Check if a part.type looks like an ACP title-based type (e.g. "tool-Read README.md")
// Returns the verb if matched, null otherwise
function getAcpVerb(partType: string): string | null {
  if (!partType.startsWith("tool-")) return null
  const afterTool = partType.slice(5) // strip "tool-"
  // Check if it starts with a known verb followed by space or end-of-string
  for (const verb of Object.keys(ACP_VERB_TO_TOOL_TYPE)) {
    if (afterTool === verb || afterTool.startsWith(`${verb} `)) {
      return verb
    }
  }
  return null
}

// Normalize ACP/codex tool parts into canonical types so grouping and rendering work.
// Handles two formats:
// 1. Streaming: type="tool-acp.acp_provider_agent_dynamic_tool", input={toolName, args}
// 2. Persisted/live: type="tool-Read README.md", input={toolName, args}
// View over normalized message parts: every field the renderers below read.
// Parts flow in untyped (message: any), so each use site narrows from this view.
interface NormalizedPart {
  type: string
  text?: string
  toolCallId?: string
  state?: string
  input?: unknown
  output?: unknown
  result?: unknown
  errorText?: string
  error?: unknown
}

/**
 * React key for a top-level message part: the tool call id when the part carries
 * one, otherwise the part type plus a grouping fingerprint. Group parts
 * (`exploring-group`, `task-group`) have no id of their own, and they appear at the
 * position their first child was appended, so "type + child count" stays stable
 * across the streaming renders that make index keys fragile.
 */
function partKeyOf(part: unknown): string {
  const p = part as { toolCallId?: unknown; type?: unknown; parts?: unknown }
  if (typeof p.toolCallId === "string" && p.toolCallId) return p.toolCallId
  const children = Array.isArray(p.parts) ? p.parts.length : ""
  return `${typeof p.type === "string" ? p.type : "part"}${children}`
}

/** A normalized part or a marker group built by the grouping passes. */
type GroupedMessagePart =
  | NormalizedPart
  | { type: "exploring-group"; parts: NormalizedPart[] }
  | { type: "task-group"; parts: NormalizedPart[] }

/** Loose view of a reasoning/thinking part for the thinking helpers. */
type ReasoningPartView = {
  type?: string
  text?: unknown
  state?: unknown
  toolCallId?: unknown
  id?: unknown
  toolName?: unknown
  input?: unknown
  result?: unknown
  output?: unknown
  startedAt?: unknown
}

function normalizeAcpParts(parts: unknown[]): NormalizedPart[] {
  return parts.map((raw) => {
    const part = raw as NormalizedPart
    if (!part.type?.startsWith("tool-")) return part

    // Guard: only process ACP parts, not Claude Code parts.
    // ACP parts have: input.toolName, or space in type (e.g. "tool-Read README.md"),
    // or the proxy tool name. Claude Code parts have exact types like "tool-Read".
    const partToolName = (part.input as { toolName?: unknown } | undefined)?.toolName
    const isAcpPart =
      partToolName ||
      part.type.includes(" ") ||
      part.type === "tool-acp.acp_provider_agent_dynamic_tool"
    if (!isAcpPart) return part

    const partInput =
      part.input && typeof part.input === "object"
        ? (part.input as { toolName?: string; args?: unknown })
        : {}

    // Determine the ACP title — either from the type itself or from input.toolName
    let title: string | null = null
    let args: Record<string, unknown> = {}

    // Case 1: type is already the title-based type (e.g. "tool-Read README.md")
    const verb = getAcpVerb(part.type)
    if (verb) {
      title = partInput.toolName || part.type.slice(5)
      args =
        partInput.args && typeof partInput.args === "object"
          ? (partInput.args as Record<string, unknown>)
          : partInput
    }

    // Case 2: type is the ACP proxy tool name
    if (!verb && part.type === "tool-acp.acp_provider_agent_dynamic_tool") {
      let input = part.input
      if (typeof input === "string") {
        try {
          input = JSON.parse(input)
        } catch {
          return part
        }
      }
      const parsedInput =
        input && typeof input === "object" ? (input as { toolName?: string; args?: unknown }) : {}
      if (parsedInput.toolName) {
        title = parsedInput.toolName
        args =
          parsedInput.args && typeof parsedInput.args === "object"
            ? (parsedInput.args as Record<string, unknown>)
            : parsedInput
      }
    }

    if (!title) return part

    // Parse the first word of the title to get canonical tool type
    const spaceIdx = title.indexOf(" ")
    const titleVerb = spaceIdx === -1 ? title : title.slice(0, spaceIdx)
    const detail = spaceIdx === -1 ? "" : title.slice(spaceIdx + 1)
    const canonicalType = ACP_VERB_TO_TOOL_TYPE[titleVerb]

    if (!canonicalType) return part

    // Enrich input with fields that the tool registry expects for display
    const enrichedInput: Record<string, unknown> = { ...args, _acpTitle: title, _acpDetail: detail }

    if (canonicalType === "Thinking" && !enrichedInput.text) {
      enrichedInput.text = enrichedInput.summary || enrichedInput.title || detail
    }

    if (canonicalType === "Read" && !enrichedInput.file_path && detail) {
      enrichedInput.file_path = detail
    }
    if (canonicalType === "Bash") {
      // Codex passes command as array ['/bin/zsh', '-lc', 'actual command'] — extract shell string
      if (Array.isArray(enrichedInput.command)) {
        enrichedInput.command = enrichedInput.command[enrichedInput.command.length - 1] || detail
      } else if (!enrichedInput.command && detail) {
        enrichedInput.command = detail
      }
    }
    if (canonicalType === "Grep" && !enrichedInput.pattern && detail) {
      enrichedInput.pattern = detail
    }
    if (canonicalType === "Glob" && !enrichedInput.pattern && detail) {
      enrichedInput.pattern = detail
    }

    return {
      ...part,
      type: `tool-${canonicalType}`,
      input: enrichedInput,
      output: part.output,
    }
  })
}

type NestingIndex = {
  nestedToolsMap: Map<string, NormalizedPart[]>
  nestedToolIds: Set<string>
  orphanTaskGroups: Map<string, { parts: NormalizedPart[]; firstToolCallId: string }>
  orphanToolCallIds: Set<string>
  orphanFirstToolCallIds: Set<string>
}

/**
 * Which parts nest under which subagent, and which ones lost their parent.
 *
 * A composite id is `parentOriginal:childOriginal` — the SDK names a child's
 * parent by that parent's ORIGINAL tool id, never by the parent's own
 * composite — so a nested task's original id is its last segment, and it is
 * what the task's own children carry before the colon. Looking the first
 * segment up in the top-level ids alone (what this did before) finds `A` under
 * `A:B`, but orphans everything under `A:B`, because no top-level task is ever
 * named just `B`.
 *
 * Module scope so the useMemo above it is one line and this function owns its
 * own complexity: the dispatcher's cognitive-complexity budget is for the
 * render branches, not for bookkeeping the pure rules already test.
 */
function buildNestingIndex(messageParts: NormalizedPart[]): NestingIndex {
  const nestedToolsMap = new Map<string, NormalizedPart[]>()
  const nestedToolIds = new Set<string>()
  const taskParts = messageParts.filter(
    (p): p is NormalizedPart & { toolCallId: string } =>
      isSubagentToolType(p.type) && !!p.toolCallId,
  )
  const taskFullIdByOriginalId = new Map<string, string>()
  for (const task of taskParts) {
    const segments = task.toolCallId.split(":")
    taskFullIdByOriginalId.set(segments.at(-1) ?? task.toolCallId, task.toolCallId)
  }
  const orphanTaskGroups = new Map<string, { parts: NormalizedPart[]; firstToolCallId: string }>()
  const orphanToolCallIds = new Set<string>()
  const orphanFirstToolCallIds = new Set<string>()

  for (const part of messageParts) {
    if (!part.toolCallId?.includes(":")) continue
    const parentOriginalId = part.toolCallId.split(":")[0]
    const parentFullId =
      parentOriginalId === undefined ? undefined : taskFullIdByOriginalId.get(parentOriginalId)
    // The self check is the cycle guard: a part that names itself as its
    // own parent would otherwise sit in its own children forever.
    if (parentFullId !== undefined && parentFullId !== part.toolCallId) {
      // Keyed by the parent's FULL id: that is the id `renderSubagentTask`
      // looks children up by, whether the parent sits at the top level
      // (`A`) or inside another task (`A:B`).
      if (!nestedToolsMap.has(parentFullId)) {
        nestedToolsMap.set(parentFullId, [])
      }
      nestedToolsMap.get(parentFullId)?.push(part)
      nestedToolIds.add(part.toolCallId)
      continue
    }
    let group = orphanTaskGroups.get(parentOriginalId ?? "")
    if (!group) {
      group = { parts: [], firstToolCallId: part.toolCallId }
      orphanTaskGroups.set(parentOriginalId ?? "", group)
      orphanFirstToolCallIds.add(part.toolCallId)
    }
    group.parts.push(part)
    orphanToolCallIds.add(part.toolCallId)
  }

  return {
    nestedToolsMap,
    nestedToolIds,
    orphanTaskGroups,
    orphanToolCallIds,
    orphanFirstToolCallIds,
  }
}

// Exploring tools - these get grouped when 3+ consecutive
const EXPLORING_TOOLS = new Set([
  "tool-Read",
  "tool-Grep",
  "tool-Glob",
  "tool-WebSearch",
  "tool-WebFetch",
])

// Task management tools - these get grouped when consecutive
const TASK_TOOLS = new Set(["tool-TaskCreate", "tool-TaskUpdate", "tool-TaskGet", "tool-TaskList"])

const STREAMING_REASONING_STATES = new Set(["streaming", "in_progress", "input-streaming"])
const DONE_REASONING_STATES = new Set(["done", "completed", "result", "output-available"])
const ERROR_REASONING_STATES = new Set(["error", "output-error"])

function mapReasoningStateToThinkingState(state: unknown): string {
  if (typeof state !== "string") {
    return "output-available"
  }

  const normalized = state.trim().toLowerCase()
  if (STREAMING_REASONING_STATES.has(normalized)) return "input-streaming"
  if (DONE_REASONING_STATES.has(normalized)) return "output-available"
  if (ERROR_REASONING_STATES.has(normalized)) return "output-error"
  return "output-available"
}

function getThinkingText(part: ReasoningPartView): string {
  const input = part?.input as { text?: unknown } | undefined
  if (typeof input?.text === "string") return input.text
  if (typeof part?.text === "string") return part.text
  return ""
}

function toThinkingToolPart(
  part: ReasoningPartView,
  messageId: string | undefined,
  index: number,
): ThinkingToolPart & { toolCallId: string; toolName: string; result?: unknown } {
  const normalizedState = mapReasoningStateToThinkingState(part.state)
  const text = getThinkingText(part)
  const toolCallId =
    typeof part.toolCallId === "string" && part.toolCallId.length > 0
      ? part.toolCallId
      : typeof part.id === "string" && part.id.length > 0
        ? part.id
        : `reasoning-${messageId || "message"}-${index}`
  const toolName = typeof part.toolName === "string" ? part.toolName : "Thinking"
  const input = {
    ...(part.input && typeof part.input === "object" ? part.input : {}),
    text,
  }
  const startedAt = part.startedAt as number | undefined

  if (normalizedState !== "output-available") {
    return { type: "tool-Thinking", toolCallId, toolName, input, state: normalizedState, startedAt }
  }

  const completedResult = { completed: true }
  return {
    type: "tool-Thinking",
    toolCallId,
    toolName,
    input,
    state: normalizedState,
    startedAt,
    result: part.result ?? completedResult,
    output: (part.output as { completed?: boolean } | undefined) ?? completedResult,
  }
}

// Group consecutive exploring tools into exploring-group
function groupExploringTools(
  parts: GroupedMessagePart[],
  nestedToolIds: Set<string>,
): GroupedMessagePart[] {
  const result: GroupedMessagePart[] = []
  let currentGroup: NormalizedPart[] = []

  for (const part of parts) {
    // Pass through markers built by the other grouping pass.
    if ("parts" in part) {
      if (currentGroup.length >= 3) {
        result.push({ type: "exploring-group", parts: currentGroup })
      } else {
        result.push(...currentGroup)
      }
      currentGroup = []
      result.push(part)
      continue
    }

    const isNested = part.toolCallId ? nestedToolIds.has(part.toolCallId) : false

    if (EXPLORING_TOOLS.has(part.type) && !isNested) {
      currentGroup.push(part)
    } else {
      if (currentGroup.length >= 3) {
        result.push({ type: "exploring-group", parts: currentGroup })
      } else {
        result.push(...currentGroup)
      }
      currentGroup = []
      result.push(part)
    }
  }
  if (currentGroup.length >= 3) {
    result.push({ type: "exploring-group", parts: currentGroup })
  } else {
    result.push(...currentGroup)
  }
  return result
}

// Group consecutive task tools into task-group
function groupTaskTools(
  parts: GroupedMessagePart[],
  nestedToolIds: Set<string>,
): GroupedMessagePart[] {
  const result: GroupedMessagePart[] = []
  let currentGroup: NormalizedPart[] = []

  for (const part of parts) {
    // Pass through markers built by the other grouping pass.
    if ("parts" in part) {
      if (currentGroup.length >= 1) {
        result.push({ type: "task-group", parts: currentGroup })
      }
      currentGroup = []
      result.push(part)
      continue
    }

    const isNested = part.toolCallId ? nestedToolIds.has(part.toolCallId) : false

    if (TASK_TOOLS.has(part.type) && !isNested) {
      currentGroup.push(part)
    } else {
      if (currentGroup.length >= 1) {
        result.push({ type: "task-group", parts: currentGroup })
      }
      currentGroup = []
      result.push(part)
    }
  }
  if (currentGroup.length >= 1) {
    result.push({ type: "task-group", parts: currentGroup })
  }
  return result
}

// Collapsible steps component
interface CollapsibleStepsProps {
  stepsCount: number
  children: React.ReactNode
  defaultExpanded?: boolean
}

function CollapsibleSteps({
  stepsCount,
  children,
  defaultExpanded = false,
}: CollapsibleStepsProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  if (stepsCount === 0) return null

  return (
    <div className="mb-2" data-collapsible-steps="true">
      {/* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */}
      <div
        className="flex items-center justify-between rounded-md py-0.5 px-2 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
      >
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ListTree className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="font-medium whitespace-nowrap">
            {stepsCount} {stepsCount === 1 ? "step" : "steps"}
          </span>
        </div>
        <button
          type="button"
          className="p-1 rounded-md hover:bg-accent transition-[background-color,transform] duration-150 ease-out active:scale-95"
          onClick={(e) => {
            e.stopPropagation()
            setIsExpanded(!isExpanded)
          }}
        >
          <div className="relative w-4 h-4">
            <ExpandIcon
              className={cn(
                "absolute inset-0 w-4 h-4 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-0 scale-75" : "opacity-100 scale-100",
              )}
            />
            <CollapseIcon
              className={cn(
                "absolute inset-0 w-4 h-4 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                isExpanded ? "opacity-100 scale-100" : "opacity-0 scale-75",
              )}
            />
          </div>
        </button>
      </div>
      {isExpanded && <div className="mt-1 space-y-1.5">{children}</div>}
    </div>
  )
}

// ============================================================================
// ASSISTANT MESSAGE ITEM - MEMOIZED BY MESSAGE ID + PARTS LENGTH
// ============================================================================

export interface AssistantMessageItemProps {
  message: Message
  isLastMessage: boolean
  isStreaming: boolean
  status: string
  isMobile: boolean
  subChatId: string
  chatId: string
  sandboxSetupStatus?: "cloning" | "ready" | "error"
}

// Cache for tracking previous message state per sub-chat/message
// (to detect AI SDK in-place mutations without cross-chat collisions)
// Stores both text lengths and tool states for complete change detection
interface PartIOSnapshot {
  state: string | undefined
  input: unknown
  output: unknown
  json: string | undefined
}

interface MessageStateSnapshot {
  textLengths: number[]
  partStates: (string | undefined)[]
  /**
   * Every part's input and output, stringified — but only once per state of
   * the part. A nested tool can mutate either in place while its state and
   * every text length around it stay unchanged, and nothing downstream of
   * this memo runs when it skips a render, so the check has to see it. The
   * cost stays bounded because a part whose state string is terminal and
   * whose input/output references are unchanged is SETTLED: the SDK does not
   * reopen a completed part, so its cached string still describes it and the
   * comparison reuses it in O(1). Only live parts (streaming input, growing
   * output) serialize per comparison, bounded by the active tool's payload
   * rather than the whole transcript's — the round-9 reviews' point.
   */
  partIO: PartIOSnapshot[]
}
const messageStateCache = new Map<string, MessageStateSnapshot>()

// Tracks message IDs we've already played the question chime for, so resume/
// re-mounts don't replay the sound for old questions in the same session.
const questionSoundPlayedFor = new Set<string>()

export function clearMessageStateCacheByMessageIds(subChatId: string, messageIds: string[]) {
  for (const id of messageIds) {
    messageStateCache.delete(`${subChatId}:${id}`)
  }
}

function getTrackedPartTextLength(part: ReasoningPartView): number {
  if (part?.type === "text") {
    return typeof part.text === "string" ? part.text.length : 0
  }

  if (part?.type === "reasoning") {
    return typeof part.text === "string" ? part.text.length : 0
  }

  if (part?.type === "tool-Thinking") {
    const input = part?.input as { text?: unknown } | undefined
    if (typeof input?.text === "string") return input.text.length
    if (typeof part?.text === "string") return part.text.length
    return 0
  }

  return -1
}

// Custom comparison - check if message content actually changed
// CRITICAL: AI SDK mutates objects in-place! So prev.message.parts[i].text === next.message.parts[i].text
// even when text HAS changed (they're the same mutated object).
// Solution: Cache state externally and compare those.
function areMessagePropsEqual(
  prev: AssistantMessageItemProps,
  next: AssistantMessageItemProps,
): boolean {
  const msgId = next.message?.id
  const cacheKey = msgId ? `${next.subChatId}:${msgId}` : null

  // Different message ID = different message
  if (prev.message?.id !== next.message?.id) {
    return false
  }

  // Check other props first (cheap comparisons)
  if (prev.status !== next.status) return false
  if (prev.isStreaming !== next.isStreaming) return false
  if (prev.isLastMessage !== next.isLastMessage) return false
  if (prev.isMobile !== next.isMobile) return false
  if (prev.subChatId !== next.subChatId) return false
  if (prev.chatId !== next.chatId) return false
  if (prev.sandboxSetupStatus !== next.sandboxSetupStatus) return false

  // Get current message state from parts
  const nextParts = next.message?.parts || []

  // Read the previous snapshot first: the per-part IO check below reuses its
  // strings for settled parts instead of serializing them again.
  const cachedState = cacheKey ? messageStateCache.get(cacheKey) : undefined

  const currentState: MessageStateSnapshot = {
    textLengths: nextParts.map((p) => getTrackedPartTextLength(p)),
    // Track ALL part states - critical for detecting Edit plan file streaming!
    partStates: nextParts.map((p) => p.state),
    // Track every part's input AND output — tool streaming arrives as in-place
    // mutation of both, on non-last parts too (parallel calls, nested tools).
    partIO: nextParts.map((p, i) => {
      const prev = cachedState?.partIO?.[i]
      if (
        prev !== undefined &&
        prev.state === p.state &&
        prev.input === p.input &&
        prev.output === p.output &&
        isTerminalStateString(prev.state)
      ) {
        return prev // settled: same terminal state, same references
      }
      return {
        state: p.state,
        input: p.input,
        output: p.output,
        json:
          p.input === undefined && p.output === undefined
            ? undefined
            : JSON.stringify([p.input, p.output]),
      }
    }),
  }

  // If no cache, this is first comparison - cache and allow render
  if (!cachedState || !cacheKey) {
    if (cacheKey) messageStateCache.set(cacheKey, currentState)
    return false // First render - must render
  }

  // Compare parts count
  if (cachedState.textLengths.length !== currentState.textLengths.length) {
    messageStateCache.set(cacheKey, currentState)
    return false // Parts count changed
  }

  // Compare text lengths (detects streaming text changes!)
  for (let i = 0; i < currentState.textLengths.length; i++) {
    if (cachedState.textLengths[i] !== currentState.textLengths[i]) {
      messageStateCache.set(cacheKey, currentState)
      return false // Text length changed = content changed
    }
  }

  // Compare every part's input/output (detects in-place tool streaming the
  // state and text-length checks cannot see). Settled parts carried their
  // cached string over above, so this is a reference compare for them.
  for (let i = 0; i < currentState.partIO.length; i++) {
    if (cachedState.partIO?.[i]?.json !== currentState.partIO[i].json) {
      messageStateCache.set(cacheKey, currentState)
      return false // A part's input or output changed
    }
  }

  // Compare ALL part states (detects Edit plan file streaming!)
  for (let i = 0; i < currentState.partStates.length; i++) {
    if (cachedState.partStates[i] !== currentState.partStates[i]) {
      messageStateCache.set(cacheKey, currentState)
      return false // Part state changed
    }
  }

  // Nothing changed - skip re-render
  return true
}

/** One plan-file operation this message carries, in the order it arrived. */
type PlanOperation = { type: "write" | "edit"; part: NormalizedPart; index: number }

/** What the plan-file pass found across the whole message. */
type PlanOpsSummary = {
  operations: PlanOperation[]
  hasAnyPlanOperation: boolean
  isStreaming: boolean
  lastOperationType: "write" | "edit" | null
}

/**
 * Everything a part renderer reads that is not the part itself: this message's
 * identity and stream state, the grouping its parts implied, and how it
 * collapses. One object instead of eighteen closure reads, which is what lets
 * the dispatch and the renderers live at module scope, be read one branch at a
 * time, and be tested without the component that owns the values.
 */
type PartRenderContext = {
  messageId: string
  status: string
  isStreaming: boolean
  isLastMessage: boolean
  subChatId: string
  projectPath: string | undefined
  onOpenFile: ReturnType<typeof useFileOpen>
  nestedToolsMap: Map<string, NormalizedPart[]>
  /** Children of any subagent, by the subagent's full composite id. */
  nestedChildren: (toolCallId: string) => NormalizedPart[]
  /**
   * This render's snapshot of the whole nesting map, for the task-row memo.
   * A plain string so every row compares the same immutable value instead of
   * walking the map through the shared tool-state cache (which would let the
   * first row consume a grandchild mutation for all the others).
   */
  nestingFingerprint: string
  nestedToolIds: Set<string>
  /** Nested calls whose parent task part never arrived. */
  orphans: {
    toolCallIds: Set<string>
    firstToolCallIds: Set<string>
    taskGroups: Map<string, { parts: NormalizedPart[]; firstToolCallId: string }>
  }
  planOps: PlanOpsSummary
  collapse: {
    shouldCollapse: boolean
    collapseBeforeIndex: number
    visibleStepsCount: number
    lastCollapsedPlanOp: PlanOperation | null
  }
}

type PartRenderer = (part: NormalizedPart, idx: number, ctx: PartRenderContext) => ReactNode

/**
 * A nested call under a parent that never arrived, which is not the first of its
 * group: the first one stands in for the missing parent and renders the rest
 * inside itself, so the others are suppressed where they sit.
 */
function isSuppressedOrphan(part: NormalizedPart, ctx: PartRenderContext): boolean {
  const { toolCallIds, firstToolCallIds } = ctx.orphans
  if (!part.toolCallId || !toolCallIds.has(part.toolCallId)) return false
  return !firstToolCallIds.has(part.toolCallId)
}

/** The incomplete task the first orphaned nested call of a group stands in for. */
function renderOrphanTaskGroup(
  part: NormalizedPart,
  idx: number,
  ctx: PartRenderContext,
): ReactNode {
  const { toolCallIds, firstToolCallIds, taskGroups } = ctx.orphans
  if (!part.toolCallId || !toolCallIds.has(part.toolCallId)) return null
  if (!firstToolCallIds.has(part.toolCallId)) return null
  const parentId = part.toolCallId.split(":")[0]
  const group = taskGroups.get(parentId)
  if (!group) return null
  return (
    <AgentTaskTool
      key={idx}
      part={{
        type: "tool-Task",
        toolCallId: parentId,
        input: { subagent_type: "unknown-agent", description: "Incomplete task" },
      }}
      nestedTools={group.parts}
      nestedChildren={ctx.nestedChildren}
      nestingFingerprint={ctx.nestingFingerprint}
      chatStatus={ctx.status}
    />
  )
}

function renderTextPart(
  part: NormalizedPart,
  idx: number,
  isFinal: boolean,
  ctx: PartRenderContext,
): ReactNode {
  const { messageId, isLastMessage, isStreaming, collapse } = ctx
  const { collapseBeforeIndex, visibleStepsCount } = collapse
  if (!part.text?.trim()) return null
  const isFinalText = isFinal && idx === collapseBeforeIndex
  const isTextStreaming = isLastMessage && isStreaming
  return (
    <MemoizedTextPart
      key={idx}
      text={part.text}
      messageId={messageId}
      partIndex={idx}
      isFinalText={isFinalText}
      visibleStepsCount={visibleStepsCount}
      isStreaming={isTextStreaming}
    />
  )
}

function renderSubagentTask(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  const nestedTools = ctx.nestedToolsMap.get(part.toolCallId ?? "") || []
  return (
    <AgentTaskTool
      key={idx}
      part={part}
      nestedTools={nestedTools}
      nestedChildren={ctx.nestedChildren}
      nestingFingerprint={ctx.nestingFingerprint}
      chatStatus={ctx.status}
    />
  )
}

function renderBashTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return (
    <AgentBashTool
      key={idx}
      part={part}
      messageId={ctx.messageId}
      partIndex={idx}
      chatStatus={ctx.status}
    />
  )
}

function renderThinkingTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return (
    <AgentThinkingTool
      key={idx}
      part={toThinkingToolPart(part, ctx.messageId, idx)}
      chatStatus={ctx.status}
    />
  )
}

/** A Write or Edit whose target is a plan file, which the transcript shows as plan steps. */
function isPlanOperationPart(part: NormalizedPart): boolean {
  if (part.type !== "tool-Write" && part.type !== "tool-Edit") return false
  const toolInput = part.input as { file_path?: string } | null | undefined
  return isPlanFile(toolInput?.file_path || "")
}

/**
 * What a plan operation's one-line indicator says: the verb its own tool carries,
 * in the tense the stream state asks for. Four strings behind two questions,
 * which reads as a table here and as a ternary inside a ternary inside JSX there.
 */
function planOperationLabel(isWrite: boolean, isOpStreaming: boolean): string {
  if (isOpStreaming) return isWrite ? "Creating plan..." : "Updating plan..."
  return isWrite ? "Created plan" : "Updated plan"
}

/**
 * Plan files: unified handling
 * - In collapsed steps: all show mini indicator, last collapsed op's card shown separately after finalParts
 * - In final parts: all but last show mini indicator, last shows full card
 */
function renderPlanOperation(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  const { planOps, status, subChatId, isStreaming, isLastMessage, collapse } = ctx
  const { shouldCollapse, collapseBeforeIndex, lastCollapsedPlanOp } = collapse

  // Use part.toolCallId to find operation since idx may be adjusted for collapsed parts
  const opIndex = planOps.operations.findIndex((op) => op.part.toolCallId === part.toolCallId)
  if (opIndex === -1) return null

  const originalIndex = planOps.operations[opIndex]?.index ?? -1
  const isInCollapsedSteps =
    shouldCollapse && collapseBeforeIndex !== -1 && originalIndex < collapseBeforeIndex
  const isLastCollapsedOp = lastCollapsedPlanOp?.part.toolCallId === part.toolCallId
  const isLastOperation = opIndex === planOps.operations.length - 1

  // If this is the last collapsed plan op, hide it here (card shown after CollapsibleSteps)
  if (isInCollapsedSteps && isLastCollapsedOp) {
    return null
  }

  // Show mini indicator for:
  // - All operations in collapsed steps (except last collapsed, handled above)
  // - All operations except last in final parts
  const showMiniIndicator = isInCollapsedSteps || !isLastOperation

  if (showMiniIndicator) {
    const isWrite = part.type === "tool-Write"
    const { isPending } = getToolStatus(part, status)
    const isOpStreaming =
      isPending || (part.state === "input-streaming" && isStreaming && isLastMessage)
    const label = planOperationLabel(isWrite, isOpStreaming)

    return (
      <div key={idx} className="flex items-center gap-1.5 px-2 py-0.5">
        <span className="text-xs text-muted-foreground">
          {isOpStreaming ? (
            <TextShimmer as="span" duration={1.2}>
              {label}
            </TextShimmer>
          ) : (
            label
          )}
        </span>
      </div>
    )
  }

  // Last operation in final parts: show full card
  return (
    <AgentPlanFileTool
      key={idx}
      part={part as AgentPlanFileToolProps["part"]}
      chatStatus={status}
      subChatId={subChatId}
      isEdit={part.type === "tool-Edit"}
    />
  )
}

/** A file edit that is not a plan step: Write and Edit render the same card. */
function renderFileEditTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return (
    <AgentEditTool
      key={idx}
      part={part}
      messageId={ctx.messageId}
      partIndex={idx}
      chatStatus={ctx.status}
    />
  )
}

function renderWebSearch(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return <AgentWebSearchCollapsible key={idx} part={part} chatStatus={ctx.status} />
}

function renderWebFetch(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return <AgentWebFetchTool key={idx} part={part} chatStatus={ctx.status} />
}

function renderPlanWrite(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return (
    <AgentPlanTool key={idx} part={part as AgentPlanToolProps["part"]} chatStatus={ctx.status} />
  )
}

function renderTodoList(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  return (
    <AgentTodoTool
      key={idx}
      part={part as AgentTodoToolProps["part"]}
      chatStatus={ctx.status}
      subChatId={ctx.subChatId}
    />
  )
}

function renderQuestionTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  const { isPending, isError } = getToolStatus(part, ctx.status)
  return (
    <AgentAskUserQuestionTool
      key={idx}
      input={part.input as AgentAskUserQuestionToolProps["input"]}
      result={part.result as AgentAskUserQuestionToolProps["result"]}
      errorText={part.errorText || (typeof part.error === "string" ? part.error : undefined)}
      state={isPending ? "call" : "result"}
      isError={isError}
      isStreaming={ctx.isStreaming && ctx.isLastMessage}
      toolCallId={part.toolCallId}
    />
  )
}

/** A tool the registry knows: one row, clickable when it was a file read. */
function renderRegistryTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  const { onOpenFile, projectPath, status } = ctx
  const meta = AgentToolRegistry[part.type]
  const { isPending, isError } = getToolStatus(part, status)
  // Make Read tool clickable to open file in viewer
  // Capture the path at render: part objects can be mutated in place during streaming.
  const toolInput = part.input as { file_path?: string } | null | undefined
  const readFilePath =
    part.type === "tool-Read" && onOpenFile ? (toolInput?.file_path ?? null) : null
  const handleClick = readFilePath && onOpenFile ? () => onOpenFile(readFilePath) : undefined
  return (
    <AgentToolCall
      key={idx}
      icon={meta.icon}
      title={meta.title(part as ToolDisplayPart)}
      subtitle={meta.subtitle?.(part as ToolDisplayPart)}
      tooltipContent={meta.tooltipContent?.(part as ToolDisplayPart, projectPath)}
      isPending={isPending}
      isError={isError}
      onClick={handleClick}
    />
  )
}

/** A tool nobody registered: an MCP call by its server and tool, else its bare name. */
function renderUnlistedTool(part: NormalizedPart, idx: number, ctx: PartRenderContext): ReactNode {
  // MCP tool calls (pattern: tool-mcp__<server>__<tool>)
  const mcpInfo = parseMcpToolType(part.type)
  if (mcpInfo) {
    return <AgentMcpToolCall key={idx} part={part} mcpInfo={mcpInfo} chatStatus={ctx.status} />
  }

  if (part.type?.startsWith("tool-")) {
    return (
      <div key={idx} className="text-xs text-muted-foreground py-0.5 px-2">
        {part.type.replace("tool-", "")}
      </div>
    )
  }

  return null
}

/**
 * The part types with a renderer of their own. Order does not matter here
 * because the keys are distinct; what does matter is that the dispatcher consults
 * this table only after the shapes that claim a type before its own renderer —
 * a sub-agent task, and a Write or Edit aimed at a plan file.
 */
const PART_RENDERERS: Record<string, PartRenderer> = {
  "tool-Bash": renderBashTool,
  reasoning: renderThinkingTool,
  "tool-Thinking": renderThinkingTool,
  "tool-Write": renderFileEditTool,
  "tool-Edit": renderFileEditTool,
  "tool-WebSearch": renderWebSearch,
  "tool-WebFetch": renderWebFetch,
  "tool-PlanWrite": renderPlanWrite,
  // ExitPlanMode tool is hidden - plan is shown in sidebar instead
  "tool-ExitPlanMode": () => null,
  "tool-TodoWrite": renderTodoList,
  "tool-AskUserQuestion": renderQuestionTool,
}

/**
 * What one part of a message looks like, decided in the order the transcript has
 * always decided it: the suppressions first, then text, then the two shapes that
 * claim a type before its own renderer does, then the table, then the registry,
 * then the shapes nobody registered.
 */
function renderMessagePart(
  part: NormalizedPart,
  idx: number,
  isFinal: boolean,
  ctx: PartRenderContext,
): ReactNode {
  if (part.type === "step-start") return null
  if (isSuppressedOrphan(part, ctx)) return null

  const orphanTask = renderOrphanTaskGroup(part, idx, ctx)
  if (orphanTask) return orphanTask

  if (part.toolCallId && ctx.nestedToolIds.has(part.toolCallId)) return null
  if (part.type === "exploring-group") return null
  if (part.type === "text") return renderTextPart(part, idx, isFinal, ctx)
  if (isSubagentToolType(part.type)) return renderSubagentTask(part, idx, ctx)
  if (isPlanOperationPart(part)) return renderPlanOperation(part, idx, ctx)

  const renderer = PART_RENDERERS[part.type]
  if (renderer) return renderer(part, idx, ctx)
  if (part.type in AgentToolRegistry) return renderRegistryTool(part, idx, ctx)
  return renderUnlistedTool(part, idx, ctx)
}

export const AssistantMessageItem = memo(function AssistantMessageItem({
  message,
  isLastMessage,
  isStreaming,
  status,
  isMobile,
  subChatId,
  chatId,
  sandboxSetupStatus = "ready",
}: AssistantMessageItemProps) {
  const showMessageJson = useAtomValue(showMessageJsonAtom)
  const selectedProject = useAtomValue(selectedProjectAtom)
  const projectPath = selectedProject?.path
  const onOpenFile = useFileOpen()
  const onFork = useContext(ForkContext)
  const isDev = import.meta.env.DEV
  // Normalize ACP/codex tool parts into canonical types (e.g. "tool-Read README.md" → "tool-Read").
  // Note: no useMemo — AI SDK mutates parts in-place, so the array reference
  // doesn't change and useMemo would return stale results.
  const messageParts = normalizeAcpParts(
    (message?.parts || []).map((part: unknown) => normalizeCodexToolPart(part)),
  )

  const contentParts = useMemo(
    () => messageParts.filter((p: NormalizedPart) => p.type !== "step-start"),
    [messageParts],
  )

  const shouldShowPlanning =
    sandboxSetupStatus === "ready" && isStreaming && isLastMessage && contentParts.length === 0

  const {
    nestedToolsMap,
    nestedToolIds,
    orphanTaskGroups,
    orphanToolCallIds,
    orphanFirstToolCallIds,
  } = useMemo(() => buildNestingIndex(messageParts), [messageParts])

  // Collect all plan operations (Write/Edit) for unified handling
  const planOpsSummary = useMemo(() => {
    const operations: Array<{ type: "write" | "edit"; part: NormalizedPart; index: number }> = []

    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i]
      const filePath = (part.input as { file_path?: string } | undefined)?.file_path || ""

      if ((part.type === "tool-Write" || part.type === "tool-Edit") && isPlanFile(filePath)) {
        operations.push({
          type: part.type === "tool-Write" ? "write" : "edit",
          part,
          index: i,
        })
      }
    }

    if (operations.length === 0) {
      return {
        operations: [],
        hasAnyPlanOperation: false,
        isStreaming: false,
        lastOperationType: null as "write" | "edit" | null,
      }
    }

    const isStreaming = operations.some(
      (op) => op.part.state === "input-streaming" || op.part.state === "pending",
    )

    const lastOp = operations[operations.length - 1]

    return {
      operations,
      hasAnyPlanOperation: true,
      isStreaming,
      lastOperationType: lastOp.type,
    }
  }, [messageParts])

  // Collapsing logic: collapse only if final text exists after tools
  const { shouldCollapse, visibleStepsCount, collapseBeforeIndex } = useMemo(() => {
    let lastToolIndex = -1
    let lastTextIndex = -1

    for (let i = 0; i < messageParts.length; i++) {
      const part = messageParts[i]
      // Ignore ExitPlanMode - it's not a real tool for the user
      if (part.type?.startsWith("tool-") && part.type !== "tool-ExitPlanMode") {
        lastToolIndex = i
      }
      if (part.type === "text" && part.text?.trim()) {
        lastTextIndex = i
      }
    }

    const hasToolsAndFinalText = lastToolIndex !== -1 && lastTextIndex > lastToolIndex
    const finalTextIndex = hasToolsAndFinalText ? lastTextIndex : -1
    const hasFinalText = finalTextIndex !== -1 && (!isStreaming || !isLastMessage)

    // Collapse only when there's final text after tools
    const shouldCollapse = hasFinalText
    const collapseBeforeIndex = hasFinalText ? finalTextIndex : -1

    // Calculate visible steps count for collapsible header
    const stepParts =
      shouldCollapse && collapseBeforeIndex !== -1 ? messageParts.slice(0, collapseBeforeIndex) : []
    const visibleStepsCount = stepParts.filter((p) => {
      if (p.type === "step-start") return false
      if (p.type === "tool-ExitPlanMode") return false
      if (p.toolCallId && nestedToolIds.has(p.toolCallId)) return false
      if (
        p.toolCallId &&
        orphanToolCallIds.has(p.toolCallId) &&
        !orphanFirstToolCallIds.has(p.toolCallId)
      )
        return false
      if (p.type === "text" && !p.text?.trim()) return false
      return true
    }).length

    return { shouldCollapse, visibleStepsCount, collapseBeforeIndex }
  }, [
    messageParts,
    isStreaming,
    isLastMessage,
    nestedToolIds,
    orphanToolCallIds,
    orphanFirstToolCallIds,
  ])

  // Check if any plan operation is in collapsed steps (before collapseBeforeIndex)
  const hasPlanInCollapsedSteps = useMemo(() => {
    if (!shouldCollapse || collapseBeforeIndex === -1) return false
    return planOpsSummary.operations.some((op) => op.index < collapseBeforeIndex)
  }, [shouldCollapse, collapseBeforeIndex, planOpsSummary.operations])

  // Get the last plan operation from collapsed steps for showing card
  const lastCollapsedPlanOp = useMemo(() => {
    if (!hasPlanInCollapsedSteps) return null
    const collapsedOps = planOpsSummary.operations.filter((op) => op.index < collapseBeforeIndex)
    return collapsedOps[collapsedOps.length - 1] || null
  }, [hasPlanInCollapsedSteps, planOpsSummary.operations, collapseBeforeIndex])

  const stepParts = useMemo(() => {
    if (!shouldCollapse || collapseBeforeIndex === -1) return []
    return messageParts.slice(0, collapseBeforeIndex)
  }, [messageParts, shouldCollapse, collapseBeforeIndex])

  const finalParts = useMemo(() => {
    if (!shouldCollapse || collapseBeforeIndex === -1) return messageParts
    return messageParts.slice(collapseBeforeIndex)
  }, [messageParts, shouldCollapse, collapseBeforeIndex])

  const hasTextContent = useMemo(
    () => messageParts.some((p: NormalizedPart) => p.type === "text" && p.text?.trim()),
    [messageParts],
  )

  // One pure string per render for every task row's memo — see
  // `nestingFingerprintOf`: comparing the map through arePartsEqual would
  // advance the shared tool-state cache, and the first row to walk it would
  // consume the change a later row needed to see.
  const nestingFingerprint = useMemo(() => nestingFingerprintOf(nestedToolsMap), [nestedToolsMap])

  const msgMetadata = message?.metadata as AgentMessageMetadata

  // One context object, so the dispatch and every renderer it calls can live at
  // module scope: this component says what this message's values are, and
  // renderMessagePart decides what each part looks like.
  const partContext = useMemo<PartRenderContext>(
    () => ({
      messageId: message.id,
      status,
      isStreaming,
      isLastMessage,
      subChatId,
      projectPath,
      onOpenFile,
      nestedToolsMap,
      nestedChildren: (toolCallId: string) => nestedToolsMap.get(toolCallId) ?? [],
      nestingFingerprint,
      nestedToolIds,
      orphans: {
        toolCallIds: orphanToolCallIds,
        firstToolCallIds: orphanFirstToolCallIds,
        taskGroups: orphanTaskGroups,
      },
      planOps: planOpsSummary,
      collapse: {
        shouldCollapse,
        collapseBeforeIndex,
        visibleStepsCount,
        lastCollapsedPlanOp,
      },
    }),
    [
      nestedToolsMap,
      nestingFingerprint,
      nestedToolIds,
      orphanToolCallIds,
      orphanFirstToolCallIds,
      orphanTaskGroups,
      collapseBeforeIndex,
      visibleStepsCount,
      status,
      isLastMessage,
      isStreaming,
      subChatId,
      message.id,
      planOpsSummary,
      shouldCollapse,
      lastCollapsedPlanOp,
      projectPath,
      onOpenFile,
    ],
  )

  const renderPart = useCallback(
    (part: NormalizedPart, idx: number, isFinal = false) =>
      renderMessagePart(part, idx, isFinal, partContext),
    [partContext],
  )

  // Detect when the assistant's final text part is a question awaiting user input.
  // Only treat as "question" once streaming has finished — partial text may not yet
  // include the trailing question mark.
  const isQuestion = useMemo(() => {
    if (isStreaming && isLastMessage) return false
    return isAssistantMessageQuestion(messageParts)
  }, [messageParts, isStreaming, isLastMessage])

  // Play a distinct chime exactly once when the latest assistant message
  // finishes streaming and ends with a question.
  const wasStreamingRef = useRef(isStreaming && isLastMessage)
  useEffect(() => {
    const wasStreaming = wasStreamingRef.current
    const isStreamingNow = isStreaming && isLastMessage
    wasStreamingRef.current = isStreamingNow

    if (wasStreaming && !isStreamingNow && isLastMessage && isQuestion) {
      if (questionSoundPlayedFor.has(message.id)) return
      questionSoundPlayedFor.add(message.id)
      const isSoundEnabled = appStore.get(soundNotificationsEnabledAtom)
      if (isSoundEnabled) {
        playQuestionSound()
      }
    }
  }, [isStreaming, isLastMessage, isQuestion, message.id])

  if (!message) return null

  return (
    <div
      data-assistant-message-id={message.id}
      data-question={isQuestion ? "true" : undefined}
      className={cn(
        "group/message w-full mb-4",
        isQuestion && "rounded-md border-l-2 border-orange-400 bg-orange-500/5 py-2 pr-2",
      )}
    >
      {isQuestion && (
        <div className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-orange-500">
          <QuestionIcon className="w-3.5 h-3.5 text-orange-500" />
          <span>Awaiting your answer</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {shouldCollapse && visibleStepsCount > 0 && (
          <CollapsibleSteps stepsCount={visibleStepsCount}>
            {(() => {
              // Apply both grouping functions: first task tools, then exploring tools
              const taskGrouped = groupTaskTools(stepParts, nestedToolIds)
              const grouped = groupExploringTools(taskGrouped, nestedToolIds)
              return keyItems(grouped, partKeyOf).map(({ key, item: part, index, isLast }) => {
                if (part.type === "exploring-group" && "parts" in part) {
                  const isGroupStreaming = isStreaming && isLastMessage && isLast
                  return (
                    <AgentExploringGroup
                      key={key}
                      parts={part.parts}
                      chatStatus={status}
                      isStreaming={isGroupStreaming}
                    />
                  )
                }
                if (part.type === "task-group" && "parts" in part) {
                  const isGroupStreaming = isStreaming && isLastMessage && isLast
                  return (
                    <AgentTaskToolsGroup
                      key={key}
                      parts={part.parts as unknown as TaskToolPart[]}
                      chatStatus={status}
                      isStreaming={isGroupStreaming}
                      subChatId={subChatId}
                    />
                  )
                }
                return renderPart(part, index, false)
              })
            })()}
          </CollapsibleSteps>
        )}

        {(() => {
          // Apply both grouping functions: first task tools, then exploring tools
          const taskGrouped = groupTaskTools(finalParts, nestedToolIds)
          const grouped = groupExploringTools(taskGrouped, nestedToolIds)
          return keyItems(grouped, partKeyOf).map(({ key, item: part, index, isLast }) => {
            if (part.type === "exploring-group" && "parts" in part) {
              const isGroupStreaming = isStreaming && isLastMessage && isLast
              return (
                <AgentExploringGroup
                  key={key}
                  parts={part.parts}
                  chatStatus={status}
                  isStreaming={isGroupStreaming}
                />
              )
            }
            if (part.type === "task-group" && "parts" in part) {
              const isGroupStreaming = isStreaming && isLastMessage && isLast
              return (
                <AgentTaskToolsGroup
                  key={key}
                  parts={part.parts as unknown as TaskToolPart[]}
                  chatStatus={status}
                  isStreaming={isGroupStreaming}
                  subChatId={subChatId}
                />
              )
            }
            return renderPart(
              part,
              shouldCollapse ? collapseBeforeIndex + index : index,
              shouldCollapse,
            )
          })
        })()}

        {/* Show plan card after finalParts if any plan operation was in collapsed steps */}
        {shouldCollapse && lastCollapsedPlanOp && (
          <AgentPlanFileTool
            part={lastCollapsedPlanOp.part as AgentPlanFileToolProps["part"]}
            chatStatus={status}
            subChatId={subChatId}
            isEdit={lastCollapsedPlanOp.type === "edit"}
          />
        )}

        {shouldShowPlanning && (
          <AgentToolCall
            icon={AgentToolRegistry["tool-planning"].icon}
            title={AgentToolRegistry["tool-planning"].title({})}
            isPending={true}
            isError={false}
          />
        )}
      </div>

      {hasTextContent && (!isStreaming || !isLastMessage) && (
        <div className="flex justify-between items-center h-6 px-2 mt-1">
          <div className="flex items-center gap-0.5">
            <CopyButton text={getMessageTextContent(message)} isMobile={isMobile} />
            <PlayButton text={getMessageTextContent(message)} isMobile={isMobile} />
          </div>
          <div className="flex items-center gap-0.5">
            <AgentMessageUsage
              metadata={msgMetadata}
              isStreaming={isStreaming}
              isMobile={isMobile}
            />
            {onFork && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="p-1 rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
                  >
                    <MoreHorizontal className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[160px]">
                  <DropdownMenuItem onClick={() => onFork(message.id)}>
                    Fork from here
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      )}

      {/* Git activity badges - commit/PR pills */}
      {(!isStreaming || !isLastMessage) && (
        <GitActivityBadges parts={messageParts} chatId={chatId} subChatId={subChatId} />
      )}

      {isDev && showMessageJson && (
        <div className="px-2 mt-2">
          <MessageJsonDisplay message={message} label="Assistant" />
        </div>
      )}
    </div>
  )
}, areMessagePropsEqual)
