/**
 * Wipe registration test (roadmap step 07). Seeds the tables the live schema
 * declares, runs the wipe paths, and asserts every table that hangs off the
 * chat tree by foreign key is empty. The table set comes from walking the
 * schema, not from a copied list, so a new table with a chat-tree foreign
 * key fails here until it joins the wipe order.
 */
import { is, sql } from "drizzle-orm"
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { migrationsRoot } from "./migrations-path"
import * as schema from "./schema"
import { migrateTestDb, openTestDb } from "./test-sqlite"
import { clearAllData, clearChatTree } from "./wipe"

type TestDb = ReturnType<typeof openTestDb>

function allTables(): SQLiteTable[] {
  // The is() runtime check guards the cast: schema exports tables, relations
  // and types together.
  const tables: SQLiteTable[] = []
  for (const value of Object.values(schema)) {
    if (is(value as object, SQLiteTable)) {
      tables.push(value as SQLiteTable)
    }
  }
  return tables
}

function tableName(table: SQLiteTable): string {
  return getTableConfig(table).name
}

/** Table names that reference chats, directly or transitively. */
function chatTreeTables(): Set<string> {
  const tables = allTables()
  const inTree = new Set(["chats"])

  let grew = true
  while (grew) {
    grew = false
    for (const table of tables) {
      const name = tableName(table)
      if (inTree.has(name)) continue
      const referencesTree = getTableConfig(table).foreignKeys.some((foreignKey) => {
        try {
          return inTree.has(tableName(foreignKey.reference().foreignTable as SQLiteTable))
        } catch {
          return false
        }
      })
      if (referencesTree) {
        inTree.add(name)
        grew = true
      }
    }
  }
  return inTree
}

function rowCount(db: TestDb["db"], name: string): number {
  const rows = db
    .select({ n: sql<number>`count(*)` })
    .from(sql.identifier(name) as unknown as SQLiteTable)
    .all()
  return Number(rows[0]?.n ?? 0)
}

function seed(db: TestDb["db"]): void {
  const project = db.insert(schema.projects).values({ name: "p", path: "/tmp/p" }).returning().get()
  const chat = db.insert(schema.chats).values({ projectId: project.id }).returning().get()
  const subChat = db.insert(schema.subChats).values({ chatId: chat.id }).returning().get()
  const run = db
    .insert(schema.runs)
    .values({ subChatId: subChat.id, engine: "legacy" })
    .returning()
    .get()
  db.insert(schema.runEvents).values({ runId: run.id, seq: 1, kind: "created" }).run()
  db.insert(schema.queueItems).values({ subChatId: subChat.id, position: 0 }).run()
  db.insert(schema.anthropicAccounts).values({ oauthToken: "secret" }).run()
}

describe("wipe paths", () => {
  let opened: TestDb

  beforeEach(() => {
    opened = openTestDb()
    migrateTestDb(opened.db, migrationsRoot)
  })

  afterEach(() => {
    opened.client.close()
  })

  it("the live schema declares the run tables", () => {
    const names = allTables().map((table) => tableName(table))
    expect(names).toContain("runs")
    expect(names).toContain("run_events")
  })

  it("clearChatTree empties every chat-tree table and keeps the rest", () => {
    seed(opened.db)

    // The walk below asserts emptiness, so the table this step added has to be
    // filled first: an empty table reads as empty whether or not it is wiped.
    const tree = chatTreeTables()
    expect(tree).toContain("runs")
    expect(tree).toContain("run_events")
    expect(tree).toContain("sub_chats")
    expect(tree).toContain("queue_items")
    expect(rowCount(opened.db, "queue_items")).toBe(1)

    clearChatTree(opened.db)

    for (const tableName of tree) {
      expect(rowCount(opened.db, tableName), tableName).toBe(0)
    }

    expect(rowCount(opened.db, "projects")).toBe(1)
    expect(rowCount(opened.db, "anthropic_accounts")).toBe(1)
  })

  it("empties every chat-tree table even when the cascade cannot do it for it", () => {
    // Foreign keys are off for this one on purpose. The wipe deletes in
    // foreign-key order itself, exactly so its guarantee does not rest on the
    // pragma: a dropped cascade, or a handle opened without it, would otherwise
    // leave a deleted chat's rows behind. With the pragma on, the cascade
    // empties those tables anyway and makes every explicit delete in the wipe
    // unfalsifiable.
    opened.client.exec("PRAGMA foreign_keys = OFF")
    seed(opened.db)

    clearChatTree(opened.db)

    for (const tableName of chatTreeTables()) {
      expect(rowCount(opened.db, tableName), tableName).toBe(0)
    }
    expect(rowCount(opened.db, "projects")).toBe(1)
  })

  it("clearAllData also empties projects", () => {
    seed(opened.db)
    clearAllData(opened.db)

    for (const tableName of chatTreeTables()) {
      expect(rowCount(opened.db, tableName), tableName).toBe(0)
    }
    expect(rowCount(opened.db, "projects")).toBe(0)
    expect(rowCount(opened.db, "anthropic_accounts")).toBe(1)
  })
})
