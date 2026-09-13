/**
 * One editable line in the worktree setup command editors.
 *
 * The id exists only so React can hold an `<Input>` instance stable while its text
 * changes and while other rows are added or removed. Keying those rows by array
 * index instead makes a removal drag the *next* row's DOM node - and the caret -
 * into the slot that was just deleted, which is the "focus jumps while editing
 * setup commands" class of bug.
 *
 * Persistence is unaffected: settings still store `string[]`, which is what
 * `toTexts` produces at the save boundary. No migration is needed because the id
 * never leaves memory.
 */

export type CommandRow = { id: string; text: string }

let lastRowId = 0

export function nextRowId(): string {
  lastRowId += 1
  return `cmdrow-${lastRowId}`
}

export function toRows(values: readonly string[]): CommandRow[] {
  return values.map((text) => ({ id: nextRowId(), text }))
}

export function toTexts(rows: readonly CommandRow[]): string[] {
  return rows.map((row) => row.text)
}
