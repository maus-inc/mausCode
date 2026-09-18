import { describe, expect, it } from "vitest"
import { detectLanguage } from "./detect-language"

describe("detectLanguage", () => {
  it.each([
    ["file.ts", "typescript"],
    ["file.tsx", "typescript"],
    ["file.js", "javascript"],
    ["file.jsx", "javascript"],
    ["file.json", "json"],
    ["file.md", "markdown"],
    ["file.mdx", "markdown"],
    ["file.css", "css"],
    ["file.scss", "scss"],
    ["file.html", "html"],
    ["file.py", "python"],
    ["file.rb", "ruby"],
    ["file.go", "go"],
    ["file.rs", "rust"],
    ["file.java", "java"],
    ["file.kt", "kotlin"],
    ["file.swift", "swift"],
    ["file.c", "c"],
    ["file.cpp", "cpp"],
    ["file.h", "c"],
    ["file.hpp", "cpp"],
    ["file.cs", "csharp"],
    ["file.php", "php"],
    ["file.sql", "sql"],
    ["file.sh", "shell"],
    ["file.bash", "shell"],
    ["file.zsh", "shell"],
    ["file.yaml", "yaml"],
    ["file.yml", "yaml"],
    ["file.toml", "toml"],
    ["file.xml", "xml"],
    ["file.graphql", "graphql"],
    ["file.gql", "graphql"],
    ["file.Dockerfile", "dockerfile"],
    [".gitignore", "plaintext"],
    [".env", "plaintext"],
  ])("detects %s as %s", (input, expected) => {
    expect(detectLanguage(input)).toBe(expected)
  })

  it("returns plaintext for unknown extensions", () => {
    expect(detectLanguage("file.xyz")).toBe("plaintext")
  })

  it("returns plaintext for files with no extension", () => {
    expect(detectLanguage("Makefile")).toBe("plaintext")
  })

  it("is case-insensitive", () => {
    expect(detectLanguage("FILE.TS")).toBe("typescript")
    expect(detectLanguage("FILE.PY")).toBe("python")
  })

  it("handles full paths", () => {
    expect(detectLanguage("/home/user/project/src/index.ts")).toBe("typescript")
    expect(detectLanguage("/home/user/project/Makefile")).toBe("plaintext")
  })
})
