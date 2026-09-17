/**
 * Fixtures shared by the main-process database tests: every store here seeds
 * the same project → chat → sub-chat chain against a database that has the
 * generated migrations applied. Kept in one place so each test file states its
 * own subject instead of repeating the setup (and so the duplication Sonar
 * measures across those files has a single home).
 */
import { migrationsRoot } from "./migrations-path"
import { chats, projects, subChats } from "./schema"
import { migrateTestDb, openTestDb } from "./test-sqlite"

export type TestDb = ReturnType<typeof openTestDb>

/** An open database with the generated migrations applied. */
export function openMigratedTestDb(path?: string): TestDb {
  const opened = openTestDb(path)
  migrateTestDb(opened.db, migrationsRoot)
  return opened
}

/** Counts the projects this helper has inserted, so each gets its own path. */
let seededProjects = 0

/**
 * Insert a project, a chat and a sub-chat, and answer the sub-chat's id. The
 * per-call project path keeps two calls in one database from colliding.
 */
export function seedSubChat(db: TestDb["db"]): string {
  seededProjects += 1
  const project = db
    .insert(projects)
    .values({ name: "p", path: `/p/${seededProjects}` })
    .returning()
    .get()
  const chat = db.insert(chats).values({ projectId: project.id }).returning().get()
  return db.insert(subChats).values({ chatId: chat.id }).returning().get().id
}
