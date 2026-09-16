/**
 * Test-only SQLite: adapts Node's built-in `node:sqlite` (Node 22) to the
 * surface drizzle's better-sqlite3 session consumes. CI installs with
 * `--ignore-scripts`, so the better-sqlite3 native binding is absent there;
 * this keeps migration and run-state tests on a real SQLite engine anyway.
 *
 * Surface required by drizzle-orm/better-sqlite3 (verified against
 * node_modules/drizzle-orm/better-sqlite3/session.js): prepare() returning
 * run/get/all plus raw() variants, and transaction() returning better-sqlite3
 * style deferred/immediate/exclusive callables.
 */
import { DatabaseSync, type StatementSync } from "node:sqlite"
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema"

type RawStatement = {
  run: (...params: unknown[]) => unknown
  get: (...params: unknown[]) => unknown
  all: (...params: unknown[]) => unknown[]
}

type AdaptedStatement = RawStatement & {
  raw: () => RawStatement
}

type AdaptedClient = {
  prepare: (sql: string) => AdaptedStatement
  exec: (sql: string) => void
  transaction: <T>(fn: (tx: unknown) => T) => TransactionFn<T>
  close: () => void
}

type TransactionFn<T> = ((...args: unknown[]) => T) & {
  deferred: (...args: unknown[]) => T
  immediate: (...args: unknown[]) => T
  exclusive: (...args: unknown[]) => T
}

function rowToArray(row: unknown): unknown[] | undefined {
  if (!row) return undefined
  return Object.values(row as Record<string, unknown>)
}

function adaptStatement(stmt: StatementSync): AdaptedStatement {
  return {
    run: (...params: unknown[]) => stmt.run(...(params as never[])),
    get: (...params: unknown[]) => stmt.get(...(params as never[])),
    all: (...params: unknown[]) => stmt.all(...(params as never[])),
    raw: () => ({
      run: (...params: unknown[]) => stmt.run(...(params as never[])),
      get: (...params: unknown[]) => rowToArray(stmt.get(...(params as never[]))),
      all: (...params: unknown[]) =>
        stmt.all(...(params as never[])).map((row) => rowToArray(row) as unknown[]),
    }),
  }
}

/**
 * Open an in-memory (or file-backed) SQLite database with the full app schema
 * registered. The returned client exposes close() for teardown.
 */
export function openTestDb(path = ":memory:"): {
  db: BetterSQLite3Database<typeof schema>
  client: AdaptedClient
} {
  const sqlite = new DatabaseSync(path)
  sqlite.exec("PRAGMA foreign_keys = ON")

  const client: AdaptedClient = {
    prepare: (sql: string) => adaptStatement(sqlite.prepare(sql)),
    exec: (sql: string) => sqlite.exec(sql),
    transaction: <T>(fn: (tx: unknown) => T): TransactionFn<T> => {
      const runWith =
        (begin: string) =>
        (tx: unknown): T => {
          sqlite.exec(begin)
          try {
            const result = fn(tx)
            sqlite.exec("COMMIT")
            return result
          } catch (error) {
            sqlite.exec("ROLLBACK")
            throw error
          }
        }
      const callable = runWith("BEGIN")
      return Object.assign(callable, {
        deferred: runWith("BEGIN DEFERRED"),
        immediate: runWith("BEGIN IMMEDIATE"),
        exclusive: runWith("BEGIN EXCLUSIVE"),
      })
    },
    close: () => sqlite.close(),
  }

  const db = drizzle(client as never, { schema })
  return { db, client }
}

/**
 * Run every generated migration from drizzle/ against a test database, the
 * same call src/main/lib/db/index.ts makes at startup.
 */
export function migrateTestDb(db: BetterSQLite3Database<typeof schema>, migrationsFolder: string) {
  migrate(db, { migrationsFolder })
}
