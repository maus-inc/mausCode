/**
 * Native-path credential resolution: existing mausCode/1Code credential stores
 * -> harness `set_api_key` calls over the local socket.
 *
 * Rules: credentials are values only in this module's narrow scope (read store,
 * hand to daemon, drop reference). They never enter router inputs, logs, or
 * transcripts. Callers only learn *which* providers were configured.
 *
 * P1 scope: Anthropic (stored OAuth token or `ANTHROPIC_API_KEY` from the
 * inherited shell env) and OpenAI (`OPENAI_API_KEY` from env, or a per-call
 * token applied as `openai-api`). Custom `baseUrl` endpoints are rejected with
 * a clear error: per-chat endpoint overrides need daemon-level config, which
 * arrives with the BYOK change.
 */

import type { JcodeClient } from "@maus-inc/runtime-client"
import { eq } from "drizzle-orm"
import { anthropicAccounts, anthropicSettings, getDatabase } from "../db"
import { decryptToken } from "../token-crypto"
import {
  beginCredentialTurn,
  claimCredential,
  planCredentialRelease,
  runCredentialTurn,
} from "./credential-ledger"
import { isHonoredEndpoint, readEndpointSettings } from "./endpoints"

export interface NativeCredentialRequest {
  /** Per-chat override (legacy `customConfig` shape, minus baseUrl). */
  customToken?: string
  customBaseUrl?: string
}

export interface NativeCredentialResult {
  providers: string[]
  /** Providers whose key was held in the runtime's memory, not on disk. */
  ephemeralProviders: string[]
  /**
   * Which handoff generation wrote the in-memory keys, or 0 when none were
   * written. Pass it back to `releaseNativeEphemeralCredentials`.
   */
  generation: number
}

/** Typed credential failure so the router maps it to an honest chunk. */
export class NativeCredentialError extends Error {
  constructor(
    public readonly kind: "custom-endpoint",
    message: string,
  ) {
    super(message)
  }
}

/** Active Anthropic account's decrypted OAuth/API token, if any. */
export function getActiveAnthropicToken(): string | null {
  const db = getDatabase()
  const settings = db
    .select()
    .from(anthropicSettings)
    .where(eq(anthropicSettings.id, "singleton"))
    .get()
  if (!settings?.activeAccountId) return null
  const account = db
    .select()
    .from(anthropicAccounts)
    .where(eq(anthropicAccounts.id, settings.activeAccountId))
    .get()
  if (!account) return null
  try {
    return decryptToken(account.oauthToken)
  } catch (_error) {
    console.error("[NativeCredentials] Anthropic token decrypt failed")
    return null
  }
}

export function applyNativeCredentials(
  client: JcodeClient,
  request: NativeCredentialRequest,
  sessionId?: string,
): Promise<NativeCredentialResult> {
  // One handoff takes one place in the session's order, so no other turn's
  // write or clear can land between two providers.
  if (sessionId === undefined) return applyNativeCredentialsNow(client, request, undefined)
  return runCredentialTurn(sessionId, () => applyNativeCredentialsNow(client, request, sessionId))
}

async function applyNativeCredentialsNow(
  client: JcodeClient,
  request: NativeCredentialRequest,
  sessionId: string | undefined,
): Promise<NativeCredentialResult> {
  // The runtime's own provider store is plaintext on disk. When the daemon
  // advertises the memory-only handoff, the key stays in its memory instead and
  // nothing is written at all.
  const memorySession =
    sessionId !== undefined && client.supports("ephemeral_api_key") ? sessionId : undefined
  if (request.customBaseUrl) {
    // Daemon-level endpoints only (see endpoints.ts): accept the chat's custom
    // endpoint when the daemon will actually honor it — an explicitly
    // configured setting or an ambient env override. Anything else stays a
    // loud refusal: silently running against a different endpoint than the
    // user selected would be a credential-routing lie.
    if (!isHonoredEndpoint(request.customBaseUrl, readEndpointSettings())) {
      throw new NativeCredentialError(
        "custom-endpoint",
        `The endpoint ${request.customBaseUrl} is not configured for the ` +
          "native engine (native endpoints are daemon-level: configure it in " +
          "Settings → Models → Native endpoints, or export the matching " +
          "*_BASE_URL env var). Unset the custom base URL or use legacy.",
      )
    }
  }
  const providers: string[] = []
  const ephemeralProviders: string[] = []
  // The generation is allocated before the first key is written, so every key
  // that lands belongs to this turn whether the handoff finishes or stops
  // partway, and a turn that superseded this one is never mistaken for it.
  const generation = memorySession === undefined ? 0 : beginCredentialTurn(memorySession)
  const handoff = { client, sessionId: memorySession, ephemeralProviders, generation }

  try {
    const anthropicToken = getActiveAnthropicToken()
    if (anthropicToken) {
      await applyKey(handoff, "anthropic-api", anthropicToken)
      providers.push("anthropic-api")
    } else if (process.env.ANTHROPIC_API_KEY) {
      // The daemon inherits process env and resolves ANTHROPIC_API_KEY itself.
      providers.push("anthropic-api (env)")
    }

    if (request.customToken) {
      await applyKey(handoff, "openai-api", request.customToken)
      providers.push("openai-api")
    } else if (process.env.OPENAI_API_KEY) {
      providers.push("openai-api (env)")
    }
  } catch (error) {
    // The caller installs its release hook only after this function returns, so
    // a handoff that stops halfway must drop the keys it already placed. The
    // ledger decides which ones those are: a turn that superseded this one owns
    // the slots it wrote, and clearing those would strip its credentials.
    if (memorySession !== undefined) {
      // This runs inside the handoff's own place in the queue, so it is the
      // direct call rather than the queued one, which would wait on itself.
      await releaseNativeEphemeralCredentialsNow(
        client,
        memorySession,
        ephemeralProviders,
        generation,
      )
    }
    throw error
  }

  return { providers, ephemeralProviders, generation }
}

type CredentialHandoff = {
  client: JcodeClient
  /** Set only when the daemon advertised the memory-only request. */
  sessionId: string | undefined
  ephemeralProviders: string[]
  /** This turn's ledger generation, or 0 when the keys go to the provider store. */
  generation: number
}

/** Writes a key in memory when the daemon supports it, on disk otherwise. */
async function applyKey(handoff: CredentialHandoff, provider: string, key: string): Promise<void> {
  const sessionId = handoff.sessionId
  if (sessionId !== undefined) {
    await handoff.client.setEphemeralApiKey(sessionId, provider, key)
    // Ownership is claimed after the daemon accepted the key, so the ledger
    // never claims a slot this turn did not actually fill.
    claimCredential(sessionId, handoff.generation, provider)
    handoff.ephemeralProviders.push(provider)
    return
  }
  await handoff.client.setApiKey(provider, key)
}

/**
 * Release keys held in the runtime's memory for one session. The daemon is
 * long-lived and keeps one value per provider variable, so a key left behind
 * would be read by the next session that sets nothing. A failure is therefore
 * reported by provider name, never by value; the key never reached disk. Never
 * deletes a stored credential.
 */
async function clearNativeEphemeralCredentials(
  client: JcodeClient,
  sessionId: string,
  providers: readonly string[],
): Promise<string[]> {
  const attempted = await Promise.all(
    providers.map(async (provider) => {
      try {
        await client.clearEphemeralApiKey(sessionId, provider)
        return null
      } catch (error) {
        console.warn(
          `[NativeRuntime] The daemon still holds the in-memory ${provider} key; ` +
            `the release call failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        return provider
      }
    }),
  )
  return attempted.filter((provider): provider is string => provider !== null)
}

/**
 * Clears the keys one turn applied. A superseded turn cannot clear a provider
 * its replacement wrote, because that slot holds the replacement's value. The
 * slots are read when the clear runs rather than when it was asked for.
 */
async function releaseNativeEphemeralCredentialsNow(
  client: JcodeClient,
  sessionId: string,
  providers: readonly string[],
  generation: number,
): Promise<void> {
  const plan = planCredentialRelease(sessionId, generation, providers)
  if (plan.providers.length === 0) return
  // A provider the daemon did not clear stays owned, so the ledger does not
  // record a release that did not happen.
  plan.settle(await clearNativeEphemeralCredentials(client, sessionId, plan.providers))
}

/**
 * Releases the keys one turn applied, once that turn is over. The clear takes
 * its place in the session's order, so it cannot land between a replacement's
 * two writes or after the replacement's own key is in place.
 */
export function releaseNativeEphemeralCredentials(
  client: JcodeClient,
  sessionId: string,
  providers: readonly string[],
  generation: number,
): Promise<void> {
  return runCredentialTurn(sessionId, () =>
    releaseNativeEphemeralCredentialsNow(client, sessionId, providers, generation),
  )
}
