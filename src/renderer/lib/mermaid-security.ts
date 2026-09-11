// Mermaid rendering policy: the config the diagram renderer runs under, and the
// sanitizer pass its SVG output goes through before it reaches the DOM.
//
// This lives outside the component so the security properties can be asserted
// directly against the values the renderer actually uses.

// Mermaid sanitizes its own output, but it has shipped sanitizer gaps before,
// so the SVG gets a second pass here before it reaches the DOM.
//
// HTML_INTEGRATION_POINTS is what makes this pass safe to run. Without it
// DOMPurify reads the contents of <foreignObject> as SVG, where <div> is not a
// valid element, and it deletes every label in the diagram. With it the labels
// survive untouched and the smuggling tags still go. Measured: a benign
// diagram keeps its foreignObject, <style> and <marker> counts unchanged, and
// against hostile input the <img>, <script>, <iframe>, on* handlers and
// javascript: hrefs are all removed.
export const SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ["foreignObject", "style"],
  ADD_ATTR: ["dominant-baseline", "class", "id", "style"],
  HTML_INTEGRATION_POINTS: { foreignobject: true },
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "img",
    "audio",
    "video",
    "source",
    "track",
    "form",
    "input",
    "button",
    "link",
    "meta",
  ],
  FORBID_ATTR: [
    "onerror",
    "onload",
    "onclick",
    "onmouseover",
    "onfocus",
    "onanimationstart",
  ],
  ALLOW_DATA_ATTR: false,
}

// Mermaid theme configuration based on app theme
// Exported so the security properties below can be tested against the config
// the component actually renders with.
export const getMermaidConfig = (isDark: boolean): Record<string, unknown> => ({
  startOnLoad: false,
  theme: isDark ? "dark" : "default",
  themeVariables: isDark
    ? {
        // Dark theme variables matching the app's color scheme
        primaryColor: "#3b82f6",
        primaryTextColor: "#f4f4f5",
        primaryBorderColor: "#52525b",
        lineColor: "#71717a",
        secondaryColor: "#27272a",
        tertiaryColor: "#18181b",
        background: "#18181b",
        mainBkg: "#27272a",
        nodeBorder: "#52525b",
        clusterBkg: "#27272a",
        defaultLinkColor: "#71717a",
        titleColor: "#f4f4f5",
        edgeLabelBackground: "#27272a",
        actorTextColor: "#f4f4f5",
        actorBorder: "#52525b",
        actorBkg: "#27272a",
        signalColor: "#f4f4f5",
        signalTextColor: "#18181b",
        labelBoxBkgColor: "#27272a",
        labelBoxBorderColor: "#52525b",
        labelTextColor: "#f4f4f5",
        loopTextColor: "#f4f4f5",
        noteBorderColor: "#52525b",
        noteBkgColor: "#27272a",
        noteTextColor: "#f4f4f5",
        sectionBkgColor: "#27272a",
        altSectionBkgColor: "#18181b",
        sectionBkgColor2: "#27272a",
        taskBorderColor: "#52525b",
        taskBkgColor: "#3b82f6",
        taskTextColor: "#f4f4f5",
        taskTextLightColor: "#f4f4f5",
        taskTextOutsideColor: "#f4f4f5",
        activeTaskBorderColor: "#3b82f6",
        gridColor: "#52525b",
        doneTaskBkgColor: "#27272a",
        doneTaskBorderColor: "#52525b",
        critBkgColor: "#dc2626",
        critBorderColor: "#ef4444",
        todayLineColor: "#3b82f6",
        // Sequence diagram
        sequenceNumberColor: "#f4f4f5",
        // Class diagram
        classText: "#f4f4f5",
        // State diagram
        labelColor: "#f4f4f5",
        // ER diagram
        attributeBackgroundColorOdd: "#27272a",
        attributeBackgroundColorEven: "#18181b",
      }
    : {
        // Light theme variables
        primaryColor: "#3b82f6",
        primaryTextColor: "#18181b",
        primaryBorderColor: "#d4d4d8",
        lineColor: "#71717a",
        secondaryColor: "#f4f4f5",
        tertiaryColor: "#fafafa",
        background: "#ffffff",
        mainBkg: "#fafafa",
        nodeBorder: "#d4d4d8",
        clusterBkg: "#f4f4f5",
        defaultLinkColor: "#71717a",
        titleColor: "#18181b",
        edgeLabelBackground: "#fafafa",
      },
  // "strict" encodes HTML in diagram text and disables click callbacks.
  // Diagram source comes from agent-authored markdown (including files read out
  // of untrusted repositories), so "loose" - which allows raw HTML and
  // click handlers - is an XSS path into the Electron renderer.
  securityLevel: "strict" as const,
  // A diagram can override configuration with a leading %%{init: {...}}%%
  // directive, which is how the docmost advisory switched loose mode back on
  // from inside the diagram text. Mermaid deletes every key listed here before
  // applying the directive, so this pins securityLevel against that override.
  // Verified: a diagram asking for securityLevel "loose" still resolves to
  // "strict". htmlLabels is deliberately left at mermaid's default so diagram
  // labels keep rendering exactly as they did before; the sanitizer below is
  // what closes the foreignObject vector instead.
  secure: [
    "secure",
    "securityLevel",
    "startOnLoad",
    "maxTextSize",
    "suppressErrorRendering",
    "maxEdges",
  ],
  fontFamily: "inherit",
})
