import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DataBatcher } from "./data-batcher"

/**
 * The batcher bounds IPC traffic between the terminal PTY and the renderer.
 * These tests pin the two batching policies (time + size) and the UTF-8
 * boundary handling, which are the contract the renderer relies on.
 */

const SIZE_FLUSH_THRESHOLD = 200 * 1024

describe("DataBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("flushes pending data after the batch window elapses", () => {
    const flushed: string[] = []
    const batcher = new DataBatcher((data) => flushed.push(data))

    batcher.write("chunk-1")
    batcher.write("chunk-2")
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(16)
    expect(flushed).toEqual(["chunk-1chunk-2"])
  })

  it("flushes immediately when the buffer exceeds the size threshold", () => {
    const flushed: string[] = []
    const batcher = new DataBatcher((data) => flushed.push(data))

    batcher.write("x".repeat(SIZE_FLUSH_THRESHOLD + 1))
    expect(flushed).toEqual(["x".repeat(SIZE_FLUSH_THRESHOLD + 1)])

    // No trailing timer-based flush may emit an empty or duplicated frame
    vi.advanceTimersByTime(100)
    expect(flushed).toHaveLength(1)
  })

  it("reassembles multi-byte UTF-8 split across chunk boundaries", () => {
    const flushed: string[] = []
    const batcher = new DataBatcher((data) => flushed.push(data))

    // U+1F42D (mouse face) is 4 bytes in UTF-8; split it across two writes
    const bytes = Buffer.from("🐭", "utf8")
    expect(bytes.length).toBe(4)
    batcher.write(bytes.subarray(0, 2))
    batcher.write(bytes.subarray(2))

    vi.advanceTimersByTime(16)
    expect(flushed).toEqual(["🐭"])
  })

  it("dispose flushes buffered data and any trailing partial sequence", () => {
    const flushed: string[] = []
    const batcher = new DataBatcher((data) => flushed.push(data))

    batcher.write("tail")
    batcher.dispose()

    expect(flushed).toEqual(["tail"])
  })

  it("does not invoke onFlush for an empty buffer", () => {
    const onFlush = vi.fn()
    const batcher = new DataBatcher(onFlush)

    batcher.write("")
    vi.advanceTimersByTime(100)
    batcher.dispose()

    expect(onFlush).not.toHaveBeenCalled()
  })
})
