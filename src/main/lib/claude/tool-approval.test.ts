/**
 * The in-chat approval round-trip.
 *
 * The registry is module level, so each test answers or clears what it opened.
 * The timeout case matters most: a card that gave up has to be gone from the
 * registry before it resolves, or a late answer settles a newer run for the same
 * sub-chat.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  approvalWasDenied,
  askToolApproval,
  clearPendingApprovals,
  DENY_OPTION_LABEL,
  describeApprovalRequest,
  describeToolCallForApproval,
  questionsFromToolInput,
  resolveToolApproval,
  TOOL_APPROVAL_TIMEOUT_MS,
  type ToolApprovalResponse,
} from "./tool-approval"
import type { UIMessageChunk } from "./types"

function sink() {
  const chunks: UIMessageChunk[] = []
  return { chunks, emit: (chunk: UIMessageChunk) => chunks.push(chunk) }
}

afterEach(() => {
  clearPendingApprovals("test teardown")
  vi.useRealTimers()
})

describe("approvalWasDenied", () => {
  it("is true when the card was refused outright", () => {
    expect(approvalWasDenied({ approved: false, message: "no" })).toBe(true)
  })

  it("is true when the user picked the Deny option", () => {
    // The card submits approved:true with the picked label in answers, so a
    // Deny pick arrives looking like an approval.
    expect(
      approvalWasDenied({ approved: true, updatedInput: { answers: { Bash: DENY_OPTION_LABEL } } }),
    ).toBe(true)
  })

  it("is true when Deny is one of several comma-separated picks", () => {
    expect(
      approvalWasDenied({ approved: true, updatedInput: { answers: { q: "Allow, Deny" } } }),
    ).toBe(true)
  })

  it("is false when the user picked Allow", () => {
    expect(
      approvalWasDenied({ approved: true, updatedInput: { answers: { Bash: "Allow" } } }),
    ).toBe(false)
  })

  it("is false for a bare approval with no answers", () => {
    expect(approvalWasDenied({ approved: true })).toBe(false)
  })
})

describe("askToolApproval", () => {
  it("emits the card and resolves with the answer", async () => {
    const { chunks, emit } = sink()
    const waiting = askToolApproval({
      toolUseId: "tool-1",
      subChatId: "sub-1",
      questions: [describeApprovalRequest("Bash", { command: "npm test" }, "approval.mode.ask")],
      emit,
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.type).toBe("ask-user-question")

    const settled = resolveToolApproval("tool-1", { approved: true })
    expect(settled).toBe("sub-1")
    await expect(waiting).resolves.toEqual({ approved: true })
  })

  it("registers the card before emitting, so an instant answer lands", async () => {
    const { emit } = sink()
    const waiting = askToolApproval({
      toolUseId: "tool-2",
      subChatId: "sub-2",
      questions: [describeApprovalRequest("Edit", { file_path: "a.ts" }, "approval.mode.ask")],
      // Answering from inside the sink is the worst case for ordering: the card
      // has not finished being handed to the renderer yet.
      emit: (chunk) => {
        emit(chunk)
        resolveToolApproval("tool-2", { approved: false, message: "no" })
      },
    })
    await expect(waiting).resolves.toEqual({ approved: false, message: "no" })
  })

  it("returns null for an unknown tool call", () => {
    expect(resolveToolApproval("never-asked", { approved: true })).toBeNull()
  })

  it("denies on timeout and drops the card from the registry", async () => {
    vi.useFakeTimers()
    const { chunks, emit } = sink()
    const waiting = askToolApproval({
      toolUseId: "tool-3",
      subChatId: "sub-3",
      questions: [describeApprovalRequest("Bash", { command: "ls" }, "approval.mode.ask")],
      emit,
    })

    await vi.advanceTimersByTimeAsync(TOOL_APPROVAL_TIMEOUT_MS)

    await expect(waiting).resolves.toEqual({
      approved: false,
      message: "Timed out waiting for approval",
    })
    expect(chunks.map((chunk) => chunk.type)).toContain("ask-user-question-timeout")
    // A late answer must not resolve anything, and above all must not resolve a
    // newer run for the same sub-chat.
    expect(resolveToolApproval("tool-3", { approved: true })).toBeNull()
  })

  it("uses the caller's timeout message when given one", async () => {
    vi.useFakeTimers()
    const { emit } = sink()
    const waiting = askToolApproval({
      toolUseId: "tool-4",
      subChatId: "sub-4",
      questions: [describeApprovalRequest("Bash", { command: "ls" }, "approval.mode.ask")],
      emit,
      timeoutMessage: "Run ended before the card was answered",
    })
    await vi.advanceTimersByTimeAsync(TOOL_APPROVAL_TIMEOUT_MS)
    await expect(waiting).resolves.toMatchObject({
      approved: false,
      message: "Run ended before the card was answered",
    })
  })

  it("clears every card, or only one sub-chat's", async () => {
    const a = sink()
    const b = sink()
    const first = askToolApproval({
      toolUseId: "tool-a",
      subChatId: "sub-a",
      questions: [describeApprovalRequest("Bash", { command: "ls" }, "r")],
      emit: a.emit,
    })
    const second = askToolApproval({
      toolUseId: "tool-b",
      subChatId: "sub-b",
      questions: [describeApprovalRequest("Bash", { command: "ls" }, "r")],
      emit: b.emit,
    })

    clearPendingApprovals("Session cancelled.", "sub-a")
    await expect(first).resolves.toMatchObject({ approved: false, message: "Session cancelled." })
    // The other sub-chat's card is still waiting.
    expect(resolveToolApproval("tool-b", { approved: true })).toBe("sub-b")
    await expect(second).resolves.toEqual({ approved: true })
  })
})

describe("questionsFromToolInput", () => {
  it("reads a well-formed question", () => {
    const questions = questionsFromToolInput({
      questions: [
        {
          question: "Deploy now?",
          header: "Deploy",
          options: [
            { label: "Yes", description: "Ship it" },
            { label: "No", description: "Hold" },
          ],
          multiSelect: false,
        },
      ],
    })
    expect(questions).toHaveLength(1)
    expect(questions[0]?.header).toBe("Deploy")
    expect(questions[0]?.options).toHaveLength(2)
  })

  it("falls back to the question text when there is no header", () => {
    const questions = questionsFromToolInput({
      questions: [{ question: "Pick one", options: [{ label: "A" }] }],
    })
    expect(questions[0]?.header).toBe("Pick one")
    expect(questions[0]?.options[0]).toEqual({ label: "A", description: "" })
  })

  it("drops a question with no text", () => {
    expect(
      questionsFromToolInput({ questions: [{ question: "", options: [{ label: "A" }] }] }),
    ).toEqual([])
  })

  it("drops a question with no usable options", () => {
    expect(questionsFromToolInput({ questions: [{ question: "Pick", options: [] }] })).toEqual([])
    expect(
      questionsFromToolInput({ questions: [{ question: "Pick", options: [{ label: "" }] }] }),
    ).toEqual([])
  })

  it.each([
    ["no questions key", {}],
    ["a non-array", { questions: "Deploy?" }],
    ["a null entry", { questions: [null] }],
    ["a string entry", { questions: ["Deploy?"] }],
    ["an array entry", { questions: [[{ label: "A" }]] }],
  ])("yields no card for %s", (_label, toolInput) => {
    expect(questionsFromToolInput(toolInput)).toEqual([])
  })

  it("keeps the valid questions beside an invalid one", () => {
    const questions = questionsFromToolInput({
      questions: [null, { question: "Real?", options: [{ label: "Yes" }] }],
    })
    expect(questions).toHaveLength(1)
  })

  it("treats multiSelect as false unless it is literally true", () => {
    const questions = questionsFromToolInput({
      questions: [
        { question: "A?", options: [{ label: "x" }], multiSelect: "yes" },
        { question: "B?", options: [{ label: "x" }], multiSelect: true },
      ],
    })
    expect(questions[0]?.multiSelect).toBe(false)
    expect(questions[1]?.multiSelect).toBe(true)
  })
})

describe("describeApprovalRequest", () => {
  it("offers Allow and Deny and names the rule on the Deny side", () => {
    const question = describeApprovalRequest("Bash", { command: "npm test" }, "approval.mode.ask")
    expect(question.header).toBe("Bash")
    expect(question.multiSelect).toBe(false)
    expect(question.options.map((option) => option.label)).toEqual(["Allow", DENY_OPTION_LABEL])
    expect(question.options[1]?.description).toContain("approval.mode.ask")
  })
})

describe("describeToolCallForApproval", () => {
  it("prefers the description over the command for Bash", () => {
    expect(
      describeToolCallForApproval("Bash", { command: "npm test", description: "Run the suite" }),
    ).toBe("Run command: Run the suite")
  })

  it("falls back to the command, truncated", () => {
    const long = "x".repeat(400)
    expect(describeToolCallForApproval("Bash", { command: long })).toBe(
      `Run command: ${"x".repeat(200)}`,
    )
  })

  it("says so when a Bash call has neither", () => {
    expect(describeToolCallForApproval("Bash", {})).toBe("Run a shell command")
  })

  it("names the file for a file tool", () => {
    expect(describeToolCallForApproval("Edit", { file_path: "src/a.ts" })).toBe("Edit src/a.ts")
  })

  it("says so when a file tool named no path", () => {
    expect(describeToolCallForApproval("Edit", {})).toBe("Edit (no file path)")
  })
})

describe("the response type", () => {
  it("carries an optional updated input", () => {
    const response: ToolApprovalResponse = { approved: true, updatedInput: { answers: {} } }
    expect(response.updatedInput).toEqual({ answers: {} })
  })
})
