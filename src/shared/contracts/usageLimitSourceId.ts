/**
 * Ported from pingdotgg/t3code packages/contracts (MIT, (c) 2026 T3 Tools Inc.).
 * T3 product identifiers kept verbatim so ported tests stay faithful; see README.md.
 */
import * as Schema from "effect/Schema"

/**
 * Key of one `settings.usageLimitSources` entry. Lives in its own module so
 * both the settings and the usage-limit contracts can import it without
 * importing each other.
 */
export const UsageLimitSourceId = Schema.String.pipe(Schema.brand("UsageLimitSourceId"))
export type UsageLimitSourceId = typeof UsageLimitSourceId.Type
