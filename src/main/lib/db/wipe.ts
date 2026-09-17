/**
 * Wipe paths for the chat tree (roadmap step 07). Every table the app
 * creates that hangs off the chat tree is deleted here in foreign-key order,
 * so debug wipes see the run tables too. Each wipe is one transaction: a
 * crash mid-wipe must never leave a half-deleted database.
 */
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3"
import * as schema from "./schema"

type WipeDb = BetterSQLite3Database<typeof schema>
type WipeTx = WipeDb["transaction"] extends (fn: (tx: infer T) => unknown) => unknown ? T : never

function clearChatTreeTx(tx: WipeTx): void {
  tx.delete(schema.runEvents).run()
  tx.delete(schema.runs).run()
  tx.delete(schema.subChats).run()
  tx.delete(schema.chats).run()
}

export function clearChatTree(db: WipeDb): void {
  db.transaction(clearChatTreeTx)
}

export function clearAllData(db: WipeDb): void {
  db.transaction((tx) => {
    clearChatTreeTx(tx)
    tx.delete(schema.projects).run()
  })
}
