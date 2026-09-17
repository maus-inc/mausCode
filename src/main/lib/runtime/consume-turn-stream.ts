import type { JcodeClient } from "@maus-inc/runtime-client"
import type { UIMessageChunk } from "../claude/types"
import type { NativeTranslator } from "./translate"

export type NativeTurnTranslator = Pick<NativeTranslator, "translate">
export type NativeTurnEmit = (chunk: UIMessageChunk) => void

/**
 * Drains one turn's event stream into emitted chunks. The daemon ends the
 * turn with turn_done or error; both are recorded through markCompleted
 * before the loop returns, so a teardown racing that point cannot downgrade
 * the outcome to a cancel. A natural exhaustion of the stream is also a
 * completion, but an exhaustion caused by a cancel closing the iterator is
 * not: shouldStop then sees the cancel flag the teardown set.
 */
export async function consumeNativeTurnStream(
  stream: ReturnType<JcodeClient["events"]>,
  translator: NativeTurnTranslator,
  shouldStop: () => boolean,
  safeEmit: NativeTurnEmit,
  markCompleted: () => void,
): Promise<void> {
  for await (const event of stream) {
    if (shouldStop()) return
    for (const chunk of translator.translate(event)) safeEmit(chunk)
    if (event.ev === "turn_done" || event.ev === "error") {
      markCompleted()
      return
    }
  }
  if (!shouldStop()) markCompleted()
}
