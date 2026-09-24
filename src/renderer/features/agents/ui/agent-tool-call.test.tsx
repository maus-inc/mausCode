// @vitest-environment jsdom
/**
 * When a registry row's subtitle is a button and when it is only text.
 *
 * `AgentToolCall` used to give every subtitle `role="button"`, a tab stop and
 * Enter/Space handling, and attached the handler only when the row had an
 * action — so every `TaskOutput` and `TaskStop` row (and any row rendered
 * without its file-open provider) was a focusable, screen-reader-announced
 * control that did nothing. Pinned here: no affordance, no button; an
 * action or a tooltip that needs a keyboard entry, a native button that
 * carries the focus without declaring a `tabIndex` (Sonar S6845 reads the
 * declaration on a non-interactive element, and Radix's own TooltipTrigger
 * is a button).
 */
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EyeIcon } from "../../../components/ui/icons"
import { TooltipProvider } from "../../../components/ui/tooltip"
import { AgentToolCall } from "./agent-tool-call"

function renderCall(ui: React.ReactElement) {
  return render(<TooltipProvider delayDuration={300}>{ui}</TooltipProvider>)
}

describe("AgentToolCall subtitle affordance", () => {
  it("is plain text when the row has no action and no tooltip", () => {
    const { getByText } = renderCall(
      <AgentToolCall
        icon={EyeIcon}
        title="Got output"
        subtitle="Task: task_1"
        isPending={false}
        isError={false}
      />,
    )
    const subtitle = getByText("Task: task_1")
    expect(subtitle.getAttribute("role")).toBeNull()
    expect(subtitle.getAttribute("tabindex")).toBeNull()
  })

  it("is a button when only a tooltip needs a keyboard entry", () => {
    // TooltipTrigger hangs off focus; a truncated path that only a mouse can
    // reveal is not keyboard-accessible. A native button is Radix's own
    // default trigger: it carries the tab stop natively, so no tabIndex sits
    // on a non-interactive element (Sonar S6845), and with no action to
    // press it gets no handler to fake one.
    const { getByRole } = renderCall(
      <AgentToolCall
        icon={EyeIcon}
        title="Bash"
        subtitle="src/very/long/path/to/file.ts"
        tooltipContent="/abs/src/very/long/path/to/file.ts"
        isPending={false}
        isError={false}
      />,
    )
    const subtitle = getByRole("button", { name: "src/very/long/path/to/file.ts" })
    expect(subtitle.tagName).toBe("BUTTON")
    expect(subtitle.getAttribute("tabindex")).toBeNull()
  })

  it("is a button when the row has an action to press", () => {
    const { getByRole } = renderCall(
      <AgentToolCall
        icon={EyeIcon}
        title="Read"
        subtitle="effort.ts"
        isPending={false}
        isError={false}
        onClick={() => {}}
      />,
    )
    // A native button: implicit role, in the tab order, no hand-rolled keys.
    const subtitle = getByRole("button", { name: "effort.ts" })
    expect(subtitle.tagName).toBe("BUTTON")
  })
})
