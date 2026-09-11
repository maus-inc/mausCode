/**
 * Provider registry router: capability manifests + live probes + policy
 * violations for every backend. Consumed by Settings (tucked away); chat
 * surfaces only violations.
 */
import { z } from "zod"
import {
  evaluateViolations,
  providerCapabilitySchema,
} from "../../../../shared/provider-capabilities"
import { isLocalOnlyMode } from "../../local-only"
import { getBackend, listBackends } from "../../providers/index"
import { publicProcedure, router } from "../index"

export const providersRouter = router({
  list: publicProcedure.query(() =>
    listBackends().map((backend) => providerCapabilitySchema.parse(backend.getCapability())),
  ),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const capability = getBackend(input.id)?.getCapability()
    return capability ? providerCapabilitySchema.parse(capability) : null
  }),

  probe: publicProcedure.input(z.object({ id: z.string() })).query(async ({ input }) => {
    const backend = getBackend(input.id)
    if (!backend) return null
    try {
      return await backend.probe()
    } catch (error) {
      return {
        available: false,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }),

  violations: publicProcedure
    .input(z.object({ ids: z.array(z.string()).optional() }).optional())
    .query(({ input }) => {
      const policy = { localOnly: isLocalOnlyMode() }
      const backends = input?.ids
        ? input.ids.flatMap((id) => {
            const backend = getBackend(id)
            return backend ? [backend] : []
          })
        : listBackends()
      return backends.flatMap((backend) =>
        evaluateViolations(providerCapabilitySchema.parse(backend.getCapability()), policy),
      )
    }),
})
