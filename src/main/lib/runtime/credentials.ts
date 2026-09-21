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
import { markCredentialsApplied, planCredentialRelease } from "./credential-ledger"
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

export async function applyNativeCredentials(
  client: JcodeClient,
  request: NativeCredentialRequest,
  sessionId?: string,
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
  const handoff = { client, sessionId: memorySession, ephemeralProviders }

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
    // ledger still applies: a turn that superseded this one in the meantime owns
    // the providers it wrote, and releasing those would strip its credentials.
    if (handoff.sessionId !== undefined) {
      const generation = markCredentialsApplied(handoff.sessionId, ephemeralProviders)
      await releaseNativeEphemeralCredentials(
        client,
        handoff.sessionId,
        ephemeralProviders,
        generation,
      )
    }
    throw error
  }

  // Remember which generation owns the in-memory keys, so a turn that a
  // replacement superseded cannot release the keys the replacement applied.
  const generation =
    memorySession === undefined ? 0 : markCredentialsApplied(memorySession, ephemeralProviders)
  return { providers, ephemeralProviders, generation }
}

type CredentialHandoff = {
  client: JcodeClient
  /** Set only when the daemon advertised the memory-only request. */
  sessionId: string | undefined
  ephemeralProviders: string[]
}

/** Writes a key in memory when the daemon supports it, on disk otherwise. */
async function applyKey(handoff: CredentialHandoff, provider: string, key: string): Promise<void> {
  if (handoff.sessionId !== undefined) {
    await handoff.client.setEphemeralApiKey(handoff.sessionId, provider, key)
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
): Promise<void> {
  await Promise.all(
    providers.map((provider) =>
      client.clearEphemeralApiKey(sessionId, provider).catch((error: unknown) => {
        console.warn(
          `[NativeRuntime] The daemon still holds the in-memory ${provider} key; ` +
            `the release call failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }),
    ),
  )
}

/**
 * Releases the keys one turn applied, once that turn is over. A superseded turn
 * cannot clear a provider its replacement wrote, because that slot holds the
 * replacement's value.
 */
export async function releaseNativeEphemeralCredentials(
  client: JcodeClient,
  sessionId: string,
  providers: readonly string[],
  generation: number,
): Promise<void> {
  const toClear = planCredentialRelease(sessionId, generation, providers)
  if (toClear.length === 0) return
  await clearNativeEphemeralCredentials(client, sessionId, toClear)
}
