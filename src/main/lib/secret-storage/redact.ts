/**
 * Redaction at the log boundary. Any place that writes a record containing a
 * credential passes it through `redactRecord` first, so a token reaches neither
 * a log file nor a console line. The shape of a record is preserved; only the
 * values under credential-looking keys are replaced.
 */

export const REDACTED = "[redacted]"

/**
 * Keys whose values are credentials in this codebase or in a provider payload.
 * A word like `token` covers `accessToken`, `refresh_token` and the rest, so
 * only the compound names that a bare word would miss need their own pattern.
 */
const SECRET_KEY_PATTERNS: readonly RegExp[] = [
  /(api|private)[-_]?key/i,
  /token|secret|password|passwd|credential|authorization|bearer|cookie/i,
]

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key))
}

const MAX_DEPTH = 12

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Returns a copy of the record with credential values replaced. Strings that
 * carry a known prefix are also replaced inside free-form text, so a token in
 * an error message does not survive.
 */
export function redactRecord<T>(value: T, depth = 0): T {
  if (depth > MAX_DEPTH) return REDACTED as unknown as T
  if (typeof value === "string") return redactText(value) as unknown as T
  if (Array.isArray(value))
    return value.map((item) => redactRecord(item, depth + 1)) as unknown as T
  if (!isPlainObject(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    result[key] = isSecretKey(key) ? REDACTED : redactRecord(item, depth + 1)
  }
  return result as T
}

/** Known credential prefixes that must never appear inside a log line. */
const LOCAL_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[\w-]{8,}/g,
  /\bsk-or-[\w-]{8,}/g,
  /\bsk-\w{20,}/g,
  /\bgh[pousr]_\w{16,}/g,
  /\bya29\.[\w-]{8,}/g,
  /\bBearer\s+[\w.~+/-]{12,}=*/gi,
]

export function redactText(text: string): string {
  let redacted = text
  for (const pattern of LOCAL_SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTED)
  return redacted
}

/** Serializes a record for a log sink, redacted. */
export function redactToJson(value: unknown): string {
  return JSON.stringify(redactRecord(value))
}
