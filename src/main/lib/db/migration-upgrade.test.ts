/**
 * Migration upgrade test (roadmap step 07). Builds a database one migration
 * behind the tree, seeds it like a real install, then applies the full
 * migration set the same way the app does at startup. Proves the upgrade is
 * forward-only and non-destructive, and that the interrupted-run case
 * recovers on the upgraded database. FULL-REVIEW section 16 forbids proving
 * an upgrade contract with a fresh database alone.
 */
import { sql } from "drizzle-orm"
import { readMigrationFiles } from "drizzle-orm/migrator"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createRunStore } from "../runs/run-state"
import { migrationsRoot } from "./migrations-path"
import { chats, projects, subChats } from "./schema"
import { migrateTestDb, openTestDb } from "./test-sqlite"

type TestDb = ReturnType<typeof openTestDb>
type MigrationFile = {
  sql: string[]
  folderMillis: number
  hash: string
}

/** The columns of an index, in the order SQLite will use them. */
function indexColumns(opened: TestDb, index: string): string[] {
  const rows = opened.client.prepare(`PRAGMA index_info(${index})`).all() as { name: string }[]
  return rows.map((row) => row.name)
}

function tableExists(opened: TestDb, name: string): boolean {
  const rows = opened.db
    .select({ name: sql<string>`name` })
    .from(sql`sqlite_master` as never)
    .where(sql`type = 'table' AND name = ${name}`)
    .all()
  return rows.length > 0
}

describe("migration upgrade into the run tables", () => {
  let opened: TestDb

  beforeEach(() => {
    opened = openTestDb()
  })

  afterEach(() => {
    opened.client.close()
  })

  it("upgrades a database one migration behind without losing rows", () => {
    const migrations = readMigrationFiles({ migrationsFolder: migrationsRoot }) as MigrationFile[]
    expect(migrations.length).toBeGreaterThanOrEqual(2)
    // Cut immediately before the migration that introduces the run tables, so
    // later migrations do not invalidate this test.
    const runTablesIndex = migrations.findIndex((migration) =>
      migration.sql.some((statement) => statement.includes("CREATE TABLE `runs`")),
    )
    expect(runTablesIndex).toBeGreaterThan(0)
    const behind = migrations.slice(0, runTablesIndex)

    // Apply everything except the newest migration, recording each one the
    // way drizzle's own migrator does.
    opened.client.exec(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)",
    )
    for (const migration of behind) {
      opened.client.exec("BEGIN")
      for (const statement of migration.sql) {
        if (statement.trim()) opened.client.exec(statement)
      }
      opened.db.run(
        sql`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (${migration.hash}, ${migration.folderMillis})`,
      )
      opened.client.exec("COMMIT")
    }
    expect(tableExists(opened, "runs")).toBe(false)

    // Seed like a live install at that version.
    const seededMessages = JSON.stringify([
      { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
    ])
    const project = opened.db
      .insert(projects)
      .values({ name: "upgrade", path: "/tmp/upgrade" })
      .returning()
      .get()
    const chat = opened.db
      .insert(chats)
      .values({ projectId: project.id, name: "c1" })
      .returning()
      .get()
    const subChat = opened.db
      .insert(subChats)
      .values({ chatId: chat.id, messages: seededMessages, provider: "claude-code" })
      .returning()
      .get()

    // The app's startup path, applied to the whole folder.
    migrateTestDb(opened.db, migrationsRoot)

    expect(tableExists(opened, "runs")).toBe(true)
    expect(tableExists(opened, "run_events")).toBe(true)
    expect(tableExists(opened, "queue_items")).toBe(true)

    // The queue's ordering index has to come out of the upgrade in the shape
    // the migration settles on: the composite one, in the order the ordering
    // queries read it. A single-column index would leave every dispatch sorting
    // a table, and an upgrade that produced one would be a regression no other
    // test would notice.
    expect(indexColumns(opened, "queue_items_sub_chat_position_idx")).toEqual([
      "sub_chat_id",
      "position",
      "created_at",
    ])
    // A missing index reports no columns rather than failing, so emptiness is
    // the assertion that the old one was dropped.
    expect(indexColumns(opened, "queue_items_sub_chat_id_idx")).toEqual([])

    const afterUpgrade = opened.db.select().from(subChats).all()
    expect(afterUpgrade).toHaveLength(1)
    expect(afterUpgrade[0].id).toBe(subChat.id)
    expect(afterUpgrade[0].messages).toBe(seededMessages)
    expect(afterUpgrade[0].provider).toBe("claude-code")
    expect(opened.db.select().from(chats).all()[0].id).toBe(chat.id)
    expect(opened.db.select().from(projects).all()[0].path).toBe("/tmp/upgrade")

    // A second migration pass is a no-op.
    expect(() => migrateTestDb(opened.db, migrationsRoot)).not.toThrow()
    expect(opened.db.select().from(subChats).all()).toHaveLength(1)
  })

  it("recovers a run left running by a process kill on the upgraded database", () => {
    migrateTestDb(opened.db, migrationsRoot)
    const project = opened.db
      .insert(projects)
      .values({ name: "p", path: "/tmp/p2" })
      .returning()
      .get()
    const chat = opened.db.insert(chats).values({ projectId: project.id }).returning().get()
    const subChat = opened.db.insert(subChats).values({ chatId: chat.id }).returning().get()

    const store = createRunStore(opened.db)
    const handle = store.startRun({ subChatId: subChat.id, engine: "legacy" })
    handle.noteStarted()
    // Simulate the process dying here: no settle call, no cleanup.

    // Next startup: fresh store over the same database, recovery runs.
    const restarted = createRunStore(opened.db)
    const recovered = restarted.recoverInterrupted()
    expect(recovered).toHaveLength(1)
    expect(recovered[0].id).toBe(handle.runId)

    const after = restarted.getRun(handle.runId)
    expect(after?.run.status).toBe("interrupted")
    expect(after?.run.stopReason).toBe("recovered_at_startup")
    const settled = after?.events.find((event) => event.kind === "settled")
    expect(settled).toBeDefined()
    const payload = JSON.parse(settled?.payload ?? "{}") as { evidence?: { kind: string } }
    expect(payload.evidence?.kind).toBe("started")
  })
})
