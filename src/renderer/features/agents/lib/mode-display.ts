import { HelpCircle, Pencil, Zap } from "lucide-react"
import type { ComponentType, SVGProps } from "react"
import type { AgentMode } from "../../../../shared/agent-mode"
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

/** Short tooltip describing what the mode does. Must match canUseTool behavior. */
export function getModeTooltip(mode: AgentMode): string {
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
