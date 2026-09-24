/**
 * The ownership rules a prompt suggestion passes through on its way from a
 * provider stream into the composer, and the four ways it is refused.
 */
import { describe, expect, it } from "vitest"
import {
  mayStoreSuggestion,
  type PromptSuggestionEntry,
  suggestionIsCurrent,
} from "./suggestion-ownership"

describe("mayStoreSuggestion", () => {
  it("stores a live turn with the preference on", () => {
    expect(mayStoreSuggestion({ preferenceOn: true, capturedTurn: 3, currentTurn: 3 })).toBe(true)
  })

  it("refuses when the app's switch is off, whatever the stream emitted", () => {
    // An inherited CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION can make the CLI send
    // this; the preference still decides whether the composer ever sees it.
    expect(mayStoreSuggestion({ preferenceOn: false, capturedTurn: 3, currentTurn: 3 })).toBe(false)
  })

  it("refuses a late arrival from a superseded turn", () => {
    expect(mayStoreSuggestion({ preferenceOn: true, capturedTurn: 3, currentTurn: 4 })).toBe(false)
  })
})

describe("suggestionIsCurrent", () => {
  const entry: PromptSuggestionEntry = {
    text: "Now run the gate",
    turn: 7,
    engine: "legacy",
  }

  it("keeps a suggestion while its engine and turn are still the composer's", () => {
    expect(suggestionIsCurrent(entry, { engineNow: "legacy", turnNow: 7 })).toBe(true)
  })

  it("hides a suggestion after the sub-chat switched engines", () => {
    expect(suggestionIsCurrent(entry, { engineNow: "native", turnNow: 7 })).toBe(false)
  })

  it("hides a suggestion once another turn has started", () => {
    expect(suggestionIsCurrent(entry, { engineNow: "legacy", turnNow: 8 })).toBe(false)
  })

  it("treats an empty atom as nothing to show", () => {
    expect(suggestionIsCurrent(null, { engineNow: "legacy", turnNow: 7 })).toBe(false)
  })
})
