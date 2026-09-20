/**
 * Status, consent and storage for app credentials. The settings page reads the
 * status here, asks for plaintext permission here, and the renderer keeps its
 * provider values here instead of in browser storage. Every write checks the
 * same permission before it touches disk.
 */
import { app } from "electron"
import { z } from "zod"
import { getAuthManager } from "../../../auth-manager"
import { getSecretStore } from "../../secret-storage"
import {
  keyedStorePath,
  readKeyedSecrets,
  removeKeyedSecret,
  writeKeyedSecret,
} from "../../secret-storage/keyed-store"
import { publicProcedure, router } from "../index"

/** Values the renderer used to keep in browser storage. No key may stay there. */
export const RENDERER_SECRET_KEYS = [
  "agents:claude-custom-config",
  "agents:model-profiles",
  "agents:openai-api-key",
  "onboarding:codex-api-key",
] as const

const rendererSecretKey = z.enum(RENDERER_SECRET_KEYS)

function keyedStore() {
  return { filePath: keyedStorePath(app.getPath("userData")), store: getSecretStore() }
}

export const secretStorageRouter = router({
  status: publicProcedure.query(() => {
    const status = getSecretStore().status()
    const renderer = readKeyedSecrets(keyedStore())
    return {
      ...status,
      signInFailure: getAuthManager()?.lastError() ?? null,
      rendererError: renderer.error,
      rendererKeysStored: Object.keys(renderer.values),
    }
  }),

  setPlaintextConsent: publicProcedure
    .input(z.object({ consent: z.boolean() }))
    .mutation(({ input }) => getSecretStore().setPlaintextConsent(input.consent)),

  rendererSecrets: publicProcedure.query(() => {
    const { values, error } = readKeyedSecrets(keyedStore())
    return { values, error }
  }),

  setRendererSecret: publicProcedure
    .input(z.object({ key: rendererSecretKey, value: z.string() }))
    .mutation(({ input }) => {
      writeKeyedSecret(keyedStore(), input.key, input.value)
      return { ok: true as const }
    }),

  removeRendererSecret: publicProcedure
    .input(z.object({ key: rendererSecretKey }))
    .mutation(({ input }) => {
      removeKeyedSecret(keyedStore(), input.key)
      return { ok: true as const }
    }),
})
