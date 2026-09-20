/**
 * The modes a transport with no permissions capability refuses.
 *
 * The native bridge advertises no `permissions` capability, so it never issues a
 * permission prompt and this app gets no per-action callback to route through the
 * gate in `src/main/lib/permissions/`. Two of the five modes promise restraint
 * that nothing on that transport can deliver. Plan promises a turn that only
 * reads, and ask promises a card before each action, so a turn that accepted
 * either would be a promise the app broke silently. The owner decided on
 * 2026-09-19 to refuse both rather than run them unenforced, which is decision 25
 * in `.dump/app/decisions/2026-09-13-permission-floor.md`.
 *
 * Edit, agent and turbo still run there. Each is a mode whose promise is that
 * actions happen, and the classes they promise to block are unenforced on that
 * transport exactly as they are for the `engine-only` backends in
 * `src/shared/provider-capabilities.ts`. Refusing all five would disable the
 * engine outright. The gap is disclosed where a user picks the transport rather
 * than left in this file, and the decision record names the classes.
 *
 * Shared and dependency-light so the refusal text is testable without importing a
 * router, which reaches electron and cannot load in the node-only vitest config.
 */
import type { AgentMode } from "../agent-mode"

/**
 * The refusal text for a mode this transport cannot honor, or null when it can
 * run. The text names the missing capability rather than the mode alone, so a
 * user reading it knows what to change rather than only what was refused.
 */
export function nativeModeRefusal(mode: AgentMode): string | null {
  if (mode === "plan") {
    return (
      "Plan mode needs a read-only floor this transport cannot enforce. The bridge " +
      "advertises no permissions capability, so no action reaches the permission " +
      "gate. Use the legacy transport for plan mode."
    )
  }
  if (mode === "ask") {
    return (
      "Ask mode needs a card before each action and this transport cannot produce " +
      "one. The bridge advertises no permissions capability, so no action reaches " +
      "the permission gate and nothing asks. Use the legacy transport for ask mode."
    )
  }
  return null
}
