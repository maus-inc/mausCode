/**
 * One reasoning-effort vocabulary for every backend that accepts one.
 *
 * The Claude Agent SDK at the pin in `package.json` (0.3.270) types its
 * `Options.effort` as `"low" | "medium" | "high" | "xhigh" | "max"`, and its
 * `ModelInfo` reports `supportedEffortLevels` from the same set. Codex has
 * always shipped four of those five, `max` being the one it does not send. Two
 * lists for one concept is how two backends drift, the same way the Codex model
 * id and its effort once drifted apart as one slash-joined string, so the wider
 * set lives here and each backend proves it is a subset:
 * `CODEX_REASONING_EFFORTS` in `codex-model-id.ts` carries
 * `satisfies readonly EffortLevel[]`.
 *
 * Which levels a given model accepts is the CLI's answer, not this module's.
 * The SDK documents that an effort above a model's `maxEffortLevel` is clamped
 * to it, so the picker offers the vocabulary and the runtime settles the model.
 * Reading `ModelInfo.supportedEffortLevels` per model is the follow-up that
 * retires a static list, mirroring what `providers/codex-models.ts` already does
 * for the Codex catalog.
 */
export const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]

const EFFORT_VALUES: ReadonlySet<string> = new Set(EFFORT_LEVELS)

export function isEffortLevel(value: string): value is EffortLevel {
  return EFFORT_VALUES.has(value)
}

/** The row label the picker shows for an effort level. */
export function formatEffortLabel(level: EffortLevel): string {
  if (level === "xhigh") return "Extra High"
  return level.charAt(0).toUpperCase() + level.slice(1)
}
