import { z } from "zod"
import { getSecretStorageStatus, setPlaintextSecretConsent } from "../../../auth-store"
import { publicProcedure, router } from "../index"

export const secretStorageRouter = router({
  getStatus: publicProcedure.query(() => getSecretStorageStatus()),
  setPlaintextConsent: publicProcedure
    .input(z.object({ consent: z.boolean() }))
    .mutation(({ input }) => setPlaintextSecretConsent(input.consent)),
})
