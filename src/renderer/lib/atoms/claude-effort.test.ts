// @vitest-environment jsdom
/**
 * Claude effort is owned by the sub-chat that chose it: one split pane
 * setting `max` must not change what the other pane sends. The pre-existing
 * global value survives as `lastSelected`, which is what a chat that has
 * never picked reads and what the new-chat form (no sub-chat id yet) reads
 * and writes.
 */
import { createStore } from "jotai"
import { afterEach, describe, expect, it, vi } from "vitest"
import { lastSelectedClaudeEffortAtom, subChatClaudeEffortAtomFamily } from "."

afterEach(() => {
  localStorage.clear()
})

describe("sub-chat Claude effort", () => {
  it("keeps two sub-chats' picks independent", () => {
    const store = createStore()
    store.set(subChatClaudeEffortAtomFamily("chat-a"), "max")
    store.set(subChatClaudeEffortAtomFamily("chat-b"), "low")

    expect(store.get(subChatClaudeEffortAtomFamily("chat-a"))).toBe("max")
    expect(store.get(subChatClaudeEffortAtomFamily("chat-b"))).toBe("low")
    // The global a third chat falls back on has not moved.
    expect(store.get(lastSelectedClaudeEffortAtom)).toBe(null)
  })

  it("falls back to the last-selected pick for a chat that has never chosen", () => {
    const store = createStore()
    store.set(lastSelectedClaudeEffortAtom, "high")
    expect(store.get(subChatClaudeEffortAtomFamily("chat-untouched"))).toBe("high")
  })

  it("treats a chat's explicit null as its own answer, not a miss", () => {
    const store = createStore()
    store.set(lastSelectedClaudeEffortAtom, "high")
    store.set(subChatClaudeEffortAtomFamily("chat-a"), null)
    // `high` is what a fresh chat gets; chat-a asked for the CLI default and
    // must keep reading null rather than someone else's level.
    expect(store.get(subChatClaudeEffortAtomFamily("chat-a"))).toBe(null)
    expect(store.get(subChatClaudeEffortAtomFamily("chat-b"))).toBe("high")
  })

  it("reads and writes the last-selected pick when there is no chat yet", () => {
    const store = createStore()
    store.set(subChatClaudeEffortAtomFamily(""), "xhigh")
    expect(store.get(lastSelectedClaudeEffortAtom)).toBe("xhigh")
    // ...and a chat created afterwards inherits it.
    store.set(
      subChatClaudeEffortAtomFamily("chat-new"),
      store.get(subChatClaudeEffortAtomFamily("")),
    )
    expect(store.get(subChatClaudeEffortAtomFamily("chat-new"))).toBe("xhigh")
  })

  it("carries the pre-existing global storage key over as the last-selected pick", async () => {
    // `getOnInit` reads storage when the atom module loads, so the seed has
    // to be in place before the atoms are imported — which is exactly the
    // production shape: an upgraded app starts with last version's value
    // already on disk. Resetting the module registry replays that start.
    vi.resetModules()
    localStorage.setItem("preferences:claude-effort", JSON.stringify("low"))
    const { lastSelectedClaudeEffortAtom: lastSelected, subChatClaudeEffortAtomFamily: family } =
      await import(".")
    const store = createStore()
    expect(store.get(lastSelected)).toBe("low")
    expect(store.get(family("chat-untouched"))).toBe("low")
  })
})
