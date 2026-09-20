const SECRET_KEYS = new Set([
  "apiKey",
  "oauthToken",
  "token",
  "refreshToken",
  "accessToken",
  "password",
  "secret",
])

export function redactCredentialRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      SECRET_KEYS.has(key) ? "[REDACTED]" : value,
    ]),
  )
}

export function stringifyCredentialRecord(record: Record<string, unknown>): string {
  return JSON.stringify(redactCredentialRecord(record))
}
