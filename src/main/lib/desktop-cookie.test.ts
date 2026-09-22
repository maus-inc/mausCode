/**
 * The control-plane cookie writer, tested against a cookie store that records
 * the order of its commands. Every case here is one the reviewers raised on this
 * code while it lived in `index.ts`, where only a running app could exercise it.
 */
import { describe, expect, it } from "vitest"
import { type DesktopCookieStore, DesktopCookieWriter, type SavedSession } from "./desktop-cookie"

const FUTURE = "2030-01-01T00:00:00.000Z"
const PAST = "2020-01-01T00:00:00.000Z"

/** A cookie store that records commands and can be told to refuse a write. */
function fakeStore(options: { refuseSet?: boolean } = {}) {
  const commands: string[] = []
  let refused = options.refuseSet === true
  const store: DesktopCookieStore = {
    async set(token) {
      commands.push(`set:${token}`)
      return !refused
    },
    async remove() {
      commands.push("remove")
    },
  }
  return { store, commands, refuse: (value: boolean) => (refused = value) }
}

/** A saved-session reader whose answer the test changes between steps. */
function session(initial: SavedSession) {
  let current = initial
  return { read: () => current, save: (next: SavedSession) => (current = next) }
}

describe("desktop cookie writer", () => {
  it("writes the cookie for the saved session and reports it belongs", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)

    expect(await writer.write("token-a", FUTURE)).toBe(true)
    expect(commands).toEqual(["remove", "set:token-a"])
  })

  it("reports a refused write instead of claiming the cookie is in place", async () => {
    const { store } = fakeStore({ refuseSet: true })
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)

    expect(await writer.write("token-a", FUTURE)).toBe(false)
  })

  it("takes the cookie back when the session signs out during the write", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)
    const original = store.set.bind(store)
    store.set = async () => {
      // The sign-out lands while the cookie store is accepting the write.
      saved.save({ token: null, expiresAt: null })
      return original("token-a", FUTURE)
    }

    expect(await writer.write("token-a", FUTURE)).toBe(false)
    // The last command is the removal, so no cookie for a session that is gone.
    expect(commands[commands.length - 1]).toBe("remove")
  })

  it("settles on the newer session when a sign-in replaces this one during the write", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)
    const original = store.set.bind(store)
    store.set = async (token, expiresAt) => {
      const written = await original(token, expiresAt)
      // The replacement session is saved while that write is in flight.
      if (token === "token-a") saved.save({ token: "token-b", expiresAt: FUTURE })
      return written
    }

    // The cookie belongs to token-b, not to the session this call was for.
    expect(await writer.write("token-a", FUTURE)).toBe(false)
    expect(commands).toEqual(["remove", "set:token-a", "remove", "set:token-b"])
    expect(commands[commands.length - 1]).toBe("set:token-b")
  })

  it("takes the cookie back when the session keeps changing", async () => {
    const { store, commands } = fakeStore()
    // The store holds "token-a" when the call starts and a different session on
    // every check after that, which is a session that never stops changing.
    let reads = 0
    const saved = {
      read: (): SavedSession => {
        reads += 1
        return { token: reads === 1 ? "token-a" : `token-${reads}`, expiresAt: FUTURE }
      },
    }
    const writer = new DesktopCookieWriter(store, saved.read)

    expect(await writer.write("token-a", FUTURE)).toBe(false)
    // One write for the session this call was for, then one per settle round,
    // and the last command removes the cookie rather than leave a session that
    // may already be gone in place.
    expect(commands.filter((command) => command.startsWith("set:"))).toHaveLength(4)
    expect(commands[commands.length - 1]).toBe("remove")
  })

  it("never stores a token that has already expired", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: PAST })
    const writer = new DesktopCookieWriter(store, saved.read)

    expect(await writer.write("token-a", PAST)).toBe(false)
    expect(commands.filter((command) => command.startsWith("set:"))).toEqual([])
    expect(commands[commands.length - 1]).toBe("remove")
  })

  it("does not write a cookie for a session the store no longer holds", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-b", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)

    expect(await writer.write("token-a", FUTURE)).toBe(false)
    expect(commands).toEqual([])
  })

  it("runs one task at a time, so commands from two writes never interleave", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)
    let inFlight = 0
    let overlapped = false
    const rawSet = store.set.bind(store)
    store.set = async (token, expiresAt) => {
      inFlight += 1
      if (inFlight > 1) overlapped = true
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return rawSet(token, expiresAt)
    }

    const first = writer.write("token-a", FUTURE)
    const second = writer.write("token-a", FUTURE)
    const results = await Promise.all([first, second])

    expect(results).toEqual([true, true])
    expect(overlapped).toBe(false)
    expect(commands.filter((command) => command === "set:token-a")).toHaveLength(2)
  })

  it("removes the cookie through the same queue, so a removal cannot land inside a write", async () => {
    const { store, commands } = fakeStore()
    const saved = session({ token: "token-a", expiresAt: FUTURE })
    const writer = new DesktopCookieWriter(store, saved.read)
    let inFlight = false
    let removalDuringWrite = false
    const rawSet = store.set.bind(store)
    store.set = async (token, expiresAt) => {
      inFlight = true
      await new Promise((resolve) => setTimeout(resolve, 1))
      const written = await rawSet(token, expiresAt)
      inFlight = false
      return written
    }
    const rawRemove = store.remove.bind(store)
    store.remove = async () => {
      if (inFlight) removalDuringWrite = true
      return rawRemove()
    }

    const write = writer.write("token-a", FUTURE)
    const remove = writer.remove()
    await Promise.all([write, remove])

    expect(removalDuringWrite).toBe(false)
    // The removal was queued after the write, so the cookie ends up gone.
    expect(commands[commands.length - 1]).toBe("remove")
  })
})
