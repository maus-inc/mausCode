"use client"

/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
export interface ToolLifecycleState {
  isInputStreaming: boolean
  isTerminal: boolean
  isError: boolean
  hasOutput: boolean
  hasResult: boolean
  isPendingState: boolean
}

export interface ToolStatus extends ToolLifecycleState {
  isPending: boolean
  isInterrupted: boolean
  isSuccess: boolean
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null
}

/** Minimal structural view of a tool part (SDK or app-custom). */
export type ToolPartLike = {
  state?: unknown
  type?: string
  toolCallId?: string
  input?: unknown
  output?: unknown
  result?: unknown
}

/**
 * The state strings that say the SDK has finished with this part — the state
 * string alone, deliberately not `getToolLifecycleState().isTerminal`, which
 * also counts a present `output`: a part whose output arrived before its
 * state string caught up is still live, and the settled-part serializers
 * below must keep serializing it every time.
 */
const TERMINAL_STATE_STRINGS = new Set(["output-available", "output-error", "result", "error"])

export function isTerminalStateString(state: unknown): boolean {
  return typeof state === "string" && TERMINAL_STATE_STRINGS.has(state)
}

export function getToolLifecycleState(part: ToolPartLike): ToolLifecycleState {
  const state = typeof part?.state === "string" ? part.state : undefined
  const hasOutput = hasValue(part?.output)
  const hasResult = hasValue(part?.result)
  const isInputStreaming = state === "input-streaming"
  const isTerminalState = isTerminalStateString(state)
  const isError =
    state === "output-error" ||
    state === "error" ||
    (hasOutput && (part?.output as { success?: unknown } | undefined)?.success === false) ||
    (hasResult && (part?.result as { success?: unknown } | undefined)?.success === false)
  const isTerminal = isTerminalState || hasOutput || hasResult

  return {
    isInputStreaming,
    isTerminal,
    isError,
    hasOutput,
    hasResult,
    isPendingState: !isInputStreaming && !isTerminal,
  }
}

export function getToolStatus(part: ToolPartLike, chatStatus?: string): ToolStatus {
  const lifecycle = getToolLifecycleState(part)
  const isActivelyStreaming = chatStatus === "streaming" || chatStatus === "submitted"
  const isInFlight = lifecycle.isInputStreaming || lifecycle.isPendingState

  return {
    ...lifecycle,
    isPending: isInFlight && isActivelyStreaming,
    isInterrupted: isInFlight && !isActivelyStreaming && chatStatus !== undefined,
    isSuccess: lifecycle.isTerminal && !lifecycle.isError,
  }
}
