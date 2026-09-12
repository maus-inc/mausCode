/**
 * Native-engine endpoint settings: DB accessors over `endpoint-urls` pure logic.
 */
import { eq } from "drizzle-orm"
import { getDatabase, nativeEndpointSettings } from "../db"
import type { NativeEndpoints } from "./endpoint-urls"

export type { NativeEndpoints } from "./endpoint-urls"
export {
  buildDaemonEndpointEnv,
  endpointMatches,
  isHonoredEndpoint,
  normalizeEndpointUrl,
  probeEndpoint,
} from "./endpoint-urls"

export function readEndpointSettings(): NativeEndpoints {
  const db = getDatabase()
  const row = db
    .select()
    .from(nativeEndpointSettings)
    .where(eq(nativeEndpointSettings.id, "singleton"))
    .get()
  return {
    openaiBaseUrl: row?.openaiBaseUrl ?? null,
    anthropicBaseUrl: row?.anthropicBaseUrl ?? null,
  }
}

export function writeEndpointSettings(settings: NativeEndpoints): void {
  const db = getDatabase()
  db.insert(nativeEndpointSettings)
    .values({
      id: "singleton",
      openaiBaseUrl: settings.openaiBaseUrl,
      anthropicBaseUrl: settings.anthropicBaseUrl,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: nativeEndpointSettings.id,
      set: {
        openaiBaseUrl: settings.openaiBaseUrl,
        anthropicBaseUrl: settings.anthropicBaseUrl,
        updatedAt: new Date(),
      },
    })
    .run()
}
