/**
 * Source-relative location of the generated migrations. Tests and scripts
 * resolve it from the checkout; the packaged app keeps its own logic in
 * `db/index.ts` because migrations ship under resources/migrations there.
 */
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export const migrationsRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "drizzle",
)
