/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
/**
 * Plays question.mp3 to signal that the model is asking a question and is
 * waiting for the user. Distinct from the standard completion sound (done.mp3)
 * so the user can tell them apart by ear.
 */

export function playQuestionSound(): void {
  try {
    const audio = new Audio("./question.mp3")
    audio.volume = 1.0
    audio.play().catch(() => {})
  } catch {
    // ignore audio errors
  }
}
