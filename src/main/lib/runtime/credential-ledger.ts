/**
 * Which turn owns the in-memory credentials of one native session.
 *
 * The runtime keeps one value per provider variable, and a turn that a
 * replacement superseded can finish after the replacement already applied its
 * keys. Releasing the superseded turn's keys blindly would strip the credential
 * the running turn depends on, so ownership is recorded per provider: a turn
 * clears a provider only while that slot still holds the value this turn wrote.
 *
 * A generation number is allocated before the first key is written and is never
 * reused for a session, so a straggler from an older turn can never be mistaken
 * for the live one, even after the live turn released its keys. It is pure
 * state with no I/O, so the race is unit-tested directly.
 */

type SessionOwners = {
  /** The next generation number for this session. Never reused. */
  next: number
  /** Provider to the generation whose value currently occupies that slot. */
  owners: Map<string, number>
}

const sessions = new Map<string, SessionOwners>()

function recordFor(sessionId: string): SessionOwners {
  const existing = sessions.get(sessionId)
  if (existing) return existing
  const created: SessionOwners = { next: 1, owners: new Map<string, number>() }
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
  sessions.get(sessionId)?.owners.set(provider, generation)
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
): string[] {
  const record = sessions.get(sessionId)
  // No record means the ledger never saw a turn for this session, so the caller
  // is the only writer it knows about and may clear what it wrote.
  if (record === undefined) return [...providers]
  const clearable: string[] = []
  for (const provider of providers) {
    if (record.owners.get(provider) !== generation) continue
    record.owners.delete(provider)
    clearable.push(provider)
  }
  return clearable
}
