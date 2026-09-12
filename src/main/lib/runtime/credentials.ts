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
import { isHonoredEndpoint, readEndpointSettings } from "./endpoints"

export interface NativeCredentialRequest {
  /** Per-chat override (legacy `customConfig` shape, minus baseUrl). */
  customToken?: string
  customBaseUrl?: string
}

export interface NativeCredentialResult {
  providers: string[]
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
): Promise<NativeCredentialResult> {
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
  const anthropicToken = getActiveAnthropicToken()
  if (anthropicToken) {
    await client.setApiKey("anthropic-api", anthropicToken)
    providers.push("anthropic-api")
  } else if (process.env.ANTHROPIC_API_KEY) {
    // The daemon inherits process env and resolves ANTHROPIC_API_KEY itself.
    providers.push("anthropic-api (env)")
  }
  if (request.customToken) {
    await client.setApiKey("openai-api", request.customToken)
    providers.push("openai-api")
  } else if (process.env.OPENAI_API_KEY) {
    providers.push("openai-api (env)")
  }
  return { providers }
}
