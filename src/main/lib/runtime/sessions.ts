/**
 * Native session mapping: mausCode subChat <-> daemon-owned JCode session.
 *
 * The daemon owns transcripts; the app persists only the id mapping in
 * `subChats.sessionId` (same column the legacy path uses for SDK resume keys,
 * now holding JCode session ids for native sub-chats). Stale mappings
 * (daemon state wiped) self-heal by creating a fresh session.
 */
import { eq } from "drizzle-orm"
import type { JcodeClient } from "@maus-inc/runtime-client"
import { getDatabase, subChats } from "../db"

function readMapping(subChatId: string): string | null {
  const db = getDatabase()
  const row = db
    .select({ sessionId: subChats.sessionId })
    .from(subChats)
    .where(eq(subChats.id, subChatId))
    .get()
  return row?.sessionId ?? null
}

function writeMapping(subChatId: string, sessionId: string): void {
  const db = getDatabase()
  db.update(subChats).set({ sessionId }).where(eq(subChats.id, subChatId)).run()
}

function isUnknownSession(error: unknown): boolean {
  // HarnessError carries `.code`; fall back to message matching for safety.
  const code = (error as { code?: string } | null)?.code
  if (code === "unknown_session") return true
  return error instanceof Error && error.message.includes("unknown_session")
}

/**
 * Attach to the mapped daemon session, creating one (in `cwd`) when the
 * mapping is missing or stale. Returns the JCode session id.
 */
export async function ensureNativeSession(
  client: JcodeClient,
  subChatId: string,
  cwd: string,
): Promise<string> {
  const mapped = readMapping(subChatId)
  if (mapped) {
    try {
      const info = await client.attachSession(mapped)
      return info.session_id
    } catch (error) {
      if (!isUnknownSession(error)) throw error
      // Stale mapping: fall through and create.
    }
  }
  const created = await client.createSession(cwd)
  writeMapping(subChatId, created.session_id)
  return created.session_id
}

/** Resolve the mapped session without creating; null when unmapped. */
export function getMappedNativeSession(subChatId: string): string | null {
  return readMapping(subChatId)
}
