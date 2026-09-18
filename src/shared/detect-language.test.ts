import { describe, expect, it } from "vitest"
import { detectLanguage } from "./detect-language"

describe("detectLanguage", () => {
  it("maps TypeScript extensions", () => {
    expect(detectLanguage("foo.ts")).toBe("typescript")
    expect(detectLanguage("foo.tsx")).toBe("typescript")
  })

  it("maps JavaScript extensions", () => {
    expect(detectLanguage("foo.js")).toBe("javascript")
    expect(detectLanguage("foo.jsx")).toBe("javascript")
  })

  it("maps shell extensions", () => {
    expect(detectLanguage("foo.sh")).toBe("shell")
    expect(detectLanguage("foo.bash")).toBe("shell")
    expect(detectLanguage("foo.zsh")).toBe("shell")
  })

  it("maps config extensions", () => {
    expect(detectLanguage("foo.json")).toBe("json")
    expect(detectLanguage("foo.yaml")).toBe("yaml")
    expect(detectLanguage("foo.yml")).toBe("yaml")
    expect(detectLanguage("foo.toml")).toBe("toml")
    expect(detectLanguage("foo.xml")).toBe("xml")
  })

  it("maps .h to C (header)", () => {
    expect(detectLanguage("foo.h")).toBe("c")
  })

  it("is case-insensitive on the extension", () => {
    expect(detectLanguage("FOO.TS")).toBe("typescript")
    expect(detectLanguage("foo.TS")).toBe("typescript")
  })

  it("returns plaintext for unknown extensions", () => {
    expect(detectLanguage("foo.xyz")).toBe("plaintext")
  })

  it("returns plaintext for files with no extension", () => {
    expect(detectLanguage("Makefile")).toBe("plaintext")
  })
})
