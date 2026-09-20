/**
 * Approval-answer routing: one home for directing tool-approval answers to
 * the legacy SDK path or the native runtime path.
 *
 * Native permission requests reuse the AskUserQuestion UI; their toolUseId
 * carries NATIVE_QUESTION_PREFIX (see src/shared/runtime-protocol.ts), which
 * is the only routing signal — callers pass through whatever id the question
 * UI gives them.
 */
import { NATIVE_QUESTION_PREFIX } from "../../../../shared/runtime-protocol"
import { trpcClient } from "../../../lib/trpc"

export interface ApprovalAnswer {
  toolUseId: string
  approved: boolean
  /** Legacy-only: free-text message attached to the decision. */
  message?: string
  /** Modified tool input, and where the picked labels travel. */
  updatedInput?: unknown
}

export async function respondToApproval(subChatId: string, answer: ApprovalAnswer): Promise<void> {
  if (answer.toolUseId.startsWith(NATIVE_QUESTION_PREFIX)) {
    await trpcClient.runtime.respondApproval.mutate({
      subChatId,
      requestId: answer.toolUseId.slice(NATIVE_QUESTION_PREFIX.length),
      approved: answer.approved,
      // Forwarded so the router can read a Deny pick. The card submits
      // `approved: true` whichever option the user takes, so dropping the labels
      // here would have answered allow to a refusal.
      ...(answer.updatedInput === undefined ? {} : { updatedInput: answer.updatedInput }),
    })
    return
  }
  await trpcClient.claude.respondToolApproval.mutate({
    toolUseId: answer.toolUseId,
    approved: answer.approved,
    message: answer.message,
    updatedInput: answer.updatedInput,
  })
}
