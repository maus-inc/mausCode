/**
 * Utility functions for agent tool components
 *
 * CRITICAL: AI SDK mutates objects in-place during streaming!
 * This means prev.output === next.output (same reference) even when
 * the values inside have changed. We MUST cache state externally
 * and compare cached values, not object references.
 */

import { getToolLifecycleState, type ToolPartLike } from "./agent-tool-state"

// ============================================================================
// TOOL STATE CACHE
// ============================================================================
// Cache tool state by toolCallId to detect AI SDK in-place mutations.
// This is the same pattern used for MemoizedTextPart.
// ============================================================================

interface CachedToolState {
  state: string | undefined
  inputJson: string // JSON stringified input for deep comparison
  outputJson: string // JSON stringified output for deep comparison
}

const toolStateCache = new Map<string, CachedToolState>()

export function clearToolStateCachesByToolCallIds(toolCallIds: string[]) {
  for (const toolCallId of toolCallIds) {
    toolStateCache.delete(toolCallId)
    askUserStateCache.delete(toolCallId)
  }
}

function getToolStateSnapshot(part: ToolPartLike): CachedToolState {
  return {
    state: typeof part.state === "string" ? part.state : undefined,
    inputJson: JSON.stringify(part.input || {}),
    outputJson: JSON.stringify(part.output || {}),
  }
}

function hasToolStateChanged(toolCallId: string, part: ToolPartLike): boolean {
  const cached = toolStateCache.get(toolCallId)
  const current = getToolStateSnapshot(part)

  if (!cached) {
    toolStateCache.set(toolCallId, current)
    return true
  }

  const changed =
    cached.state !== current.state ||
    cached.inputJson !== current.inputJson ||
    cached.outputJson !== current.outputJson

  if (changed) {
    toolStateCache.set(toolCallId, current)
  }

  return changed
}

/**
 * Compare two part objects by their significant fields.
 * Returns true if they are equal.
 *
 * IMPORTANT: Uses external cache to detect AI SDK in-place mutations.
 */
function arePartsEqual(prev: ToolPartLike, next: ToolPartLike): boolean {
  // Different toolCallId = different tool
  if (prev.toolCallId !== next.toolCallId) return false
  if (prev.type !== next.type) return false

  // Use cache-based comparison for the next part
  // We check if the NEXT part has changed from what we cached
  const toolCallId = next.toolCallId
  if (!toolCallId) {
    // No toolCallId - fall back to simple comparison
    return prev.state === next.state
  }

  // Check if tool state has changed using our external cache
  // hasToolStateChanged updates the cache if changed
  const changed = hasToolStateChanged(toolCallId, next)

  // Return true (equal) if nothing changed
  return !changed
}

/**
 * Check if a tool is completed (has output or error state).
 * Completed tools don't need to react to chatStatus changes.
 */
function isToolCompleted(part: ToolPartLike): boolean {
  return getToolLifecycleState(part).isTerminal
}

/**
 * Deep compare function for tool part props.
 * Used with React.memo() to prevent unnecessary re-renders when
 * parent component re-renders but the tool's actual data hasn't changed.
 *
 * This is critical for streaming performance - when ai-sdk updates messages,
 * it creates new object references for all parts, but most parts haven't
 * actually changed. This comparator checks the actual values.
 *
 * OPTIMIZATION: Completed tools don't re-render on chatStatus changes.
 */
export function areToolPropsEqual(
  prevProps: { part: ToolPartLike; chatStatus?: string },
  nextProps: { part: ToolPartLike; chatStatus?: string },
): boolean {
  // First check if the tool data itself changed
  const partsEqual = arePartsEqual(prevProps.part, nextProps.part)

  if (!partsEqual) return false

  // If tool is completed, it doesn't care about chatStatus changes
  if (isToolCompleted(nextProps.part)) {
    return true
  }

  // For pending tools, chatStatus matters (determines spinner vs completed)
  if (prevProps.chatStatus !== nextProps.chatStatus) return false

  return true
}

/**
 * Compare function for AgentTaskTool which has additional nestedTools prop.
 */
/**
 * A subagent's own children by its id, and the message-level map that stands
 * behind it. A grandchild is not in this task's own `nestedTools`, and only a
 * change under some other key says it moved. Identity of either is useless
 * here — `messageParts` is rebuilt every render (the AI SDK mutates parts in
 * place), so the map and any callback over it are fresh objects with
 * unchanged contents. What the memo compares is `nestingFingerprintOf`'s
 * snapshot of that map: one string, every row, no cache writes.
 */
export type NestedToolsLookup = (toolCallId: string) => ToolPartLike[]
export type NestedToolsMapLike = ReadonlyMap<string, readonly ToolPartLike[]>

/**
 * An immutable snapshot of the message-level nesting map, as one string.
 *
 * The map itself cannot be compared by content through `arePartsEqual`: that
 * comparator advances the module-level `toolStateCache`, so the first task row
 * to walk the map would consume every mutation and the rows after it would
 * see a clean cache and skip a grandchild that changed. Computed ONCE per
 * render in the message component and carried as a plain string, the compare
 * is pure — two rows asking "did anything under the tree move?" both get the
 * same answer, because neither of them writes anything.
 *
 * Reads the same fields the tool-state snapshot records (`state`, `input`,
 * `output`) plus the identity fields, deliberately without touching the cache.
 */
export function nestingFingerprintOf(map: NestedToolsMapLike | undefined): string {
  if (!map || map.size === 0) return ""
  const segments: string[] = []
  for (const [id, parts] of map) {
    for (const part of parts) {
      segments.push(
        [
          id,
          part.type,
          part.toolCallId ?? "",
          part.state ?? "",
          JSON.stringify(part.input ?? {}),
          JSON.stringify(part.output ?? {}),
        ].join("\u0000"),
      )
    }
  }
  return segments.join("\u0001")
}

/**
 * A result that launched work instead of finishing it. The pinned SDK types
 * `AgentOutput.status` as `completed` | `async_launched` | `remote_launched`:
 * the latter two mean the run was handed off — to the background, or to a
 * remote session — and is still going there, so a row that calls them a
 * completion reads as subagent work that ended when it has not.
 */
export function isLaunchedAgentOutput(output: unknown): boolean {
  const status = (output as { status?: unknown } | null | undefined)?.status
  return status === "async_launched" || status === "remote_launched"
}

export function areTaskToolPropsEqual(
  prevProps: {
    part: ToolPartLike
    nestedTools: ToolPartLike[]
    nestedChildren?: NestedToolsLookup
    nestingFingerprint?: string
    depth?: number
    chatStatus?: string
  },
  nextProps: {
    part: ToolPartLike
    nestedTools: ToolPartLike[]
    nestedChildren?: NestedToolsLookup
    nestingFingerprint?: string
    depth?: number
    chatStatus?: string
  },
): boolean {
  // Descendants beyond this task's own `nestedTools` are visible only through
  // the message-level map. Compare the render's fingerprint of it — a pure
  // string, so two rows can both see the same grandchild mutation without
  // either consuming the other's change out of the tool-state cache. Checked
  // first so the completed short circuit below cannot hide it.
  if ((prevProps.nestingFingerprint ?? "") !== (nextProps.nestingFingerprint ?? "")) return false
  // Fallback for callers that offer a lookup without a fingerprint.
  if (
    prevProps.nestingFingerprint === undefined &&
    nextProps.nestingFingerprint === undefined &&
    prevProps.nestedChildren !== nextProps.nestedChildren
  ) {
    return false
  }
  if (prevProps.depth !== nextProps.depth) return false

  // Compare main part first
  if (!arePartsEqual(prevProps.part, nextProps.part)) return false

  // Compare nestedTools array
  const prevNested = prevProps.nestedTools || []
  const nextNested = nextProps.nestedTools || []

  if (prevNested.length !== nextNested.length) return false

  // Compare each nested tool
  for (let i = 0; i < prevNested.length; i++) {
    if (!arePartsEqual(prevNested[i], nextNested[i])) return false
  }

  // If all tools are completed, don't care about chatStatus
  const mainCompleted = isToolCompleted(nextProps.part)
  const allNestedCompleted = nextNested.every(isToolCompleted)

  if (mainCompleted && allNestedCompleted) {
    return true
  }

  // For pending tools, chatStatus matters
  if (prevProps.chatStatus !== nextProps.chatStatus) return false

  return true
}

/**
 * Compare function for AgentExploringGroup which has parts array.
 */
export function areExploringGroupPropsEqual(
  prevProps: { parts: ToolPartLike[]; chatStatus?: string; isStreaming: boolean },
  nextProps: { parts: ToolPartLike[]; chatStatus?: string; isStreaming: boolean },
): boolean {
  const prevParts = prevProps.parts || []
  const nextParts = nextProps.parts || []

  if (prevParts.length !== nextParts.length) return false

  for (let i = 0; i < prevParts.length; i++) {
    if (!arePartsEqual(prevParts[i], nextParts[i])) return false
  }

  // isStreaming changes always matter - they drive auto-collapse via useEffect
  if (prevProps.isStreaming !== nextProps.isStreaming) return false

  // If all parts are completed, don't care about chatStatus
  const allCompleted = nextParts.every(isToolCompleted)
  if (allCompleted) {
    return true
  }

  // For pending groups, chatStatus matters
  if (prevProps.chatStatus !== nextProps.chatStatus) return false

  return true
}

/**
 * Check if a file path is a plan file.
 * Plan files are stored in the claude-sessions directory under /plans/
 */
export function isPlanFile(filePath: string): boolean {
  // Check for official plan location in claude-sessions
  if (filePath.includes("claude-sessions") && filePath.includes("/plans/")) {
    return true
  }
  // Also check for plan files by name pattern (for backwards compatibility)
  const fileName = filePath.split("/").pop()?.toLowerCase() || ""
  if (fileName.includes("plan") && fileName.endsWith(".md")) {
    return true
  }
  return false
}

/**
 * Compare function for AgentAskUserQuestionTool which has different props structure.
 * Uses cache-based comparison for AI SDK in-place mutations.
 */

interface CachedAskUserState {
  state: string
  isError: boolean | undefined
  errorText: string | undefined
  inputJson: string
  resultJson: string
}

const askUserStateCache = new Map<string, CachedAskUserState>()

export function areAskUserQuestionPropsEqual(
  prevProps: {
    input: unknown
    result?: unknown
    errorText?: string
    state: string
    isError?: boolean
    isStreaming?: boolean
    toolCallId?: string
  },
  nextProps: {
    input: unknown
    result?: unknown
    errorText?: string
    state: string
    isError?: boolean
    isStreaming?: boolean
    toolCallId?: string
  },
): boolean {
  // Different toolCallId = different tool
  if (prevProps.toolCallId !== nextProps.toolCallId) return false

  const toolCallId = nextProps.toolCallId
  if (!toolCallId) {
    // No toolCallId - fall back to simple comparison
    return prevProps.state === nextProps.state
  }

  // Create current state snapshot
  const current: CachedAskUserState = {
    state: nextProps.state,
    isError: nextProps.isError,
    errorText: nextProps.errorText,
    inputJson: JSON.stringify(nextProps.input || {}),
    resultJson: JSON.stringify(nextProps.result || {}),
  }

  const cached = askUserStateCache.get(toolCallId)

  if (!cached) {
    askUserStateCache.set(toolCallId, current)
    return false // First render
  }

  const changed =
    cached.state !== current.state ||
    cached.isError !== current.isError ||
    cached.errorText !== current.errorText ||
    cached.inputJson !== current.inputJson ||
    cached.resultJson !== current.resultJson

  if (changed) {
    askUserStateCache.set(toolCallId, current)
    return false
  }

  // If tool has result, it's completed - don't care about isStreaming
  if (nextProps.result !== undefined) {
    return true
  }

  // For pending state, isStreaming matters
  if (prevProps.isStreaming !== nextProps.isStreaming) return false

  return true
}
