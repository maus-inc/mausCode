/**
 * Which turn last wrote the in-memory credentials of one native session.
 *
 * The runtime keeps one value per provider variable, and a turn that a
 * replacement superseded can finish after the replacement already applied its
 * keys. Releasing the superseded turn's keys blindly would strip the credential
 * the running turn depends on. The ledger records which generation wrote which
 * providers, so a finishing turn releases only what nothing newer owns. It is
 * pure state with no I/O, so the race is unit-tested directly.
 */

type SessionKeys = {
  generation: number
  providers: Set<string>
}

const sessions = new Map<string, SessionKeys>()

/** Records the providers this turn applied, and returns the turn's generation. */
export function markCredentialsApplied(sessionId: string, providers: readonly string[]): number {
  const generation = (sessions.get(sessionId)?.generation ?? 0) + 1
  sessions.set(sessionId, { generation, providers: new Set(providers) })
  return generation
}

/**
 * The providers a finishing turn may clear. The newest generation clears
 * everything it wrote and ends the session's record. A superseded generation
 * leaves alone every provider the newer generation wrote, because that slot
 * now holds the newer value.
 */
export function planCredentialRelease(
  sessionId: string,
  generation: number,
  providers: readonly string[],
): string[] {
  const current = sessions.get(sessionId)
  if (current === undefined) return [...providers]
  if (current.generation === generation) {
    sessions.delete(sessionId)
    return [...providers]
  }
  return providers.filter((provider) => !current.providers.has(provider))
}
