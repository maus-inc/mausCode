/**
 * Main-process entry point for the run store (roadmap step 07). Kept apart
 * from `run-state.ts` so the machine itself stays free of Electron imports
 * and testable against an injected database.
 */
import { getDatabase } from "../db"
import { createRunStore, type RunStore } from "./run-state"

let runStore: RunStore | null = null

export function getRunStore(): RunStore {
  if (!runStore) {
    runStore = createRunStore(getDatabase())
  }
  return runStore
}

/** Startup recovery hook, called once after migrations run. */
export function recoverInterruptedRuns(): number {
  return getRunStore().recoverInterrupted().length
}

export type { RunFeedItem, RunHandle, RunStore, StartRunInput } from "./run-state"
