import { HelpCircle, Pencil, Zap } from "lucide-react"
import type { ComponentType, SVGProps } from "react"
import type { AgentMode } from "../../../../shared/agent-mode"
import type { PermissionFloor } from "../../../../shared/provider-capabilities"
import { AgentIcon, PlanIcon } from "../../../components/ui/icons"

type IconComponent = ComponentType<{ className?: string } & Partial<SVGProps<SVGSVGElement>>>

/** Display label for a mode. */
export function getModeLabel(mode: AgentMode): string {
  switch (mode) {
    case "plan":
      return "Plan"
    case "ask":
      return "Ask"
    case "edit":
      return "Edit"
    case "agent":
      return "Agent"
    case "turbo":
      return "Turbo"
  }
}

/**
 * What a tooltip adds when Maus has no gate on the backend.
 *
 * It says what Maus cannot do and claims nothing for the backend, because the
 * nine differ. Cline and Roo take a mode flag, Grok takes an allow list, and
 * OpenClaw has no mode flag at all, so its plan turn carries a read-only request
 * in the prompt and nothing enforces it.
 *
 * The five descriptions below are what the app gate does, and only the Claude
 * path has one. A mode picker that promises a blocked action on a backend that
 * auto-approves everything is the overclaim this sentence closes.
 */
const ENGINE_ONLY_SUFFIX =
  "Maus has no gate on this backend, so it cannot block what the backend allows."

/**
 * Short tooltip describing what the mode does. Must match what the gate does on
 * the Claude path, and must say when a backend has no gate to match.
 *
 * `floor` has no default. A caller that has not looked the floor up would
 * otherwise get the unqualified promise, which is the overclaim this exists to
 * stop, so both mode pickers have to say which backend they are describing.
 */
export function getModeTooltip(mode: AgentMode, floor: PermissionFloor): string {
  const gated = modeTooltipText(mode)
  return floor === "app-gate" ? gated : `${gated} ${ENGINE_ONLY_SUFFIX}`
}

/** The five mode descriptions, which assume an app gate is running. */
function modeTooltipText(mode: AgentMode): string {
  switch (mode) {
    case "plan":
      return "Read-only, and writes only the plan's own markdown."
    case "ask":
      return "Asks before edits, commands and deletions. Network and secret access stay blocked."
    case "edit":
      return "Edits files without asking. Destructive, network and exfiltrating actions are blocked."
    case "agent":
      return "Runs edits and commands without asking. Web fetches and searches are allowed; outbound shell commands ask first. Destructive and exfiltrating actions stay blocked."
    case "turbo":
      return "Runs destructive commands and network egress without asking. Exfiltrating a secret stays blocked, and removing a critical path or reformatting a device still asks."
  }
}

/** Icon component for a mode. */
export function getModeIcon(mode: AgentMode): IconComponent {
  switch (mode) {
    case "plan":
      return PlanIcon as IconComponent
    case "ask":
      return HelpCircle as IconComponent
    case "edit":
      return Pencil as IconComponent
    case "agent":
      return AgentIcon as IconComponent
    case "turbo":
      return Zap as IconComponent
  }
}
