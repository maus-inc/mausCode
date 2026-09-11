import type { ComponentType, SVGProps } from "react"
import {
  PlanIcon,
  AgentIcon,
} from "../../../components/ui/icons"
import {
  HelpCircle,
  Pencil,
  Zap,
} from "lucide-react"
import type { AgentMode } from "../atoms"

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
      return "Read-only. Plan before making changes."
    case "ask":
      return "Ask permission before editing files or running commands."
    case "edit":
      return "Edit files freely. Dangerous deletions blocked."
    case "agent":
      return "Full agent. Dangerous deletions blocked."
    case "turbo":
      return "Run everything without asking. Use with care."
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
