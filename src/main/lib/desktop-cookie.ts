/**
 * The control-plane token cookie, kept in step with the saved session.
 *
 * A sign-out or a sign-in as another account can land while a cookie write is in
 * flight, and no check before the write can see that. This writer therefore
 * settles every write against the saved session: it writes the cookie for
 * whatever session is saved now, checks again, and repeats. A session that keeps
 * changing takes the cookie back rather than leave one that may belong to an
 * account the app has left.
 *
 * Writes, checks and removals run one task at a time, because two of them
 * interleaving their remove and set would leave whichever command the cookie
 * store ran last, which is not necessarily the session that is saved.
 *
 * No Electron import, so the ordering rules are unit-tested with an injected
 * cookie store.
 */

/** The cookie store, as much of it as this writer uses. */
export type DesktopCookieStore = {
  /** Resolves false when the store refused the write. */
  set(token: string, expiresAt: string): Promise<boolean>
  remove(): Promise<void>
}

/**
 * What the session store holds right now. Read on every check, because a
 * sign-out or a newer sign-in changes it while a write is in flight.
 */
export type SavedSession = { token: string | null; expiresAt: string | null }

/** How many times a write may chase a session change before giving up. */
const SETTLE_ROUNDS = 3

export class DesktopCookieWriter {
  private tasks: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly store: DesktopCookieStore,
    private readonly savedSession: () => SavedSession,
  ) {}

  /**
   * Writes the cookie for the session that is saved right now. Resolves whether
   * the cookie in place belongs to that session.
   */
  write(token: string, expiresAt: string): Promise<boolean> {
    return this.enqueue(() => this.writeSettled(token, expiresAt))
  }

  /** Drops the cookie. Called when a session this run cannot use was found. */
  remove(): Promise<void> {
    return this.enqueue(() => this.store.remove())
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tasks.then(task, task)
    this.tasks = result.then(
      () => {},
      () => {},
    )
    return result
  }

  private async writeSettled(token: string, expiresAt: string): Promise<boolean> {
    if (this.savedSession().token !== token) return false
    await this.store.remove()
    // The store can refuse the write. Reporting success after that would tell
    // the caller an authenticated cookie is in place when none is.
    if (!(await this.writeOne(token, expiresAt))) return false
    let written = token
    for (let round = 0; round < SETTLE_ROUNDS; round += 1) {
      const saved = this.savedSession()
      if (saved.token === written) return written === token
      await this.store.remove()
      if (saved.token === null || saved.expiresAt === null) return false
      if (!(await this.writeOne(saved.token, saved.expiresAt))) return false
      written = saved.token
    }
    if (this.savedSession().token !== written) await this.store.remove()
    return false
  }

  /**
   * One write. A token that has already expired is not stored, and the cookie
   * an earlier version wrote with an expiry goes with it.
   */
  private async writeOne(token: string, expiresAt: string): Promise<boolean> {
    const expiry = new Date(expiresAt).getTime()
    if (Number.isFinite(expiry) && expiry <= Date.now()) {
      await this.store.remove()
      return false
    }
    return this.store.set(token, expiresAt)
  }
}
