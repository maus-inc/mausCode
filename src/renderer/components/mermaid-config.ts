/**
 * Mermaid configuration shared by the diagram renderer. Kept as a pure
 * module so the security-relevant defaults are unit-testable without the
 * component graph.
 */
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
  // "strict": mermaid sanitizes label HTML and disables click interactivity,
  // so a model-authored diagram cannot inject markup through RawHtml.
  securityLevel: "strict" as const,
  fontFamily: "inherit",
})
