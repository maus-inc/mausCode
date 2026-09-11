/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
// Dev-only memory monitor + memory-pressure-driven tab eviction.
//
// V8 caps the renderer heap around 4GB (pointer compression). With multiple
// chat tabs open, each holding full message + tool-result state, the renderer
// drifts toward that cap and aborts (SIGTRAP / EXC_BREAKPOINT).
//
// This monitor:
//   1. Logs `performance.memory` every 10s to console AND to a persistent
//      file in userData so the trace survives a renderer crash (devtools
//      console is wiped on reload). Read with:
//        tail -50 ~/Library/Application\ Support/mausCode\ Dev/mem-trace.ndjson
//   2. When used heap rises past HIGH_PRESSURE_BYTES, drops the mounted
//      sub-chat tab limit to 1 — only the active tab stays in memory.
//   3. When pressure clears (back under LOW_PRESSURE_BYTES), restores the
//      default tab limit so tab switching is instant again.
//
// Disable with VITE_MEMORY_MONITOR=0.

import { appStore } from "./jotai-store"
import {
  DEFAULT_MAX_MOUNTED_TABS,
  maxMountedTabsAtom,
} from "../features/agents/atoms"

type PerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize: number
    totalJSHeapSize: number
    jsHeapSizeLimit: number
  }
}

const INTERVAL_MS = 10_000 // 10s — tight enough to catch streaming spikes
const MB = 1024 * 1024
// Trigger eviction earlier. V8 cap is ~4GB; the closer we get the less time
// we have to react. 1.8GB leaves ~2.2GB of headroom for streaming bursts.
const HIGH_PRESSURE_BYTES = 1.8 * 1024 * MB
const LOW_PRESSURE_BYTES = 1.2 * 1024 * MB
const EVICTED_TAB_LIMIT = 1

// A separate, even earlier warning so we record context before things go bad.
const WARNING_BYTES = 1.2 * 1024 * MB

function format(bytes: number | undefined): string {
  if (typeof bytes !== "number") return "?"
  return `${(bytes / MB).toFixed(1)}MB`
}

let started = false
let baseline: number | null = null
let evicting = false
let warned = false
let peak = 0

function persist(line: string): void {
  // Fire and forget — preload exposes this; if not, skip silently.
  // NOTE (mausCode): the main-side mem-trace handler was not transplanted,
  // so this degrades to console-only. Cast needed: no DesktopApi member.
  try {
    ;(window.desktopApi as { appendMemLog?: (line: string) => Promise<unknown> } | undefined)?.appendMemLog?.(line)?.catch(() => {})
  } catch {
    // ignore
  }
}

function applyMemoryPressure(usedBytes: number): void {
  if (!warned && usedBytes > WARNING_BYTES) {
    warned = true
    console.warn(
      `[mem] approaching pressure threshold (used=${format(usedBytes)}, ` +
        `evict at ${format(HIGH_PRESSURE_BYTES)})`,
    )
  }

  if (!evicting && usedBytes > HIGH_PRESSURE_BYTES) {
    evicting = true
    appStore.set(maxMountedTabsAtom, EVICTED_TAB_LIMIT)
    console.warn(
      `[mem] high pressure (used=${format(usedBytes)}) → evicting background tabs ` +
        `(maxMountedTabs=${EVICTED_TAB_LIMIT}). Switching tabs may show a brief reload.`,
    )
    return
  }

  if (evicting && usedBytes < LOW_PRESSURE_BYTES) {
    evicting = false
    warned = false
    appStore.set(maxMountedTabsAtom, DEFAULT_MAX_MOUNTED_TABS)
    console.log(
      `[mem] pressure cleared (used=${format(usedBytes)}) → restoring ` +
        `maxMountedTabs=${DEFAULT_MAX_MOUNTED_TABS}`,
    )
  }
}

export function startMemoryMonitor(): void {
  if (started) return
  if (!import.meta.env.DEV) return
  if (import.meta.env.VITE_MEMORY_MONITOR === "0") return

  const perf = performance as PerformanceWithMemory
  if (!perf.memory) {
    return
  }
  started = true

  const sample = () => {
    const mem = perf.memory
    if (!mem) return
    if (baseline === null) baseline = mem.usedJSHeapSize
    if (mem.usedJSHeapSize > peak) peak = mem.usedJSHeapSize
    const deltaMb = ((mem.usedJSHeapSize - baseline) / MB).toFixed(1)
    const peakMb = (peak / MB).toFixed(1)

    const line = JSON.stringify({
      ts: Date.now(),
      used: mem.usedJSHeapSize,
      total: mem.totalJSHeapSize,
      limit: mem.jsHeapSizeLimit,
      peak,
      deltaFromBaseline: mem.usedJSHeapSize - baseline,
      evicting,
    })
    console.log(
      `[mem] used=${format(mem.usedJSHeapSize)} total=${format(mem.totalJSHeapSize)} ` +
        `limit=${format(mem.jsHeapSizeLimit)} Δ=${deltaMb}MB peak=${peakMb}MB`,
    )
    persist(line)

    applyMemoryPressure(mem.usedJSHeapSize)
  }

  sample()
  setInterval(sample, INTERVAL_MS)
}
