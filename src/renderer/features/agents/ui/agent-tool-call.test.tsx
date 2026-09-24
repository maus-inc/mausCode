// @vitest-environment jsdom
/**
 * When a registry row's subtitle is a button and when it is only text.
 *
 * `AgentToolCall` used to give every subtitle `role="button"`, a tab stop and
 * Enter/Space handling, and attached the handler only when the row had an
 * action — so every `TaskOutput` and `TaskStop` row (and any row rendered
 * without its file-open provider) was a focusable, screen-reader-announced
 * control that did nothing. The two halves of that are pinned here: no
 * action, no button; action, button that works.
 */
import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { EyeIcon } from "../../../components/ui/icons"
import { AgentToolCall } from "./agent-tool-call"

describe("AgentToolCall subtitle affordance", () => {
  it("is plain text when the row has no action", () => {
    const { getByText } = render(
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

  it("is a button when the row has an action to press", () => {
    const { getByText } = render(
      <AgentToolCall
        icon={EyeIcon}
        title="Read"
        subtitle="effort.ts"
        isPending={false}
        isError={false}
        onClick={() => {}}
      />,
    )
    const subtitle = getByText("effort.ts")
    expect(subtitle.getAttribute("role")).toBe("button")
    expect(subtitle.getAttribute("tabindex")).toBe("0")
  })
})
