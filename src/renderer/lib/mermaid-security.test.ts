import { test } from "node:test"
import assert from "node:assert/strict"
import { JSDOM } from "jsdom"
import { SVG_SANITIZE_CONFIG, getMermaidConfig } from "./mermaid-security"

// DOMPurify and mermaid both read `window` while their module loads, so the DOM
// has to exist before they are imported. They are loaded dynamically inside the
// tests for that reason. The config under test is imported statically because it
// is plain data with no DOM dependency.
const dom = new JSDOM("<!DOCTYPE html><body></body>", {
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
    // Some window properties are read-only and are not needed here.
  }
}

// jsdom does not implement SVG text metrics. Mermaid needs them to lay a
// diagram out, so give it plausible numbers.
const svgProto = dom.window.SVGElement.prototype as unknown as Record<
  string,
  unknown
>
svgProto.getComputedTextLength = function (this: Element) {
  return (this.textContent ?? "").length * 7
}
svgProto.getBBox = function (this: Element) {
  const width = (this.textContent ?? "").length * 7
  return { x: 0, y: 0, width, height: 16 }
}

async function loadDomPurify() {
  const mod = await import("dompurify")
  return mod.default
}

const LEGITIMATE = `<svg xmlns="http://www.w3.org/2000/svg"><style>.nodeLabel{font-weight:500}</style><g><foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml" class="nodeLabel">Start here</div></foreignObject><path d="M0 0L10 10"/><marker id="arrow"/></g></svg>`

const HOSTILE: Record<string, string> = {
  "an <img> that would beacon to an attacker and fire onerror": `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject width="100" height="40"><div xmlns="http://www.w3.org/1999/xhtml"><img src="http://attacker.example/x.png" onerror="alert(1)"></div></foreignObject></svg>`,
  "a script element": `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script>label</div></foreignObject></svg>`,
  "an iframe": `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="http://attacker.example"></iframe></foreignObject></svg>`,
  "a nested svg carrying onload": `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><svg onload="alert(1)"><circle r="9"/></svg></div></foreignObject></svg>`,
  "a javascript: href": `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><a href="javascript:alert(1)">click</a></div></foreignObject></svg>`,
}

test("diagrams render under securityLevel strict", () => {
  assert.equal(getMermaidConfig(false).securityLevel, "strict")
  assert.equal(getMermaidConfig(true).securityLevel, "strict")
})

test("the config pins securityLevel against a per-diagram override", async () => {
  const mermaid = (await import("mermaid")).default
  const api = mermaid.mermaidAPI

  mermaid.initialize(getMermaidConfig(false))

  // Mermaid deletes any key named in `secure` before it applies a diagram's
  // %%{init}%% block. If securityLevel dropped off that list, a diagram could
  // switch itself back to loose, which is how the docmost advisory worked.
  assert.ok(
    (getMermaidConfig(false).secure as string[]).includes("securityLevel"),
    "securityLevel must be listed in secure",
  )

  const hostile =
    '%%{init: { "securityLevel": "loose" }}%%\ngraph TD;\n  A-->B;'
  await mermaid.parse(hostile)
  assert.equal(api.getConfig().securityLevel, "strict")
})

test("the sanitizer keeps legitimate diagram labels intact", async () => {
  const DOMPurify = await loadDomPurify()
  const clean = DOMPurify.sanitize(LEGITIMATE, SVG_SANITIZE_CONFIG)

  // Losing any of these means diagrams render with blank nodes, missing arrow
  // heads or unstyled text.
  assert.ok(clean.includes("Start here"), "label text survived")
  assert.ok(clean.includes("nodeLabel"), "label class survived")
  assert.ok(clean.includes("<foreignObject"), "label container survived")
  assert.ok(clean.includes("<style"), "style block survived")
  assert.ok(clean.includes("<marker"), "arrow marker survived")
  assert.ok(clean.includes('d="M0 0L10 10"'), "edge path survived")
})

for (const [attack, svg] of Object.entries(HOSTILE)) {
  test(`the sanitizer strips ${attack}`, async () => {
    const DOMPurify = await loadDomPurify()
    const clean = DOMPurify.sanitize(svg, SVG_SANITIZE_CONFIG)

    assert.doesNotMatch(clean, /<img/i)
    assert.doesNotMatch(clean, /<script/i)
    assert.doesNotMatch(clean, /<iframe/i)
    assert.doesNotMatch(clean, /onerror|onload/i)
    assert.doesNotMatch(clean, /javascript:/i)
    assert.doesNotMatch(clean, /attacker\.example/i)
  })
}
