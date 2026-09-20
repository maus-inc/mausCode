/**
 * Agent mode vocabulary, owned once for both processes.
 *
 * The five modes are autonomy-ordered: plan < ask < edit < agent < turbo. The
 * taxonomy is ratified in `.dump/app/decisions/user-decisions-2026-09-11.md`
 * item 1. Every provider router validates the same union, the renderer cycles
 * through the same list, and the permission policy in
 * `src/shared/permissions/` keys its per-mode verdicts off it, so the literals
 * live here and nowhere else.
 */

import { z } from "zod"

export const AGENT_MODES = ["plan", "ask", "edit", "agent", "turbo"] as const

export type AgentMode = (typeof AGENT_MODES)[number]

export const agentModeSchema = z.enum(AGENT_MODES)

/** Mode a chat runs when the caller names none. */
export const DEFAULT_AGENT_MODE: AgentMode = "agent"

/** The mode Shift+Tab moves to from `current`. */
export function getNextMode(current: AgentMode): AgentMode {
  const index = AGENT_MODES.indexOf(current)
  return AGENT_MODES[(index + 1) % AGENT_MODES.length]
}

/** True when a stored or typed string is a mode this app knows. */
export function isAgentMode(value: string): value is AgentMode {
  return (AGENT_MODES as readonly string[]).includes(value)
}
