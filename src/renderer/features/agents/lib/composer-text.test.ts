/**
 * The click that used to replace whatever the composer held with the
 * suggestion, destroying any unsent draft.
 */
import { describe, expect, it } from "vitest"
import { mergeDraftWithSuggestion } from "./composer-text"

describe("mergeDraftWithSuggestion", () => {
  it("puts the suggestion in an empty draft", () => {
    expect(mergeDraftWithSuggestion("", "Now run the gate")).toBe("Now run the gate")
  })

  it("treats a whitespace-only draft as empty", () => {
    expect(mergeDraftWithSuggestion("  \n ", "Now run the gate")).toBe("Now run the gate")
  })

  it("keeps every character of a typed draft and appends after one space", () => {
    expect(mergeDraftWithSuggestion("Wait — did the lockfile move?", "Now run the gate")).toBe(
      "Wait — did the lockfile move? Now run the gate",
    )
  })

  it("keeps leading whitespace the draft already had", () => {
    expect(mergeDraftWithSuggestion("  already indented", "next")).toBe("  already indented next")
  })

  it("adds no space the draft does not need", () => {
    expect(mergeDraftWithSuggestion("finish this line ", "next")).toBe("finish this line next")
    expect(mergeDraftWithSuggestion("end\n", "next")).toBe("end\nnext")
  })
})
