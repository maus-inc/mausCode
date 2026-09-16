/**
 * Wipe paths for the chat tree (roadmap step 07). Every table the app
 * creates that hangs off the chat tree is deleted here in foreign-key order,
 * so debug wipes see the run tables too. The delete order is event log,
 * runs, sub-chats, chats, then projects for the full wipe.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

type WipeDb = BetterSQLite3Database<typeof schema>

export function clearChatTree(db: WipeDb): void {
  db.transaction((tx) => {
    tx.delete(schema.runEvents).run()
    tx.delete(schema.runs).run()
    tx.delete(schema.subChats).run()
    tx.delete(schema.chats).run()
  })
}

export function clearAllData(db: WipeDb): void {
  clearChatTree(db)
  db.delete(schema.projects).run()
}
