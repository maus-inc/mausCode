/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
/**
 * Returns true if the assistant text ends with a question to the user.
 * Strips trailing markdown decoration and code-fence remnants before
 * checking for a final "?" character.
 */
export function isQuestionText(text: string | null | undefined): boolean {
  if (!text) return false
  const trimmed = text.trim()
  if (!trimmed) return false
  const stripped = trimmed.replace(/[*_~`>\s)]+$/g, "")
  return stripped.slice(-1) === "?"
}

/**
 * Pulls the last non-empty assistant text part from a message.parts array
 * and returns whether that final part is a question.
 */
export function isAssistantMessageQuestion(
  parts: { type: string; text?: string }[] | undefined | null,
): boolean {
  if (!parts?.length) return false
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]
    if (part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
      return isQuestionText(part.text)
    }
  }
  return false
}
