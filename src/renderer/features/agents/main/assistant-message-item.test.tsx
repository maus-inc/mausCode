// @vitest-environment jsdom
/**
 * What the transcript renderer produces, pinned before it is restructured.
 *
 * `renderPart` in `assistant-message-item.tsx` decides what every kind of
 * message part looks like. It was a ~250-line dispatcher at a cognitive
 * complexity SonarQube reported as 70 against a threshold of 15, and until this
 * file existed nothing in the suite rendered any of it: the vitest environment
 * is `node`, so the dispatcher's behaviour was verified by reading it. It is now
 * `renderMessagePart` plus one module-scope function per shape — a change this
 * file made safe rather than a change this file describes.
 *
 * These snapshots are the golden output for one message per branch of that
 * dispatcher, written against the code as it stood and committed before the
 * split, so the restructuring could be checked against what the renderer
 * actually produced rather than against a reviewer's memory of it. The split
 * landed one commit later and changed no byte of them. Nothing here asserts
 * intent or good taste. It records output, and it stands as the guard on the
 * next change to any of these branches, where the acceptable result is a diff
 * somebody meant.
 */
import { fireEvent, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TooltipProvider } from "../../../components/ui/tooltip"
import type { Message, MessagePart } from "../stores/message-store"
import { AssistantMessageItem } from "./assistant-message-item"

// The chime plays when a message ends on a question awaiting an answer. jsdom
// has no Audio, and a sound is not part of the output these snapshots pin.
vi.mock("../lib/play-question-sound", () => ({ playQuestionSound: vi.fn() }))

// jsdom implements neither, and Radix's collapsible reaches for both while the
// step group renders.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  },
)

/**
 * The transcript renders inside the agents layout, which wraps its tree in a
 * tooltip provider; the tool rows need that context to render at all.
 */
function renderMessage(message: Message, streaming: boolean): string {
  const { container } = render(
    <TooltipProvider delayDuration={300}>
      <AssistantMessageItem
        message={message}
        isLastMessage={streaming}
        isStreaming={streaming}
        status={streaming ? "streaming" : "ready"}
        isMobile={false}
        subChatId="sub-chat-1"
        chatId="chat-1"
      />
    </TooltipProvider>,
  )
  return container.innerHTML
}

/**
 * Each message gets its own id: the module keeps a per-message state cache to
 * survive the AI SDK mutating parts in place, and a shared id would let one
 * test's cache decide the next test's memo comparison.
 */
let messageSequence = 0

// The id lands in the rendered DOM, so it is reset per test: a snapshot must not
// depend on how many tests ran before it.
beforeEach(() => {
  messageSequence = 0
})

function renderParts(parts: MessagePart[], streaming = false): string {
  const message: Message = {
    id: `msg-${++messageSequence}`,
    role: "assistant",
    parts,
  }
  return renderMessage(message, streaming)
}

/** The same message as `renderParts`, but with the DOM still attached to click on. */
function renderPartsDom(parts: MessagePart[]): HTMLElement {
  const { container } = render(
    <TooltipProvider delayDuration={300}>
      <AssistantMessageItem
        message={{ id: `msg-${++messageSequence}`, role: "assistant", parts }}
        isLastMessage={false}
        isStreaming={false}
        status="ready"
        isMobile={false}
        subChatId="sub-chat-1"
        chatId="chat-1"
      />
    </TooltipProvider>,
  )
  return container
}

/** A completed tool call, which is the state every fixture below starts from. */
function tool(type: string, id: string, input: unknown, output?: unknown): MessagePart {
  return { type, toolCallId: id, state: "output-available", input, output }
}

describe("AssistantMessageItem, one message per branch of the part dispatcher", () => {
  it("renders a text part", () => {
    expect(renderParts([{ type: "text", text: "Both pins moved together." }])).toMatchSnapshot()
  })

  it("renders nothing for a text part that is only whitespace", () => {
    expect(renderParts([{ type: "text", text: "   \n " }])).toMatchSnapshot()
  })

  it("renders nothing for a step-start marker", () => {
    expect(renderParts([{ type: "step-start" }])).toMatchSnapshot()
  })

  it("renders nothing for a part that is neither text nor a tool", () => {
    expect(
      renderParts([{ type: "file-content", filePath: "notes.txt", content: "hidden" }]),
    ).toMatchSnapshot()
  })

  it("renders a Bash call with its command, output and exit code", () => {
    expect(
      renderParts([
        tool(
          "tool-Bash",
          "toolu_bash_1",
          { command: "rg -n 'ALL_FEATURES_OFF' src" },
          {
            stdout: "src/shared/provider-capabilities.ts:41:export const ALL_FEATURES_OFF\n",
            exitCode: 0,
          },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a failing Bash call", () => {
    expect(
      renderParts([
        tool(
          "tool-Bash",
          "toolu_bash_2",
          { command: "bun run build" },
          { stdout: "", stderr: "electron-builder exited with 1", exitCode: 1 },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a reasoning part", () => {
    expect(
      renderParts([
        { type: "reasoning", text: "The registry names six legacy spellings.", state: "done" },
      ]),
    ).toMatchSnapshot()
  })

  it("renders a completed thinking tool", () => {
    expect(
      renderParts([
        {
          type: "tool-Thinking",
          toolCallId: "toolu_think_1",
          toolName: "Thinking",
          state: "output-available",
          input: { text: "Check the changelog for the wire name." },
          output: { completed: true },
        },
      ]),
    ).toMatchSnapshot()
  })

  it("renders an Edit with its patch", () => {
    expect(
      renderParts([
        tool(
          "tool-Edit",
          "toolu_edit_1",
          {
            file_path: "/repo/src/shared/provider-capabilities.ts",
            old_string: "export const TURN_CONTROLS_OFF",
            new_string: "export const ALL_FEATURES_OFF",
          },
          {
            structuredPatch: [
              { lines: ["- export const TURN_CONTROLS_OFF", "+ export const ALL_FEATURES_OFF"] },
            ],
          },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a Write with its content", () => {
    expect(
      renderParts([
        tool("tool-Write", "toolu_write_1", {
          file_path: "/repo/src/shared/effort.ts",
          content: "export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high'] as const\n",
        }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a plan file as a plan card", () => {
    expect(
      renderParts([
        tool("tool-Write", "toolu_plan_1", {
          file_path: "/repo/claude-sessions/plans/step-12-plan.md",
          content: "# Step 12\n\nMove the pins together.\n",
        }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a second plan operation as a mini indicator, not a card", () => {
    expect(
      renderParts([
        tool("tool-Write", "toolu_plan_2", {
          file_path: "/repo/plans-a-plan.md",
          content: "# First\n",
        }),
        tool("tool-Edit", "toolu_plan_3", {
          file_path: "/repo/plans-a-plan.md",
          old_string: "# First",
          new_string: "# Second",
        }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a plan operation that is still streaming as a shimmer", () => {
    expect(
      renderParts(
        [
          {
            type: "tool-Write",
            toolCallId: "toolu_plan_4",
            state: "input-streaming",
            input: { file_path: "/repo/plans-arriving-plan.md", content: "# Still arriving\n" },
          },
          tool("tool-Edit", "toolu_plan_5", {
            file_path: "/repo/plans-arriving-plan.md",
            old_string: "# Still arriving",
            new_string: "# Arrived",
          }),
        ],
        true,
      ),
    ).toMatchSnapshot()
  })

  it("renders the four things a plan operation's indicator can say", () => {
    expect(
      renderParts(
        [
          {
            type: "tool-Edit",
            toolCallId: "toolu_plan_6",
            state: "input-streaming",
            input: {
              file_path: "/repo/plans-labels-plan.md",
              old_string: "",
              new_string: "# Arriving",
            },
          },
          tool("tool-Edit", "toolu_plan_7", {
            file_path: "/repo/plans-labels-plan.md",
            old_string: "# Arriving",
            new_string: "# Arrived",
          }),
          tool("tool-Write", "toolu_plan_8", {
            file_path: "/repo/plans-labels-plan.md",
            content: "# Arrived, and last, so a card\n",
          }),
        ],
        true,
      ),
    ).toMatchSnapshot()
  })

  it("renders a web search with its results", () => {
    expect(
      renderParts([
        tool(
          "tool-WebSearch",
          "toolu_search_1",
          { query: "claude agent sdk 0.3.270 changelog" },
          {
            results: [
              {
                content: [
                  { title: "SDK changelog", url: "https://example.com/changelog" },
                  { title: "Release notes", url: "https://example.com/releases" },
                ],
              },
            ],
          },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a web fetch", () => {
    expect(
      renderParts([
        tool(
          "tool-WebFetch",
          "toolu_fetch_1",
          { url: "https://example.com/docs/pins" },
          { result: "Fetched the pin table.", bytes: 12048, code: 200 },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a PlanWrite", () => {
    expect(
      renderParts([
        tool("tool-PlanWrite", "toolu_planwrite_1", {
          plan: {
            status: "completed",
            steps: [
              { title: "Pin the SDK and the CLI together", status: "completed" },
              { title: "Register the renamed tools", status: "completed" },
            ],
          },
        }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders nothing for ExitPlanMode", () => {
    expect(renderParts([tool("tool-ExitPlanMode", "toolu_exit_1", {})])).toMatchSnapshot()
  })

  it("renders a todo list", () => {
    expect(
      renderParts([
        tool(
          "tool-TodoWrite",
          "toolu_todo_1",
          {
            todos: [
              { content: "Pin the SDK", status: "completed", activeForm: "Pinning the SDK" },
              {
                content: "Register the tools",
                status: "in_progress",
                activeForm: "Registering the tools",
              },
            ],
          },
          { oldTodos: [], newTodos: [{ content: "Pin the SDK", status: "completed" }] },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a question awaiting an answer", () => {
    expect(
      renderParts([
        {
          type: "tool-AskUserQuestion",
          toolCallId: "toolu_ask_1",
          state: "call",
          input: {
            questions: [
              {
                question: "Which SDK version should the pin take?",
                header: "SDK pin",
                multiSelect: false,
                options: [
                  { label: "0.3.270", description: "Matches the CLI pin." },
                  { label: "0.3.280", description: "One release ahead." },
                ],
              },
            ],
          },
        },
      ]),
    ).toMatchSnapshot()
  })

  it("renders a registry tool as a single row", () => {
    expect(
      renderParts([tool("tool-Read", "toolu_read_1", { file_path: "/repo/src/shared/effort.ts" })]),
    ).toMatchSnapshot()
  })

  it("renders the renamed background-output tool", () => {
    expect(
      renderParts([
        tool("tool-TaskOutput", "toolu_taskoutput_1", { task_id: "task_1" }, { output: "done" }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a subagent task with its nested tools", () => {
    expect(
      renderParts([
        tool("tool-Agent", "toolu_agent_1", {
          subagent_type: "general-purpose",
          description: "Find every pin the step has to move",
        }),
        tool("tool-Read", "toolu_agent_1:0", { file_path: "/repo/package.json" }),
        tool(
          "tool-Bash",
          "toolu_agent_1:1",
          { command: "git diff --stat" },
          { stdout: "", exitCode: 0 },
        ),
      ]),
    ).toMatchSnapshot()
  })

  it("renders an orphaned nested group as an incomplete task", () => {
    expect(
      renderParts([
        tool("tool-Bash", "toolu_ghost_1:0", { command: "ls" }, { stdout: "", exitCode: 0 }),
        tool("tool-Read", "toolu_ghost_1:1", { file_path: "/repo/AGENTS.md" }),
      ]),
    ).toMatchSnapshot()
  })

  it("tells a launch apart from a finished subagent", () => {
    const html = renderParts([
      tool(
        "tool-Agent",
        "toolu_async_1",
        { subagent_type: "general-purpose", description: "Watch the queue" },
        {
          status: "async_launched",
          agentId: "agent_1",
          description: "Watch the queue",
          prompt: "watch",
          outputFile: "/tmp/agent.log",
        },
      ),
      tool(
        "tool-Agent",
        "toolu_remote_1",
        { subagent_type: "general-purpose", description: "Run elsewhere" },
        {
          status: "remote_launched",
          taskId: "task_9",
          description: "Run elsewhere",
          prompt: "run",
        },
      ),
      tool(
        "tool-Agent",
        "toolu_done_1",
        { subagent_type: "general-purpose", description: "Finished run" },
        { status: "completed", prompt: "done" },
      ),
    ])
    // Two launches say launched; only the `completed` status says completed.
    expect(html.match(/Launched Subagent/g)).toHaveLength(2)
    expect(html).toContain("Completed Subagent")
    expect(html).toMatchSnapshot()
  })

  it("keeps a nested subagent's descendants under it instead of orphaning them", () => {
    const html = renderParts([
      tool("tool-Agent", "toolu_agent_1", {
        subagent_type: "general-purpose",
        description: "Outer agent",
      }),
      tool("tool-Agent", "toolu_agent_1:toolu_agent_2", {
        subagent_type: "general-purpose",
        description: "Inner agent",
      }),
      tool("tool-Read", "toolu_agent_2:toolu_read_9", { file_path: "/repo/nested.txt" }),
    ])
    // The parent is resolved through the full id map: no top-level task is
    // named `toolu_agent_2`, and before that lookup existed the Read stood up
    // a fake "Incomplete task" instead of living under the inner agent.
    expect(html).not.toContain("Incomplete task")
    expect(html).toMatchSnapshot()
  })

  it("keeps a non-actionable subtitle out of the tab order", () => {
    const container = renderPartsDom([
      tool("tool-TaskOutput", "toolu_taskoutput_1", { task_id: "task_1" }, { output: "done" }),
    ])
    // TaskOutput's subtitle identifies the output and does nothing else, so
    // it must be plain text: no role, no tab stop. (The positive case — a
    // subtitle with an action — is pinned in agent-tool-call.test.tsx; here
    // the transcript renders without the file-open provider, so no row would
    // have an action to assert.)
    const inert = Array.from(container.querySelectorAll("span")).find(
      (s) => s.textContent === "Task: task_1",
    )
    expect(inert).toBeTruthy()
    expect(inert?.getAttribute("role")).toBeNull()
    expect(inert?.getAttribute("tabindex")).toBeNull()
  })

  it("renders a three-level subagent chain once each level is expanded", () => {
    const container = renderPartsDom([
      tool("tool-Agent", "toolu_agent_1", {
        subagent_type: "general-purpose",
        description: "Outer agent",
      }),
      tool("tool-Agent", "toolu_agent_1:toolu_agent_2", {
        subagent_type: "general-purpose",
        description: "Inner agent",
      }),
      tool("tool-Read", "toolu_agent_2:toolu_read_9", { file_path: "/repo/nested.txt" }),
    ])
    const clickHeader = (needle: string) => {
      const header = Array.from(container.querySelectorAll<HTMLElement>('[role="button"]')).find(
        (el) => el.textContent?.includes(needle),
      )
      expect(header, `a header containing ${needle}`).toBeTruthy()
      fireEvent.click(header as HTMLElement)
    }
    clickHeader("Outer agent")
    clickHeader("Inner agent")
    // The Read row's subtitle is the file's basename — proof the descendant
    // renders under the inner agent rather than at the top level or nowhere.
    expect(container.textContent).toContain("nested.txt")
  })

  it("renders an MCP tool call", () => {
    expect(
      renderParts([
        tool("tool-mcp__filesystem__read_file", "toolu_mcp_1", { path: "/tmp/pins.json" }),
      ]),
    ).toMatchSnapshot()
  })

  it("renders a tool nobody registered as its bare name", () => {
    expect(
      renderParts([tool("tool-SomethingTheNextCliAdds", "toolu_future_1", {})]),
    ).toMatchSnapshot()
  })

  it("collapses the steps under a final text part", () => {
    expect(
      renderParts([
        tool(
          "tool-Bash",
          "toolu_collapse_1",
          { command: "bun install --frozen-lockfile" },
          { stdout: "", exitCode: 0 },
        ),
        tool("tool-Read", "toolu_collapse_2", { file_path: "/repo/bun.lock" }),
        { type: "text", text: "The lockfile is clean." },
      ]),
    ).toMatchSnapshot()
  })

  it("keeps every part visible while the last message streams", () => {
    expect(
      renderParts(
        [
          tool(
            "tool-Bash",
            "toolu_stream_1",
            { command: "bun run lint" },
            { stdout: "", exitCode: 0 },
          ),
          { type: "text", text: "Lint is clean so far." },
        ],
        true,
      ),
    ).toMatchSnapshot()
  })

  it("groups three consecutive exploring tools", () => {
    expect(
      renderParts([
        tool("tool-Read", "toolu_explore_1", { file_path: "/repo/src/a.ts" }),
        tool("tool-Read", "toolu_explore_2", { file_path: "/repo/src/b.ts" }),
        tool("tool-Read", "toolu_explore_3", { file_path: "/repo/src/c.ts" }),
        { type: "text", text: "Read all three." },
      ]),
    ).toMatchSnapshot()
  })

  it("renders usage and git badges from message metadata", () => {
    const message: Message = {
      id: `msg-${++messageSequence}`,
      role: "assistant",
      parts: [{ type: "text", text: "Done." }],
      metadata: {
        inputTokens: 1200,
        outputTokens: 340,
        cacheReadInputTokens: 800,
        cacheCreationInputTokens: 0,
      },
    }
    expect(renderMessage(message, false)).toMatchSnapshot()
  })
})
