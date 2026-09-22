import { pluralize } from "../../../lib/utils/pluralize"

/**
 * What the credential storage page says, kept apart from how it looks.
 *
 * Every sentence and every pill on that page is a claim about the app's state,
 * and the claim must not outrun what the main process confirmed. The rules are
 * here so they are unit-tested, because the page itself needs a running app with
 * a keyring to render.
 */

/**
 * What the page reads from the status query. The assignment in the page is a
 * compile-time check: a field the router stops returning fails there.
 */
export type StatusData = {
  protection: "os-encryption" | "hardcoded-key" | "plaintext"
  encryptionAvailable: boolean
  plaintextConsent: boolean
  plaintextConsentAt?: string | null
  reason: string
  backend: string | null
  metadataError: string | null
  signInFailure: string | null
  providerReadErrors: { provider: string; error: string }[]
  rendererError: string | null
  rendererKeysStored: string[]
}

/** One pill for every row: the tone names the state, the label names it in words. */
export type RowState = { tone: "ok" | "warn" | "bad" | "mute"; label: string }

/**
 * What a row says before the status query answers. The flags the rows read are
 * false without data, and a row that stated a verdict from those would report a
 * refusal the app has not made.
 */
export const UNKNOWN_STATE: RowState = { tone: "warn", label: "Unknown" }
export const UNKNOWN_DETAIL = "Reading the storage state from the main process."

export type ProtectionVerdict = {
  /** True while the status query has no result or failed, so no verdict is stated. */
  unknown: boolean
  protectedByOs: boolean
  consentOn: boolean
}

/**
 * The three flags the page states its verdicts from.
 *
 * A query that failed leaves the previous answer in the React Query cache, and
 * presenting that as the current state would report a keyring decision the app
 * cannot stand behind now, next to the error that says the read failed. So a
 * failed query leaves the two verdict flags false and the page says the state is
 * not known.
 */
export function protectionVerdict(
  data: StatusData | undefined,
  queryError: unknown,
): ProtectionVerdict {
  const unknown = data === undefined || queryError !== null
  return {
    unknown,
    protectedByOs:
      !unknown && data?.protection === "os-encryption" && data.encryptionAvailable === true,
    consentOn: !unknown && data?.plaintextConsent === true,
  }
}

export function protectionHeadline(isLoading: boolean, verdict: ProtectionVerdict): string {
  if (isLoading) return "Checking the OS keyring..."
  // A query that has not answered, or one that failed, says nothing about the
  // keyring. Claiming it cannot encrypt would state a verdict the app has not
  // reached.
  if (verdict.unknown) return "The OS keyring state is not known"
  if (verdict.protectedByOs) return "New credentials are encrypted by the operating system"
  if (verdict.consentOn) return "New credentials are stored in plaintext because you allowed it"
  return "The operating system cannot encrypt new credentials"
}

/**
 * The sentence under the headline. Nothing is said about protection until the
 * main process has answered, because a refusal reason shown while the query is
 * still running reads as a verdict the app has not reached yet.
 */
export function protectionDetail(
  isLoading: boolean,
  verdict: ProtectionVerdict,
  loadError: string | null,
  data: StatusData | undefined,
): string {
  if (loadError) return loadError
  if (isLoading || verdict.unknown || data === undefined) {
    return "Reading the protection state from the main process."
  }
  if (verdict.protectedByOs) {
    return "The app writes sign-in tokens and provider keys through the OS keyring. Existing credentials keep working."
  }
  return describeRefusal(data.reason, data.backend, data.metadataError ?? null)
}

/**
 * The state of the next write, not a claim about what is already saved: the
 * main process reports stored read errors rather than a protection level per
 * file, and a value written before this policy existed keeps working.
 *
 * `failureLabel` names the failure for the row it belongs to. The provider rows
 * only report read errors, while the sign-in row reports anything the session
 * store last refused or failed to do, a refused save included, so calling that
 * one unreadable would name the wrong problem.
 */
export function storedState(
  verdict: ProtectionVerdict,
  error: string | null,
  failureLabel: string,
): RowState {
  if (error) return { tone: "bad", label: failureLabel }
  if (verdict.unknown) return UNKNOWN_STATE
  if (verdict.protectedByOs) return { tone: "ok", label: "New: encrypted" }
  return verdict.consentOn
    ? { tone: "warn", label: "New: plaintext" }
    : { tone: "warn", label: "New: refused" }
}

export function browserState(error: string | null, stored: number): RowState {
  if (error) return { tone: "bad", label: "Unreadable" }
  // The app store holds whatever was saved there, migrated or written directly,
  // so the pill names the location rather than how the value arrived.
  return stored > 0 ? { tone: "ok", label: "Saved here" } : { tone: "mute", label: "Nothing saved" }
}

/**
 * The row that reports the app's own store.
 *
 * A failed status query leaves the previous answer in the cache, so the row
 * reads its count and its error only from a status the main process confirmed.
 * Without that gate a stale count would draw a pill about a store the page has
 * just said it cannot read.
 */
export function browserRow(
  data: StatusData | undefined,
  verdict: ProtectionVerdict,
): { detail: string; state: RowState } {
  if (verdict.unknown) return { detail: UNKNOWN_DETAIL, state: UNKNOWN_STATE }
  const stored = data?.rendererKeysStored?.length ?? 0
  const error = data?.rendererError ?? null
  return { detail: describeRendererStorage(error, stored), state: browserState(error, stored) }
}

export function describeRendererStorage(error: string | null, stored: number): string {
  if (error) return error
  if (stored > 0) {
    const values = pluralize(stored, "provider value")
    const verb = stored === 1 ? "is" : "are"
    return `${stored} ${values} ${verb} saved in this app's store, which is not browser storage`
  }
  return "No provider value is saved in this app's store"
}

export function storedDetail(
  verdict: ProtectionVerdict,
  encrypted: string,
  allowed: string,
  refused: string,
): string {
  if (verdict.protectedByOs) return encrypted
  return verdict.consentOn ? allowed : refused
}

export function describeRefusal(
  reason: string | undefined,
  backend: string | null | undefined,
  detail: string | null,
): string {
  switch (reason) {
    case "hardcoded-key-backend":
      return "This Linux session uses the keyring's basic_text backend, which encrypts with a fixed key that is not a secret. New credentials are treated as unprotected."
    case "metadata-unreadable":
      return detail ?? "The plaintext setting could not be read, so no new credential is written."
    case "encryption-unavailable":
      return backend
        ? `The OS keyring (${backend}) is not available right now. Unlock it and check again; saved credentials are untouched.`
        : "No OS keyring is available right now. Sign in to the keyring and check again; saved credentials are untouched."
    case "ready":
      return "The OS keyring is available."
    default:
      return "The state of the OS keyring could not be read."
  }
}
