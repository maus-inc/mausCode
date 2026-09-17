/**
 * Ambient types for Node's built-in `node:sqlite` module, used by the
 * test-only adapter in `src/main/lib/db/test-sqlite.ts`. The pinned
 * @types/node 20.x does not ship them yet, and the dependency step (roadmap
 * step 12) owns @types/node upgrades. Covers only the surface the adapter
 * uses.
 */
declare module "node:sqlite" {
  export interface StatementResult {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export class StatementSync {
    run(...params: unknown[]): StatementResult
    get(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }

  export class DatabaseSync {
    constructor(path: string)
    prepare(sql: string): StatementSync
    exec(sql: string): void
    close(): void
  }
}
