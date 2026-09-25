/**
 * Which prompt suggestions may be stored, and which stored ones may still be
 * shown. Session equality alone answered neither: a session id is reused
 * across turns, outlives an engine switch, and says nothing about whether the
 * app's own switch is on. The rules live here so the transport that stores,
 * the transport that clears, and the composer that renders all ask the same
 * three questions — of the turn generation, the engine, and the preference —
 * instead of each inventing its own.
 */
import type { SubChatEngine } from "../atoms"

/** What the composer is allowed to offer, and the provenance that gates it. */
export type PromptSuggestionEntry = {
  text: string
  /** The turn generation that produced it; every send bumps the family. */
  turn: number
  /** The engine whose stream carried it: the legacy SDK, or the native runtime. */
  engine: SubChatEngine
}

/**
 * Whether a suggestion that just arrived may be written to the sub-chat's
 * atom. The switch is authoritative — an inherited environment variable can
 * make the CLI emit suggestions while the app's preference is off, and a
 * consumed chunk with nowhere to go is the store's job to refuse — and a
 * captured turn that is no longer the current one is a late arrival from a
 * stream this app has already superseded.
 */
export function mayStoreSuggestion(args: {
  preferenceOn: boolean
  capturedTurn: number
  currentTurn: number
}): boolean {
  return args.preferenceOn && args.capturedTurn === args.currentTurn
}

/**
 * Whether a stored suggestion still describes the composer it would insert
 * into: the preference is still on (turning Prompt Suggestions off withdraws
 * whatever is already stored — and turning it back on must not resurrect it),
 * same engine (a switch mid-flight changed who the next prompt would be
 * addressed to), and same turn (something newer has started since).
 */
export function suggestionIsCurrent(
  entry: PromptSuggestionEntry | null,
  args: { engineNow: SubChatEngine; turnNow: number; preferenceOn: boolean },
): entry is PromptSuggestionEntry {
  return (
    entry !== null &&
    args.preferenceOn &&
    entry.engine === args.engineNow &&
    entry.turn === args.turnNow
  )
}
