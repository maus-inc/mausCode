/**
 * The in-chat tool approval round-trip: one registry of waiting tool calls, one
 * function that shows a card and waits for the answer, and one reading of that
 * answer.
 *
 * Extracted from the Claude router, which carried two near-identical copies of
 * this block, one for the permission gate's ask tier and one for the
 * AskUserQuestion tool. Roadmap step 10 rewires approvals through the policy
 * evaluator, so the round-trip now has one home and both call sites use it.
 */
import type { ToolApprovalQuestion, UIMessageChunk } from "./types"

/** How long a card waits for an answer before it denies on its own. */
export const TOOL_APPROVAL_TIMEOUT_MS = 60_000

/** The label that means "refuse" inside an Allow/Deny card. */
export const DENY_OPTION_LABEL = "Deny"

export interface ToolApprovalResponse {
  approved: boolean
  message?: string
  updatedInput?: unknown
}

interface PendingApproval {
  subChatId: string
  resolve: (response: ToolApprovalResponse) => void
}

const pendingToolApprovals = new Map<string, PendingApproval>()

export interface ToolApprovalCard {
  toolUseId: string
  subChatId: string
  questions: ToolApprovalQuestion[]
  /** Chunk sink. Returns false when the observer already closed. */
  emit: (chunk: UIMessageChunk) => unknown
  /** Denial text for a timeout. Defaults to a plain timeout message. */
  timeoutMessage?: string
}

/**
 * Show a card, wait for the answer, and deny on timeout.
 *
 * The timeout deletes the registry entry before resolving, so a late answer for
 * a card that already gave up cannot resolve a newer run for the same sub-chat.
 */
export function askToolApproval(card: ToolApprovalCard): Promise<ToolApprovalResponse> {
  return new Promise<ToolApprovalResponse>((resolve) => {
    const timeoutId = setTimeout(() => {
      pendingToolApprovals.delete(card.toolUseId)
      card.emit({ type: "ask-user-question-timeout", toolUseId: card.toolUseId })
      resolve({
        approved: false,
        message: card.timeoutMessage ?? "Timed out waiting for approval",
      })
    }, TOOL_APPROVAL_TIMEOUT_MS)

    // Registered before the card goes out, so an answer that arrives while the
    // emit is still unwinding has somewhere to land.
    pendingToolApprovals.set(card.toolUseId, {
      subChatId: card.subChatId,
      resolve: (response) => {
        clearTimeout(timeoutId)
        resolve(response)
      },
    })

    card.emit({
      type: "ask-user-question",
      toolUseId: card.toolUseId,
      questions: card.questions,
    })
  })
}

/**
 * True when the answer refused. The card submits `approved: true` with the
 * picked option label in `answers`, so a "Deny" pick is a denial too.
 */
export function approvalWasDenied(response: ToolApprovalResponse): boolean {
  if (!response.approved) return true
  const read = readAnswers(response.updatedInput)
  if (read.kind === "absent") return false
  // An answer set that is present but not readable is refused rather than
  // approved. Nobody can tell Allow from Deny in it, and the card only ever
  // submits string labels, so something else wrote this and the safe reading of
  // "cannot tell" is the one that does not run the tool.
  if (read.kind === "unreadable") return true
  return read.labels.some((answer) =>
    answer
      .split(",")
      .map((picked) => picked.trim())
      .includes(DENY_OPTION_LABEL),
  )
}

/** The picked labels, or the reason there are none to read. */
type AnswerRead = { kind: "absent" } | { kind: "unreadable" } | { kind: "labels"; labels: string[] }

/**
 * Read the picked labels off an untrusted `updatedInput`.
 *
 * Absent means no answer set was submitted at all, which is what the plan
 * approval path sends, so the caller trusts `approved` on its own. Unreadable
 * means an answer set was submitted and could not be read: the value is not an
 * object, or `answers` holds something other than strings. Casting `unknown`
 * straight to a record of strings and calling `split` on the values threw on
 * that input, which would have taken down the approval mutation, and the gate's
 * own catch would have turned it into a denial nobody could read a reason for.
 */
function readAnswers(value: unknown): AnswerRead {
  if (typeof value !== "object" || value === null) return { kind: "absent" }
  const record = value as Record<string, unknown>
  if (!("answers" in record)) return { kind: "absent" }
  const answers = record.answers
  if (typeof answers !== "object" || answers === null || Array.isArray(answers)) {
    return { kind: "unreadable" }
  }
  const values = Object.values(answers as Record<string, unknown>)
  if (values.length === 0) return { kind: "absent" }
  const labels: string[] = []
  for (const entry of values) {
    if (typeof entry !== "string") return { kind: "unreadable" }
    labels.push(entry)
  }
  return { kind: "labels", labels }
}

/**
 * Answer a waiting card. Returns the sub-chat that was waiting, or null when
 * nothing is, so the caller can settle the run that actually asked.
 */
export function resolveToolApproval(
  toolUseId: string,
  response: ToolApprovalResponse,
): string | null {
  const pending = pendingToolApprovals.get(toolUseId)
  if (!pending) return null
  pendingToolApprovals.delete(toolUseId)
  pending.resolve(response)
  return pending.subChatId
}

/** Deny every waiting card, optionally only the ones one sub-chat owns. */
export function clearPendingApprovals(message: string, subChatId?: string): void {
  for (const [toolUseId, pending] of pendingToolApprovals) {
    if (subChatId && pending.subChatId !== subChatId) continue
    pendingToolApprovals.delete(toolUseId)
    pending.resolve({ approved: false, message })
  }
}

/** The Allow/Deny question the permission gate shows for an ask decision. */
export function describeApprovalRequest(
  toolName: string,
  toolInput: Record<string, unknown>,
  rule: string,
): ToolApprovalQuestion {
  return {
    question: describeToolCallForApproval(toolName, toolInput),
    header: toolName,
    options: [
      { label: "Allow", description: `Allow ${toolName} this time` },
      { label: DENY_OPTION_LABEL, description: `Deny ${toolName}, rule ${rule}` },
    ],
    multiSelect: false,
  }
}

/**
 * Read the questions a model passed to AskUserQuestion.
 *
 * The input is untrusted model output and the card is a UI contract, so a
 * question with no text or no options is dropped instead of rendered blank, and
 * an input with nothing usable yields no card at all. The router used to hand
 * this value straight to the renderer behind a cast.
 */
export function questionsFromToolInput(toolInput: Record<string, unknown>): ToolApprovalQuestion[] {
  const raw = toolInput.questions
  if (!Array.isArray(raw)) return []
  const questions: ToolApprovalQuestion[] = []
  for (const entry of raw) {
    const question = readQuestion(entry)
    if (question) questions.push(question)
  }
  return questions
}

function readQuestion(entry: unknown): ToolApprovalQuestion | null {
  if (!isRecord(entry)) return null
  const question = readText(entry.question)
  const options = readOptions(entry.options)
  if (question.length === 0 || options.length === 0) return null
  const header = readText(entry.header)
  return {
    question,
    header: header.length > 0 ? header : question,
    options,
    multiSelect: entry.multiSelect === true,
  }
}

/**
 * Text a card can render. Whitespace alone is not text, because the renderer
 * would show a card with a blank question or a blank button and no way to answer
 * it, so it reads as absent and the entry is dropped instead.
 */
function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function readOptions(raw: unknown): Array<{ label: string; description: string }> {
  if (!Array.isArray(raw)) return []
  const options: Array<{ label: string; description: string }> = []
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const label = readText(entry.label)
    if (label.length === 0) continue
    options.push({ label, description: readText(entry.description) })
  }
  return options
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** One-line description of a tool call, for a card the user has to read fast. */
export function describeToolCallForApproval(
  toolName: string,
  toolInput: Record<string, unknown>,
): string {
  if (toolName === "Bash") {
    const command = typeof toolInput.command === "string" ? toolInput.command : ""
    const description = typeof toolInput.description === "string" ? toolInput.description : ""
    const detail = (description || command).slice(0, 200)
    return detail ? `Run command: ${detail}` : "Run a shell command"
  }
  const filePath = typeof toolInput.file_path === "string" ? toolInput.file_path : ""
  if (filePath) return `${toolName} ${filePath}`.slice(0, 200)
  return `${toolName} (no file path)`
}
