/**
 * Run state machine and store tests (roadmap step 07). Runs against a real
 * SQLite database through the node:sqlite adapter, with the generated
 * migrations applied, so schema and machine are tested together.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RUN_EVENT_TEXT_CAP } from "../../../shared/run-state"
import { migrationsRoot } from "../db/migrations-path"
import { chats, projects, runEvents, runs as runsTable, subChats } from "../db/schema"
import { migrateTestDb, openTestDb } from "../db/test-sqlite"
import { createRunStore, RUN_ERROR_TEXT_CAP, type RunFeedItem, type RunStore } from "./run-state"

type TestDb = ReturnType<typeof openTestDb>

function seedSubChat(db: TestDb["db"]): { projectId: string; chatId: string; subChatId: string } {
  const projectId = db
    .insert(projects)
    .values({ name: "p", path: `/p/${Math.random()}` })
    .returning()
    .get().id
  const chatId = db.insert(chats).values({ projectId }).returning().get().id
  const subChatId = db
    .insert(subChats)
    .values({ chatId, provider: "claude-code" })
    .returning()
    .get().id
  return { projectId, chatId, subChatId }
}

describe("run store", () => {
  let opened: TestDb
  let store: RunStore
  let subChatId: string

  beforeEach(() => {
    opened = openTestDb()
    migrateTestDb(opened.db, migrationsRoot)
    store = createRunStore(opened.db)
    subChatId = seedSubChat(opened.db).subChatId
  })

  afterEach(() => {
    opened.client.close()
  })

  describe("startRun", () => {
    it("creates a running row with a created event at seq 1", () => {
      const handle = store.startRun({ subChatId, engine: "legacy", mode: "agent", model: "opus" })
      const run = store.listRuns({ subChatId })[0]
      expect(run.id).toBe(handle.runId)
      expect(run.status).toBe("running")
      expect(run.engine).toBe("legacy")
      expect(run.model).toBe("opus")
      expect(run.lastSeq).toBe(1)

      const withEvents = store.getRun(handle.runId)
      expect(withEvents?.events).toHaveLength(1)
      expect(withEvents?.events[0].kind).toBe("created")
      expect(withEvents?.events[0].seq).toBe(1)
      expect(JSON.parse(withEvents?.events[0].payload ?? "{}")).toMatchObject({
        engine: "legacy",
        mode: "agent",
        model: "opus",
      })
    })

    it("reads the provider from the sub-chat binding", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      expect(store.listRuns({ subChatId })[0].id).toBe(handle.runId)
      expect(store.listRuns({ subChatId })[0].provider).toBe("claude-code")
    })

    it("settles a leftover active run as superseded", () => {
      const first = store.startRun({ subChatId, engine: "legacy" })
      store.startRun({ subChatId, engine: "legacy" })

      const settled = store.getRun(first.runId)
      expect(settled?.run.status).toBe("cancelled")
      expect(settled?.run.stopReason).toBe("superseded")
      const settledEvent = settled?.events.find((event) => event.kind === "settled")
      expect(settledEvent).toBeDefined()

      const active = store.listRuns({ subChatId, activeOnly: true })
      expect(active).toHaveLength(1)
      expect(active[0].id).not.toBe(first.runId)
    })
  })

  describe("transitions", () => {
    it("tracks started, approval requested, approval resolved, and completed", () => {
      const handle = store.startRun({ subChatId, engine: "native" })

      handle.noteStarted()
      expect(store.getRun(handle.runId)?.run.status).toBe("running")

      handle.noteApprovalRequested("Bash")
      let run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("waiting_approval")
      expect(run?.approvalPending).toBe(true)

      handle.noteApprovalResolved(true)
      run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("running")
      expect(run?.approvalPending).toBe(false)

      handle.noteFinished()
      handle.settle()
      run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("completed")
      expect(run?.stopReason).toBe("finished")
      expect(run?.endedAt).toBeInstanceOf(Date)

      const kinds = store.getRun(handle.runId)?.events.map((event) => event.kind)
      expect(kinds).toEqual([
        "created",
        "started",
        "approval_requested",
        "approval_resolved",
        "settled",
      ])
    })

    it("stores approval resolution from the sub-chat path", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteApprovalRequested("Edit")
      expect(store.getRun(handle.runId)?.run.status).toBe("waiting_approval")

      store.resolveApprovalForSubChat(subChatId, false)
      const run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("running")
      const resolved = store
        .getRun(handle.runId)
        ?.events.find((event) => event.kind === "approval_resolved")
      expect(JSON.parse(resolved?.payload ?? "{}")).toEqual({ approved: false })
    })

    it("ignores approval resolution when no run waits", () => {
      store.startRun({ subChatId, engine: "legacy" })
      expect(() => store.resolveApprovalForSubChat(subChatId, true)).not.toThrow()
      expect(store.activeRunForSubChat(subChatId)?.status).toBe("running")
    })

    it("settles error with capped evidence", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteStarted()
      handle.noteError("x".repeat(RUN_ERROR_TEXT_CAP + 100))
      handle.settle(undefined, "turn_failed")

      const run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("error")
      expect(run?.stopReason).toBe("turn_failed")
      const settledEvent = store
        .getRun(handle.runId)
        ?.events.find((event) => event.kind === "settled")
      const payload = JSON.parse(settledEvent?.payload ?? "{}") as { errorText?: string }
      expect(payload.errorText?.length).toBeLessThanOrEqual(RUN_ERROR_TEXT_CAP + 1)
    })

    it("settles error even when the error text is empty", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteError("")
      handle.settle()

      const run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("error")
      const settledEvent = store
        .getRun(handle.runId)
        ?.events.find((event) => event.kind === "settled")
      const payload = JSON.parse(settledEvent?.payload ?? "{}") as { errorText?: string }
      expect(payload.errorText).toBe("unknown error")
    })

    it("settles cancelled on hint", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.settle("cancelled", "user_cancel")
      expect(store.getRun(handle.runId)?.run.status).toBe("cancelled")
      expect(store.getRun(handle.runId)?.run.stopReason).toBe("user_cancel")
    })

    it("falls back to interrupted when nothing was observed", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.settle()
      expect(store.getRun(handle.runId)?.run.status).toBe("interrupted")
    })

    it("is idempotent: a second settle is a no-op", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteFinished()
      handle.settle()
      handle.noteError("late error")
      handle.settle("error")

      const run = store.getRun(handle.runId)?.run
      expect(run?.status).toBe("completed")
      const settledEvents = store
        .getRun(handle.runId)
        ?.events.filter((event) => event.kind === "settled")
      expect(settledEvents).toHaveLength(1)
    })

    it("cancelActiveForSubChat settles the active run only", () => {
      const first = store.startRun({ subChatId, engine: "legacy" })
      first.noteFinished()
      first.settle()
      expect(store.cancelActiveForSubChat(subChatId)).toBe(false)

      const second = store.startRun({ subChatId, engine: "legacy" })
      expect(store.cancelActiveForSubChat(subChatId, "user_cancel")).toBe(true)
      expect(store.getRun(second.runId)?.run.status).toBe("cancelled")
      expect(store.getRun(first.runId)?.run.status).toBe("completed")
    })

    it("keeps seq monotonic across the whole run", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteStarted()
      handle.noteApprovalRequested("Read")
      handle.noteApprovalResolved(true)
      handle.noteFinished()
      handle.settle()

      const events = store.getRun(handle.runId)?.events ?? []
      const seqs = events.map((event) => event.seq)
      expect(seqs).toEqual([1, 2, 3, 4, 5])
      expect(store.getRun(handle.runId)?.run.lastSeq).toBe(5)
    })
  })

  describe("chunk observation", () => {
    it("maps chunk types onto transitions once each", () => {
      const handle = store.startRun({ subChatId, engine: "native" })

      handle.observeChunk({ type: "start" })
      handle.observeChunk({ type: "text-delta" })
      expect(store.getRun(handle.runId)?.events.filter((e) => e.kind === "started")).toHaveLength(1)

      handle.observeChunk({
        type: "ask-user-question",
        toolUseId: "q",
        questions: [{ question: "Allow?", header: "Bash", options: [], multiSelect: false }],
      } as never)
      expect(store.getRun(handle.runId)?.run.status).toBe("waiting_approval")

      handle.observeChunk({ type: "ask-user-question-timeout", toolUseId: "q" } as never)
      expect(store.getRun(handle.runId)?.run.status).toBe("running")

      handle.observeChunk({ type: "error", errorText: "boom" })
      handle.observeChunk({ type: "finish" })
      handle.settle()
      // The error chunk was observed before finish, so error wins.
      expect(store.getRun(handle.runId)?.run.status).toBe("error")
    })

    it("maps auth-error chunks to error evidence", () => {
      const handle = store.startRun({ subChatId, engine: "native" })
      handle.observeChunk({ type: "auth-error", errorText: "NATIVE_NO_CREDENTIALS" })
      handle.settle()
      expect(store.getRun(handle.runId)?.run.status).toBe("error")
    })

    it.each(["legacy", "native"] as const)(
      "records the compacted run event from the %s Compact chunk round-trip",
      (engine) => {
        const handle = store.startRun({ subChatId, engine })
        const compactId = "compact-1726000000"
        // Native starts the tool; legacy only emits tool-input-available.
        handle.observeChunk(
          engine === "native"
            ? { type: "tool-input-start", toolCallId: compactId, toolName: "Compact" }
            : { type: "tool-input-available", toolCallId: compactId, toolName: "Compact" },
        )
        // A different tool's output in between must not match.
        handle.observeChunk({ type: "tool-output-available", toolCallId: "other", output: "x" })
        expect(
          store.getRun(handle.runId)?.events.filter((e) => e.kind === "compacted"),
        ).toHaveLength(0)

        handle.observeChunk({
          type: "tool-output-available",
          toolCallId: compactId,
          output: "done",
        })
        const compacted = store.getRun(handle.runId)?.events.find((e) => e.kind === "compacted")
        expect(compacted).toBeDefined()
        expect(JSON.parse(compacted?.payload ?? "{}")).toEqual({ message: "done" })
        // One compaction, one event: a second output cannot re-record it.
        handle.observeChunk({
          type: "tool-output-available",
          toolCallId: compactId,
          output: "done",
        })
        expect(
          store.getRun(handle.runId)?.events.filter((e) => e.kind === "compacted"),
        ).toHaveLength(1)
      },
    )

    it("does not record compacted when the Compact round-trip errors", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      const compactId = "compact-1726000002"
      handle.observeChunk({
        type: "tool-input-available",
        toolCallId: compactId,
        toolName: "Compact",
      })
      handle.observeChunk({ type: "tool-output-error", toolCallId: compactId, errorText: "oom" })
      expect(store.getRun(handle.runId)?.events.filter((e) => e.kind === "compacted")).toHaveLength(
        0,
      )
    })

    it("records the legacy compact boundary payload shape", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      const compactId = "compact-1726000001"
      handle.observeChunk({
        type: "tool-input-available",
        toolCallId: compactId,
        toolName: "Compact",
        input: { status: "compacting" },
      })
      handle.observeChunk({
        type: "tool-output-available",
        toolCallId: compactId,
        output: { status: "compacted" },
      })
      const compacted = store.getRun(handle.runId)?.events.find((e) => e.kind === "compacted")
      expect(JSON.parse(compacted?.payload ?? "{}")).toEqual({ status: "compacted" })
    })
  })

  describe("harness run events", () => {
    it("appends the event, bumps lastSeq and emits to feed listeners", () => {
      const handle = store.startRun({ subChatId, engine: "native" })
      const seen: RunFeedItem[] = []
      store.subscribe((item) => seen.push(item), { subChatId })

      handle.noteHarnessEvent("wake_requested", {
        session_id: "daemon-1",
        reason: "background_task",
        notification: "build finished",
      })

      const stored = store.getRun(handle.runId)
      const event = stored?.events.find((e) => e.kind === "wake_requested")
      expect(event).toBeDefined()
      expect(event?.seq).toBe(stored?.run.lastSeq ?? 0)
      expect(JSON.parse(event?.payload ?? "{}")).toEqual({
        session_id: "daemon-1",
        reason: "background_task",
        notification: "build finished",
      })
      expect(seen.some((item) => item.event?.kind === "wake_requested")).toBe(true)
      // Record-only: no status change.
      expect(store.getRun(handle.runId)?.run.status).toBe("running")
    })

    it(`caps string payload fields to RUN_EVENT_TEXT_CAP plus the ellipsis marker`, () => {
      const handle = store.startRun({ subChatId, engine: "native" })
      const long = "x".repeat(RUN_EVENT_TEXT_CAP + 50)

      handle.noteHarnessEvent("background_progress", {
        session_id: "s",
        task_id: "t1",
        label: "tests",
        summary: long,
      })

      const stored = store.getRun(handle.runId)
      const event = stored?.events.find((e) => e.kind === "background_progress")
      const payload = JSON.parse(event?.payload ?? "{}") as { summary: string }
      // Repo cap convention: slice to the cap, then one ellipsis character.
      expect(payload.summary).toHaveLength(RUN_EVENT_TEXT_CAP + 1)
      expect(payload.summary.endsWith("…")).toBe(true)
    })

    it("ignores harness events on a settled run", () => {
      const handle = store.startRun({ subChatId, engine: "native" })
      handle.settle()
      const before = store.getRun(handle.runId)?.run.lastSeq

      handle.noteHarnessEvent("session_status", { session_id: "s", status: "idle" })

      expect(store.getRun(handle.runId)?.run.lastSeq).toBe(before)
    })
  })

  describe("cursor replay", () => {
    it("returns only events after the cursor", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteStarted()
      handle.noteApprovalRequested("Bash")

      const afterOne = store.getRun(handle.runId, 1)
      expect(afterOne?.events.map((event) => event.seq)).toEqual([2, 3])

      const afterAll = store.getRun(handle.runId, 3)
      expect(afterAll?.events).toHaveLength(0)
      expect(afterAll?.run.id).toBe(handle.runId)
    })

    it("returns null for an unknown run", () => {
      expect(store.getRun("missing")).toBeNull()
    })
  })

  describe("subscribe", () => {
    it("delivers live transitions to every subscriber", () => {
      const first: RunFeedItem[] = []
      const second: RunFeedItem[] = []
      const stopFirst = store.subscribe((item) => first.push(item))
      const stopSecond = store.subscribe((item) => second.push(item))

      const handle = store.startRun({ subChatId, engine: "legacy" })
      handle.noteFinished()
      handle.settle()

      expect(first.length).toBeGreaterThan(0)
      expect(first).toEqual(second)
      const settledItem = first.find((item) => item.event?.kind === "settled")
      expect(settledItem?.run.status).toBe("completed")

      stopFirst()
      stopSecond()
    })

    it("filters by sub-chat", () => {
      const other = seedSubChat(opened.db).subChatId
      const seen: RunFeedItem[] = []
      const stop = store.subscribe((item) => seen.push(item), { subChatId })

      store.startRun({ subChatId: other, engine: "legacy" })
      store.startRun({ subChatId, engine: "legacy" })

      expect(seen).toHaveLength(1)
      expect(seen[0].run.subChatId).toBe(subChatId)
      stop()
    })

    it("survives a throwing listener", () => {
      const seen: RunFeedItem[] = []
      const stopBroken = store.subscribe(() => {
        throw new Error("listener bug")
      })
      const stopOk = store.subscribe((item) => seen.push(item))

      store.startRun({ subChatId, engine: "legacy" })
      expect(seen).toHaveLength(1)
      stopBroken()
      stopOk()
    })
  })

  describe("recoverInterrupted", () => {
    it("moves active runs to interrupted with the last event as evidence", () => {
      const running = store.startRun({ subChatId, engine: "legacy" })
      running.noteStarted()
      const waitingHandle = store.startRun({
        subChatId: seedSubChat(opened.db).subChatId,
        engine: "native",
      })
      waitingHandle.noteApprovalRequested("Bash")

      const done = store.startRun({ subChatId: seedSubChat(opened.db).subChatId, engine: "legacy" })
      done.noteFinished()
      done.settle()

      const recovered = store.recoverInterrupted()
      expect(recovered.map((run) => run.id).sort()).toEqual(
        [running.runId, waitingHandle.runId].sort(),
      )

      const after = store.getRun(running.runId)
      expect(after?.run.status).toBe("interrupted")
      expect(after?.run.stopReason).toBe("recovered_at_startup")
      const settledEvent = after?.events.find((event) => event.kind === "settled")
      const payload = JSON.parse(settledEvent?.payload ?? "{}") as {
        evidence?: { kind: string; seq: number }
      }
      expect(payload.evidence?.kind).toBe("started")
      expect(payload.evidence?.seq).toBe(2)

      // Terminal runs are untouched.
      expect(store.getRun(done.runId)?.run.status).toBe("completed")
      // A second recovery finds nothing.
      expect(store.recoverInterrupted()).toHaveLength(0)
    })
  })

  describe("queries", () => {
    it("activeRunChatIds maps runs back to their chats", () => {
      const seeded = seedSubChat(opened.db)
      store.startRun({ subChatId: seeded.subChatId, engine: "legacy" })

      const ids = store.activeRunChatIds([seeded.chatId, "no-such-chat"])
      expect(ids.has(seeded.chatId)).toBe(true)
      expect(ids.size).toBe(1)
    })

    it("latestRunBySubChat picks the newest run per sub-chat", () => {
      // Enough settled runs that a query returning the whole history would be
      // visibly wasteful; the result must still be exactly the newest one.
      // These all start within one timestamp tick, which is the case the
      // insertion-order tie-break exists for.
      for (let i = 0; i < 10; i++) {
        const done = store.startRun({ subChatId, engine: "legacy" })
        done.noteFinished()
        done.settle()
      }
      const newest = store.startRun({ subChatId, engine: "legacy" })

      const map = store.latestRunBySubChat([subChatId])
      expect(map.size).toBe(1)
      expect(map.get(subChatId)?.id).toBe(newest.runId)
    })

    it("listRuns agrees with latestRunBySubChat on same-timestamp runs", () => {
      // Replay (listRuns) and chat hydration (latestRunBySubChat) must pick
      // the identical newest run even when every run shares one timestamp
      // tick, or two windows would disagree on which run is current.
      for (let i = 0; i < 10; i++) {
        const done = store.startRun({ subChatId, engine: "legacy" })
        done.noteFinished()
        done.settle()
      }
      const newest = store.startRun({ subChatId, engine: "legacy" })

      expect(store.listRuns({ subChatId, limit: 1 })[0]?.id).toBe(newest.runId)
      expect(store.listRuns({ subChatId, limit: 1 })[0]?.id).toBe(
        store.latestRunBySubChat([subChatId]).get(subChatId)?.id,
      )
    })

    it("cancelActiveRuns settles every active run and emits each one", () => {
      // One active run per sub-chat: a second send on the same sub-chat
      // supersedes the first, so distinct sub-chats exercise the sweep.
      const secondSubChat = seedSubChat(opened.db).subChatId
      const thirdSubChat = seedSubChat(opened.db).subChatId
      store.startRun({ subChatId, engine: "legacy" })
      store.startRun({ subChatId: secondSubChat, engine: "native" })
      store.startRun({ subChatId: thirdSubChat, engine: "legacy" })
      const done = store.startRun({ subChatId: seedSubChat(opened.db).subChatId, engine: "legacy" })
      done.noteFinished()
      done.settle()

      const seen: RunFeedItem[] = []
      const unsubscribe = store.subscribe((item) => seen.push(item))
      const count = store.cancelActiveRuns("wiped")
      unsubscribe()

      expect(count).toBe(3)
      expect(seen.map((item) => item.run.status)).toEqual(["cancelled", "cancelled", "cancelled"])
      expect(store.activeRuns()).toHaveLength(0)
      expect(store.getRun(done.runId)?.run.status).toBe("completed")
    })

    it("listRuns honors activeOnly and limit", () => {
      for (let i = 0; i < 3; i++) {
        const handle = store.startRun({ subChatId, engine: "legacy" })
        handle.noteFinished()
        handle.settle()
      }
      store.startRun({ subChatId, engine: "legacy" })

      expect(store.listRuns({ subChatId })).toHaveLength(4)
      expect(store.listRuns({ subChatId, activeOnly: true })).toHaveLength(1)
      expect(store.listRuns({ subChatId, limit: 2 })).toHaveLength(2)
    })
  })

  describe("failure isolation", () => {
    it("a dead database makes handle calls log, not throw", () => {
      const handle = store.startRun({ subChatId, engine: "legacy" })
      opened.client.close()
      expect(() => handle.noteStarted()).not.toThrow()
      expect(() => handle.settle()).not.toThrow()
      opened = openTestDb() // keep afterEach close() valid
    })

    it("settle can retry after its transaction fails", () => {
      let failNextTransaction = false
      const proxied = new Proxy(opened.db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver)
          if (prop === "transaction" && failNextTransaction) {
            failNextTransaction = false
            return () => {
              throw new Error("disk full")
            }
          }
          return value
        },
      })
      const proxyStore = createRunStore(proxied)
      const handle = proxyStore.startRun({ subChatId, engine: "legacy" })

      failNextTransaction = true
      handle.settle()
      expect(proxyStore.activeRunForSubChat(subChatId)?.id).toBe(handle.runId)

      handle.settle()
      expect(proxyStore.getRun(handle.runId)?.run.status).toBe("interrupted")
      expect(proxyStore.activeRunForSubChat(subChatId)).toBeNull()
    })
  })

  it("writes run rows the schema declares", () => {
    const handle = store.startRun({ subChatId, engine: "legacy" })
    const rows = opened.db.select().from(runsTable).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(handle.runId)
    const events = opened.db.select().from(runEvents).all()
    expect(events).toHaveLength(1)
  })
})
