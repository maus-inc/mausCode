import type { JcodeClient } from "@maus-inc/runtime-client"
import type { HarnessRunEvent } from "../../../shared/run-state.ts"
import type { UIMessageChunk } from "../claude/types"
import type { NativeTranslator } from "./translate"

export type NativeTurnTranslator = Pick<NativeTranslator, "translate">
export type NativeTurnEmit = (chunk: UIMessageChunk) => void
export type NativeTurnRunEventSink = (event: HarnessRunEvent) => void

/**
 * Drains one turn's event stream into emitted chunks and run-record events.
 * The daemon ends the turn with turn_done or error; both are recorded through
 * markCompleted before the loop returns, so a teardown racing that point
 * cannot downgrade the outcome to a cancel. A natural exhaustion of the
 * stream is also a completion, but an exhaustion caused by a cancel closing
 * the iterator is not: shouldStop then sees the cancel flag the teardown set.
 */
export async function consumeNativeTurnStream(
  stream: ReturnType<JcodeClient["events"]>,
  translator: NativeTurnTranslator,
  shouldStop: () => boolean,
  safeEmit: NativeTurnEmit,
  onRunEvent: NativeTurnRunEventSink,
  markCompleted: () => void,
): Promise<void> {
  for await (const event of stream) {
    if (shouldStop()) return
    const translation = translator.translate(event)
    for (const chunk of translation.chunks) safeEmit(chunk)
    for (const runEvent of translation.runEvents) onRunEvent(runEvent)
    if (event.ev === "turn_done" || event.ev === "error") {
      markCompleted()
      return
    }
  }
  if (!shouldStop()) markCompleted()
}
