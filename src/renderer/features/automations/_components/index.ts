// Components

export { AutomationCard, type AutomationCardProps } from "./automation-card"
// Constants
export {
  AUTOMATION_TABS,
  CLAUDE_MODELS,
  GITHUB_TRIGGER_OPTIONS,
  LINEAR_TRIGGER_OPTIONS,
} from "./constants"
export { LinearIcon } from "./linear-icon"
export { PlatformIcon } from "./platform-icon"
export { TabToggle } from "./tab-toggle"
export { TemplateCard } from "./template-card"

// Templates
export { AUTOMATION_TEMPLATES } from "./templates"
// Types
export type {
  AutomationTemplate,
  ClaudeModel,
  GitHubTriggerType,
  LinearTriggerType,
  Platform,
  TriggerConfig,
  TriggerFilter,
  TriggerType,
  ViewTab,
} from "./types"
// Utils
export { getAutomationDescription, getTriggerLabel } from "./utils"
