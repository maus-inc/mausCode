import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"

// The renderer reads `document` when react-dom loads, so the DOM has to exist
// first. Everything below is imported dynamically for that reason.
const dom = new JSDOM("<!DOCTYPE html><body><div id='root'></div></body>", {
  // A real origin, otherwise jsdom leaves localStorage and sessionStorage
  // unavailable and anything that touches them throws.
  url: "http://localhost/",
  pretendToBeVisual: true,
})

const g = globalThis as Record<string, unknown>
g.window = dom.window
g.document = dom.window.document
Object.defineProperty(g, "navigator", {
  value: dom.window.navigator,
  configurable: true,
})
for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (key === "navigator" || key === "window" || key === "document") continue
  if (key in g) continue
  try {
    Object.defineProperty(g, key, {
      value: (dom.window as unknown as Record<string, unknown>)[key],
      configurable: true,
      writable: true,
    })
  } catch {
    // Read-only window properties that this test does not need.
  }
}

const SAMPLES: Record<string, string> = {
  typescript: 'const x: string = "hi"\nlet y = 2\nexport default y\n',
  json: '{\n  "a": 1,\n  "b": [true, null]\n}',
  "html in source": 'const tag = "<img src=x onerror=alert(1)>"\nconst b = "<b>bold</b>"',
  "blank lines": "first\n\n\nlast",
  "trailing newline": "only line\n",
  "empty string": "",
  "unicode and entities": 'const s = "a & b < c > d"\nconst t = "naïve, 日本語, ok"\n',
}

/** Flattens the token stream back into plain text, the way the renderer lays it out. */
function tokensToText(
  lines: { content: string; color?: string }[][],
): string {
  return lines.map((line) => line.map((t) => t.content).join("")).join("\n")
}

for (const [name, code] of Object.entries(SAMPLES)) {
  test(`highlighting ${name} round-trips the source exactly`, async () => {
    const { highlightCodeTokens } = await import(
      "./themes/shiki-theme-loader"
    )
    const lines = await highlightCodeTokens(code, "typescript", "github-dark")
    assert.equal(tokensToText(lines), code)
  })
}

test("source containing markup renders as text, not as elements", async () => {
  const React = await import("react")
  const { createRoot } = await import("react-dom/client")
  const { act } = await import("react")
  const { HighlightedTokens } = await import("../components/highlighted-code")
  const { highlightCodeTokens } = await import("./themes/shiki-theme-loader")

  const code = 'const tag = "<img src=x onerror=alert(1)>"'
  const lines = await highlightCodeTokens(code, "typescript", "github-dark")

  const host = dom.window.document.getElementById("root")!
  const root = createRoot(host as never)
  await act(async () => {
    root.render(
      React.createElement("pre", null, React.createElement(HighlightedTokens, { lines })),
    )
  })

  assert.equal(host.textContent, code)
  assert.equal(host.querySelectorAll("img").length, 0, "no img element was created")
  assert.equal(host.querySelectorAll("script").length, 0)
  assert.equal(
    host.querySelectorAll("[onerror]").length,
    0,
    "no event handler attribute was created",
  )

  await act(async () => root.unmount())
})
