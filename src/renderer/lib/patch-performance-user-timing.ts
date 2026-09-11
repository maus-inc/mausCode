/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. See openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3).
 */
// React 19's dev build calls `performance.measure(name, { detail: ... })` to
// populate DevTools' "Components ⚛" / "Scheduler ⚛" tracks. The browser
// structured-clones the `detail` field. When the renderer heap nears V8's
// ~4GB cap, the clone fails with `DataCloneError: ... out of memory.` and
// surfaces as an uncaught error because React doesn't wrap the call.
//
// Profiler entries are dev-only telemetry — dropping one is harmless. Wrap
// `measure`/`mark` so the failing clone is swallowed and React's commit
// phase continues. The underlying heap pressure is handled separately by
// `memory-monitor.ts` (tab eviction at HIGH_PRESSURE_BYTES).
//
// Must run BEFORE `react-dom/client` is imported so React's later lookups
// of `performance.measure` resolve to the wrapped version.

type MeasureArgs = Parameters<Performance["measure"]>
type MarkArgs = Parameters<Performance["mark"]>

function isDataCloneError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "DataCloneError"
}

function patch(): void {
  if (typeof performance === "undefined") return

  if (typeof performance.measure === "function") {
    const originalMeasure = performance.measure.bind(performance)
    performance.measure = function patchedMeasure(...args: MeasureArgs) {
      try {
        return originalMeasure(...args)
      } catch (err) {
        if (isDataCloneError(err)) {
          return undefined as unknown as PerformanceMeasure
        }
        throw err
      }
    }
  }

  if (typeof performance.mark === "function") {
    const originalMark = performance.mark.bind(performance)
    performance.mark = function patchedMark(...args: MarkArgs) {
      try {
        return originalMark(...args)
      } catch (err) {
        if (isDataCloneError(err)) {
          return undefined as unknown as PerformanceMark
        }
        throw err
      }
    }
  }
}

patch()
