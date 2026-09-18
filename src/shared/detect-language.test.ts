import { describe, expect, it } from "vitest"
import { detectLanguage } from "./detect-language"

describe("detectLanguage", () => {
  it("maps known extensions to language names", () => {
    expect(detectLanguage("file.ts")).toBe("typescript")
    expect(detectLanguage("file.tsx")).toBe("typescript")
    expect(detectLanguage("file.js")).toBe("javascript")
    expect(detectLanguage("file.py")).toBe("python")
    expect(detectLanguage("file.rs")).toBe("rust")
    expect(detectLanguage("file.go")).toBe("go")
    expect(detectLanguage("file.json")).toBe("json")
    expect(detectLanguage("file.md")).toBe("markdown")
    expect(detectLanguage("file.css")).toBe("css")
  })

  it("returns plaintext for unknown extensions", () => {
    expect(detectLanguage("file.unknown")).toBe("plaintext")
    expect(detectLanguage("file")).toBe("plaintext")
    expect(detectLanguage("no-extension")).toBe("plaintext")
  })

  it("is case-insensitive", () => {
    expect(detectLanguage("file.TS")).toBe("typescript")
    expect(detectLanguage("file.PY")).toBe("python")
  })

  it("handles paths with directories", () => {
    expect(detectLanguage("/src/components/Button.tsx")).toBe("typescript")
    expect(detectLanguage("src/utils/helpers.ts")).toBe("typescript")
  })
})
