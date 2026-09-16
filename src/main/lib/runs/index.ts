/**
 * Main-process entry point for the run store (roadmap step 07). Kept apart
 * from `run-state.ts` so the machine itself stays free of Electron imports
 * and testable against an injected database.
 */
import { getDatabase } from "../db"
import { createRunStore, type RunStore } from "./run-state"

let runStore: RunStore | null = null

export function getRunStore(): RunStore {
  runStore ??= createRunStore(getDatabase())
  return runStore
}

/**
 * Startup recovery hook, called once after migrations run. A failure here
 * must never block app startup, so it logs and continues.
 */
export function recoverInterruptedRuns(): number {
  try {
    const recovered = getRunStore().recoverInterrupted().length
    if (recovered > 0) {
      console.log(`[runs] recovered ${recovered} interrupted run(s) at startup`)
    }
    return recovered
  } catch (error) {
    console.error("[runs] startup recovery failed:", error)
    return 0
  }
}

export type { RunFeedItem, RunHandle, RunStore, StartRunInput } from "./run-state"
