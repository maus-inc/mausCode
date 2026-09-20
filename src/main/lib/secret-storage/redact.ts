/**
 * Redaction at the log boundary. Any place that writes a record containing a
 * credential passes it through `redactRecord` first, so a token reaches neither
 * a log file nor a console line. The shape of a record is preserved; only the
 * values under credential-looking keys are replaced.
 */

export const REDACTED = "[redacted]"

/** Keys whose values are credentials in this codebase or in a provider payload. */
const SECRET_KEY_PATTERN =
  /(api[-_]?key|access[-_]?token|refresh[-_]?token|oauth[-_]?token|id[-_]?token|auth[-_]?token|token|secret|password|passwd|credential|authorization|bearer|cookie|private[-_]?key|client[-_]?secret)/i

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
    result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redactRecord(item, depth + 1)
  }
  return result as T
}

/** Known credential prefixes that must never appear inside a log line. */
const LOCAL_SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-ant-[A-Za-z0-9\-_]{8,}/g,
  /\bsk-or-[A-Za-z0-9\-_]{8,}/g,
  /\bsk-[A-Za-z0-9]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bya29\.[A-Za-z0-9\-_]{8,}/g,
  /\bBearer\s+[A-Za-z0-9\-._~+/]{12,}=*/gi,
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
