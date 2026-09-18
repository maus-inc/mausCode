/**
 * The Claude SDK permission posture for each mausCode mode.
 *
 * One mapping, one home, and it never answers one of the SDK's bypass
 * postures. Anthropic documents that a tool call auto-approved by a permission
 * mode never reaches `canUseTool`, and that `acceptEdits` auto-approves Edit,
 * Write and the filesystem shell commands mkdir, touch, rm, rmdir, mv, cp and
 * sed (https://docs.claude.com/en/docs/claude-code/sdk/sdk-permissions, read
 * 2026-09-18). Either that posture or the skip-permissions one would take file
 * edits out from under the permission gate in `src/main/lib/permissions/`,
 * which is the one gate roadmap step 10 puts every agent action through.
 *
 * `default` is the posture Anthropic describes as "requires a canUseTool
 * callback to handle approval", and it still auto-allows reads inside the
 * working directory, which is what the read-only class allows anyway.
 *
 * `src/main/lib/permissions/no-bypass.test.ts` fails if either token reaches
 * `src` again outside a test that asserts its absence.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"
import type { AgentMode } from "../../../shared/agent-mode"

/**
 * Answer the SDK posture for a mode, or refuse.
 *
 * The refusal is the ratified PA-8 behaviour in
 * `.dump/app/decisions/provisional-assumptions.md`: a mode this app cannot
 * honour fails loudly rather than falling back to a wider posture, because a
 * silent fallback runs the turn under safety the user did not select.
 */
export function sdkPermissionMode(mode: AgentMode): PermissionMode {
  switch (mode) {
    case "plan":
      return "plan"
    case "ask":
    case "edit":
    case "agent":
    case "turbo":
      return "default"
    default: {
      const unhandled: never = mode
      throw new Error(
        `No SDK permission posture for mode "${String(unhandled)}". Refusing to run the turn rather than widen its permissions.`,
      )
    }
  }
}
