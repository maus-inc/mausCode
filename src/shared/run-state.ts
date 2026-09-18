/**
 * Run state vocabulary shared by the main-process run store and the renderer
 * projection. Roadmap step 07. The main process owns transitions
 * (`src/main/lib/runs/run-state.ts`); the renderer only reads them.
 */

export const RUN_STATUSES = [
  "running",
  "waiting_approval",
  "completed",
  "error",
  "cancelled",
  "interrupted",
] as const

export type RunStatus = (typeof RUN_STATUSES)[number]

export const ACTIVE_RUN_STATUSES = ["running", "waiting_approval"] as const

export function isActiveRunStatus(value: string): value is (typeof ACTIVE_RUN_STATUSES)[number] {
  return (ACTIVE_RUN_STATUSES as readonly string[]).includes(value)
}

export const RUN_ENGINES = ["legacy", "native"] as const

export type RunEngine = (typeof RUN_ENGINES)[number]

/**
 * Harness events the runtime mapper records as run events (roadmap step 09).
 * They extend the run record and feed, not `runs.status`: none names a legal
 * target in `RUN_STATUSES`, and the step 07 design record reserves a
 * `backgrounded` status for the backgrounding work that owns
 * `wake_requested` and `background_progress` consumers.
 */
export const HARNESS_RUN_EVENT_KINDS = [
  "compacted",
  "session_status",
  "background_progress",
  "wake_requested",
] as const

export type HarnessRunEventKind = (typeof HARNESS_RUN_EVENT_KINDS)[number]

export interface HarnessRunEvent {
  kind: HarnessRunEventKind
  payload: Record<string, unknown>
}

/** Longest string value allowed inside a run event payload field. */
export const RUN_EVENT_TEXT_CAP = 500
