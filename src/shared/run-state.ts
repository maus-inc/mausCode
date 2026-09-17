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
