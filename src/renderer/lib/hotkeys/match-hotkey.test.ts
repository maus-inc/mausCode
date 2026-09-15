import { describe, expect, it } from "vitest"
import { matchesHotkey, matchesShortcutAction } from "./match-hotkey"
import type { CustomHotkeysConfig } from "./types"

const DEFAULT_CONFIG: CustomHotkeysConfig = { version: 1, bindings: {} }

function keyEvent(parts: {
  key: string
  code?: string
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent {
  return {
    key: parts.key,
    code: parts.code ?? "",
    metaKey: parts.metaKey ?? false,
    ctrlKey: parts.ctrlKey ?? false,
    altKey: parts.altKey ?? false,
    shiftKey: parts.shiftKey ?? false,
  } as KeyboardEvent
}

describe("matchesHotkey", () => {
  it("matches the esc alias against the Escape event key", () => {
    expect(matchesHotkey(keyEvent({ key: "Escape" }), "esc")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "Escape" }), "escape")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "Enter" }), "esc")).toBe(false)
  })

  it("matches brackets by event code for non-US layouts", () => {
    expect(matchesHotkey(keyEvent({ key: "[", code: "BracketLeft", metaKey: true }), "cmd+[")).toBe(
      true,
    )
    expect(
      matchesHotkey(keyEvent({ key: "å", code: "BracketRight", metaKey: true }), "cmd+]"),
    ).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "[", code: "BracketLeft" }), "cmd+[")).toBe(false)
  })

  it("matches space by event key and code", () => {
    expect(matchesHotkey(keyEvent({ key: " ", code: "Space" }), "space")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: " ", code: "Space", metaKey: true }), "cmd+space")).toBe(
      true,
    )
    expect(matchesHotkey(keyEvent({ key: "x" }), "space")).toBe(false)
  })

  it("matches arrow keys recorded as symbols", () => {
    expect(matchesHotkey(keyEvent({ key: "ArrowUp", code: "ArrowUp" }), "↑")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "ArrowDown", code: "ArrowDown" }), "↓")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "ArrowLeft", code: "ArrowLeft" }), "←")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "ArrowRight", code: "ArrowRight" }), "→")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "ArrowUp", code: "ArrowUp" }), "↓")).toBe(false)
  })

  it("requires shift for ? and honours explicit modifiers", () => {
    expect(matchesHotkey(keyEvent({ key: "?", shiftKey: true }), "?")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "?" }), "?")).toBe(false)
    expect(matchesHotkey(keyEvent({ key: "j", code: "KeyJ", metaKey: true }), "cmd+j")).toBe(true)
    expect(matchesHotkey(keyEvent({ key: "j", code: "KeyJ", ctrlKey: true }), "cmd+j")).toBe(false)
  })
})

describe("matchesShortcutAction", () => {
  it("matches the default binding and rejects modifier contamination", () => {
    expect(
      matchesShortcutAction(keyEvent({ key: "Escape" }), "stop-generation", DEFAULT_CONFIG),
    ).toBe(true)
    expect(
      matchesShortcutAction(
        keyEvent({ key: "Escape", metaKey: true }),
        "stop-generation",
        DEFAULT_CONFIG,
      ),
    ).toBe(false)
  })

  it("matches altKeys while the primary binding is uncustomized", () => {
    expect(
      matchesShortcutAction(
        keyEvent({ key: "Escape", ctrlKey: true }),
        "toggle-focus",
        DEFAULT_CONFIG,
      ),
    ).toBe(true)
  })

  it("retires altKeys once a custom binding exists and honours that binding", () => {
    const config: CustomHotkeysConfig = {
      version: 1,
      bindings: { "toggle-focus": "cmd+alt+f" },
    }
    expect(
      matchesShortcutAction(keyEvent({ key: "Escape", ctrlKey: true }), "toggle-focus", config),
    ).toBe(false)
    expect(
      matchesShortcutAction(
        keyEvent({ key: "f", code: "KeyF", metaKey: true, altKey: true }),
        "toggle-focus",
        config,
      ),
    ).toBe(true)
  })
})
