/**
 * Which turn owns the in-memory credentials of one native session.
 *
 * The runtime keeps one value per provider variable, and a turn that a
 * replacement superseded can finish after the replacement already applied its
 * keys. Releasing the superseded turn's keys blindly would strip the credential
 * the running turn depends on, so ownership is recorded per provider: a turn
 * clears a provider only while that slot still holds the value this turn wrote.
 * Ownership survives until the clear has settled, so a provider claimed while
 * the clear was in flight is not given up by the turn that no longer holds it.
 *
 * A generation number is allocated before the first key is written and is never
 * reused for a session, so a straggler from an older turn can never be mistaken
 * for the live one, even after the live turn released its keys. It is pure
 * state with no I/O, so the race is unit-tested directly.
 */

type SlotState = {
  /** The generation whose value occupies this provider's slot. */
  generation: number
  /** Set between planning a clear and settling it, so a second plan waits. */
  releasing: boolean
}

type SessionSlots = {
  /** The next generation number for this session. Never reused. */
  next: number
  /** Provider to the state of the slot that holds its value. */
  slots: Map<string, SlotState>
}

/**
 * A planned clear. The providers still belong to the planning generation until
 * `settle` runs, so a turn that claims a provider while the clear is in flight
 * keeps that provider, and a second plan for the same generation asks for
 * nothing in the meantime.
 */
export type CredentialReleasePlan = {
  providers: string[]
  settle: () => void
}

const sessions = new Map<string, SessionSlots>()

/**
 * Clears and writes for one session are chained, because the runtime keeps a
 * single value per provider variable. A clear that landed after a newer turn's
 * write would remove the credential that turn is running on, so the two never
 * overlap. Chaining also lets a release read the slots when it runs rather than
 * when it was asked: a turn that already lost its slot to a newer one clears
 * nothing.
 */
const turnQueues = new Map<string, Promise<void>>()

/** Runs one turn's credential work after the session's previous work settled. */
export function runCredentialTurn<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = turnQueues.get(sessionId) ?? Promise.resolve()
  // A turn that failed must not hold up the turns that come after it.
  const result = previous.then(task, task)
  const tail = result.then(
    () => {},
    () => {},
  )
  turnQueues.set(sessionId, tail)
  void tail.then(() => {
    // The last turn to settle clears the entry, so a long-lived app does not
    // keep one promise per session it ever ran.
    if (turnQueues.get(sessionId) === tail) turnQueues.delete(sessionId)
  })
  return result
}

function recordFor(sessionId: string): SessionSlots {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const created: SessionSlots = { next: 1, slots: new Map<string, SlotState>() }
  sessions.set(sessionId, created)
  return created
}

/**
 * Opens a turn's claim on a session and returns its generation. The number is
 * allocated before any key is written, so a key that lands later is recorded
 * against the turn that wrote it even when that turn fails partway.
 */
export function beginCredentialTurn(sessionId: string): number {
  const record = recordFor(sessionId)
  const generation = record.next
  record.next = generation + 1
  return generation
}

/** Records that this turn's value now occupies the provider's slot. */
export function claimCredential(sessionId: string, generation: number, provider: string): void {
  sessions.get(sessionId)?.slots.set(provider, { generation, releasing: false })
}

/**
 * The providers a finishing turn may clear. A provider is clearable only while
 * the slot still holds the value this generation wrote, so a turn that a
 * replacement superseded leaves the newer value alone, a failed handoff clears
 * exactly the keys it managed to write, and a late release cannot clear a slot
 * a newer turn has taken since. Clearing a provider gives up its ownership, so
 * a second release for the same generation asks for nothing.
 */
export function planCredentialRelease(
  sessionId: string,
  generation: number,
  providers: readonly string[],
): CredentialReleasePlan {
  const record = sessions.get(sessionId)
  // No record means the ledger never saw a turn for this session, so the caller
  // is the only writer it knows about and may clear what it wrote.
  if (record === undefined) return { providers: [...providers], settle: () => {} }
  const clearable: string[] = []
  for (const provider of providers) {
    const slot = record.slots.get(provider)
    if (slot?.generation !== generation || slot.releasing) continue
    slot.releasing = true
    clearable.push(provider)
  }
  return {
    providers: clearable,
    settle: () => {
      const current = sessions.get(sessionId)
      if (current === undefined) return
      for (const provider of clearable) {
        // A provider a newer turn claimed during the clear keeps that owner.
        if (current.slots.get(provider)?.generation === generation) {
          current.slots.delete(provider)
        }
      }
    },
  }
}
