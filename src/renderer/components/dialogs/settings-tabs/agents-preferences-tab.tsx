import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { APP_META, type ExternalApp } from "../../../../shared/external-apps"
import clionIcon from "../../../assets/app-icons/clion.svg"
// Editor icon imports
import cursorIcon from "../../../assets/app-icons/cursor.png"
import fleetIcon from "../../../assets/app-icons/fleet.svg"
import ghosttyIcon from "../../../assets/app-icons/ghostty.svg"
import golandIcon from "../../../assets/app-icons/goland.svg"
import intellijIcon from "../../../assets/app-icons/intellij.svg"
import itermIcon from "../../../assets/app-icons/iterm.png"
import phpstormIcon from "../../../assets/app-icons/phpstorm.svg"
import pycharmIcon from "../../../assets/app-icons/pycharm.svg"
import riderIcon from "../../../assets/app-icons/rider.svg"
import rustroverIcon from "../../../assets/app-icons/rustrover.svg"
import sublimeIcon from "../../../assets/app-icons/sublime.svg"
import terminalIcon from "../../../assets/app-icons/terminal.png"
import traeIcon from "../../../assets/app-icons/trae.svg"
import vscodeIcon from "../../../assets/app-icons/vscode.svg"
import vscodeInsidersIcon from "../../../assets/app-icons/vscode-insiders.svg"
import warpIcon from "../../../assets/app-icons/warp.png"
import webstormIcon from "../../../assets/app-icons/webstorm.svg"
import windsurfIcon from "../../../assets/app-icons/windsurf.svg"
import xcodeIcon from "../../../assets/app-icons/xcode.svg"
import zedIcon from "../../../assets/app-icons/zed.png"
import { AGENT_MODES } from "../../../features/agents/atoms"
import { getModeLabel } from "../../../features/agents/lib/mode-display"
import {
  type AgentMode,
  type AutoAdvanceTarget,
  analyticsOptOutAtom,
  autoAdvanceTargetAtom,
  type CtrlTabTarget,
  ctrlTabTargetAtom,
  defaultAgentModeAtom,
  desktopNotificationsEnabledAtom,
  extendedThinkingEnabledAtom,
  localOnlyModeAtom,
  notifyWhenFocusedAtom,
  preferredEditorAtom,
  promptSuggestionsEnabledAtom,
  soundNotificationsEnabledAtom,
} from "../../../lib/atoms"

const EDITOR_ICONS: Partial<Record<ExternalApp, string>> = {
  cursor: cursorIcon,
  vscode: vscodeIcon,
  "vscode-insiders": vscodeInsidersIcon,
  zed: zedIcon,
  windsurf: windsurfIcon,
  sublime: sublimeIcon,
  xcode: xcodeIcon,
  trae: traeIcon,
  iterm: itermIcon,
  warp: warpIcon,
  terminal: terminalIcon,
  ghostty: ghosttyIcon,
  intellij: intellijIcon,
  webstorm: webstormIcon,
  pycharm: pycharmIcon,
  phpstorm: phpstormIcon,
  goland: golandIcon,
  clion: clionIcon,
  rider: riderIcon,
  fleet: fleetIcon,
  rustrover: rustroverIcon,
}

interface EditorOption {
  id: ExternalApp
  label: string
}

// Order matches Superset: editors, terminals, VS Code, JetBrains
const EDITORS: EditorOption[] = [
  { id: "cursor", label: "Cursor" },
  { id: "zed", label: "Zed" },
  { id: "sublime", label: "Sublime Text" },
  { id: "xcode", label: "Xcode" },
  { id: "windsurf", label: "Windsurf" },
  { id: "trae", label: "Trae" },
]

const TERMINALS: EditorOption[] = [
  { id: "iterm", label: "iTerm" },
  { id: "warp", label: "Warp" },
  { id: "terminal", label: "Terminal" },
  { id: "ghostty", label: "Ghostty" },
]

const VSCODE: EditorOption[] = [
  { id: "vscode", label: "VS Code" },
  { id: "vscode-insiders", label: "VS Code Insiders" },
]

const JETBRAINS: EditorOption[] = [
  { id: "intellij", label: "IntelliJ IDEA" },
  { id: "webstorm", label: "WebStorm" },
  { id: "pycharm", label: "PyCharm" },
  { id: "phpstorm", label: "PhpStorm" },
  { id: "goland", label: "GoLand" },
  { id: "clion", label: "CLion" },
  { id: "rider", label: "Rider" },
  { id: "fleet", label: "Fleet" },
  { id: "rustrover", label: "RustRover" },
]

import { ChevronDown } from "lucide-react"
import jetbrainsBaseIcon from "../../../assets/app-icons/jetbrains.svg"
import vscodeBaseIcon from "../../../assets/app-icons/vscode.svg"
import { trpc } from "../../../lib/trpc"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu"
import { Kbd } from "../../ui/kbd"
import { Select, SelectContent, SelectItem, SelectTrigger } from "../../ui/select"
import { Switch } from "../../ui/switch"

// Hook to detect narrow screen
function useIsNarrowScreen(): boolean {
  const [isNarrow, setIsNarrow] = useState(false)

  useEffect(() => {
    const checkWidth = () => {
      setIsNarrow(window.innerWidth <= 768)
    }

    checkWidth()
    window.addEventListener("resize", checkWidth)
    return () => window.removeEventListener("resize", checkWidth)
  }, [])

  return isNarrow
}

export function AgentsPreferencesTab() {
  const [thinkingEnabled, setThinkingEnabled] = useAtom(extendedThinkingEnabledAtom)
  const [promptSuggestionsEnabled, setPromptSuggestionsEnabled] = useAtom(
    promptSuggestionsEnabledAtom,
  )
  const [soundEnabled, setSoundEnabled] = useAtom(soundNotificationsEnabledAtom)
  const [desktopNotificationsEnabled, setDesktopNotificationsEnabled] = useAtom(
    desktopNotificationsEnabledAtom,
  )
  const [notifyWhenFocused, setNotifyWhenFocused] = useAtom(notifyWhenFocusedAtom)
  const [analyticsOptOut, setAnalyticsOptOut] = useAtom(analyticsOptOutAtom)
  const [localOnlyMode, setLocalOnlyMode] = useAtom(localOnlyModeAtom)
  const [ctrlTabTarget, setCtrlTabTarget] = useAtom(ctrlTabTargetAtom)
  const [autoAdvanceTarget, setAutoAdvanceTarget] = useAtom(autoAdvanceTargetAtom)
  const [defaultAgentMode, setDefaultAgentMode] = useAtom(defaultAgentModeAtom)
  const [preferredEditor, setPreferredEditor] = useAtom(preferredEditorAtom)
  const isNarrowScreen = useIsNarrowScreen()

  // Co-authored-by setting from Claude settings.json
  const { data: includeCoAuthoredBy, refetch: refetchCoAuthoredBy } =
    trpc.claudeSettings.getIncludeCoAuthoredBy.useQuery()
  const setCoAuthoredByMutation = trpc.claudeSettings.setIncludeCoAuthoredBy.useMutation({
    onSuccess: () => {
      refetchCoAuthoredBy()
    },
  })

  const handleCoAuthoredByToggle = (enabled: boolean) => {
    setCoAuthoredByMutation.mutate({ enabled })
  }

  // Sync local-only mode to main process
  const handleLocalOnlyToggle = async (enabled: boolean) => {
    setLocalOnlyMode(enabled)
    try {
      await window.desktopApi?.setLocalOnlyMode(enabled)
    } catch (error) {
      console.error("Failed to sync local-only mode to main process:", error)
    }
  }

  // Sync opt-out status to main process
  const handleAnalyticsToggle = async (optedOut: boolean) => {
    setAnalyticsOptOut(optedOut)
    // Notify main process
    try {
      await window.desktopApi?.setAnalyticsOptOut(optedOut)
    } catch (error) {
      console.error("Failed to sync analytics opt-out to main process:", error)
    }
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header - hidden on narrow screens since it's in the navigation bar */}
      {!isNarrowScreen && (
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <h3 className="text-sm font-semibold text-foreground">Preferences</h3>
          <p className="text-xs text-muted-foreground">Configure Claude's behavior and features</p>
        </div>
      )}

      {/* Agent Behavior */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Extended Thinking</span>
            <span className="text-xs text-muted-foreground">
              Enable deeper reasoning with more thinking tokens (uses more credits).{" "}
              <span className="text-foreground/70">Disables response streaming.</span>
            </span>
          </div>
          <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Prompt Suggestions</span>
            <span className="text-xs text-muted-foreground">
              Ask Claude for one suggested next prompt when a turn finishes, and show it above the
              composer. <span className="text-foreground/70">Off by default.</span>
            </span>
          </div>
          <Switch
            checked={promptSuggestionsEnabled}
            onCheckedChange={setPromptSuggestionsEnabled}
          />
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Default Mode</span>
            <span className="text-xs text-muted-foreground">
              Mode for new agents (Plan = read-only ... Turbo = no asking)
            </span>
          </div>
          <Select
            value={defaultAgentMode}
            onValueChange={(value: AgentMode) => setDefaultAgentMode(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">{getModeLabel(defaultAgentMode)}</span>
            </SelectTrigger>
            <SelectContent>
              {AGENT_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {getModeLabel(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Include Co-Authored-By</span>
            <span className="text-xs text-muted-foreground">
              Add "Co-authored-by: Claude" to git commits made by Claude
            </span>
          </div>
          <Switch
            checked={includeCoAuthoredBy ?? true}
            onCheckedChange={handleCoAuthoredByToggle}
            disabled={setCoAuthoredByMutation.isPending}
          />
        </div>
      </div>

      {/* Notifications */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Desktop Notifications</span>
            <span className="text-xs text-muted-foreground">
              Show system notifications when agent needs input or completes work
            </span>
          </div>
          <Switch
            checked={desktopNotificationsEnabled}
            onCheckedChange={setDesktopNotificationsEnabled}
          />
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Sound Notifications</span>
            <span className="text-xs text-muted-foreground">
              Play a sound when agent completes work while you're away
            </span>
          </div>
          <Switch checked={soundEnabled} onCheckedChange={setSoundEnabled} />
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Notify When Focused</span>
            <span className="text-xs text-muted-foreground">
              Show notifications even when the app window is active
            </span>
          </div>
          <Switch
            checked={notifyWhenFocused}
            onCheckedChange={setNotifyWhenFocused}
            disabled={!desktopNotificationsEnabled}
          />
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Quick Switch</span>
            <span className="text-xs text-muted-foreground">
              What <Kbd>⌃Tab</Kbd> switches between
            </span>
          </div>
          <Select
            value={ctrlTabTarget}
            onValueChange={(value: CtrlTabTarget) => setCtrlTabTarget(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {ctrlTabTarget === "workspaces" ? "Workspaces" : "Agents"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workspaces">Workspaces</SelectItem>
              <SelectItem value="agents">Agents</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Auto-advance</span>
            <span className="text-xs text-muted-foreground">
              Where to go after archiving a workspace
            </span>
          </div>
          <Select
            value={autoAdvanceTarget}
            onValueChange={(value: AutoAdvanceTarget) => setAutoAdvanceTarget(value)}
          >
            <SelectTrigger className="w-auto px-2">
              <span className="text-xs">
                {autoAdvanceTarget === "next"
                  ? "Go to next workspace"
                  : autoAdvanceTarget === "previous"
                    ? "Go to previous workspace"
                    : "Close workspace"}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="next">Go to next workspace</SelectItem>
              <SelectItem value="previous">Go to previous workspace</SelectItem>
              <SelectItem value="close">Close workspace</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Preferred Editor</span>
            <span className="text-xs text-muted-foreground">
              Default app for opening workspaces
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {EDITOR_ICONS[preferredEditor] && (
                  <img
                    src={EDITOR_ICONS[preferredEditor]}
                    alt=""
                    className="h-4 w-4 flex-shrink-0"
                  />
                )}
                <span className="truncate">{APP_META[preferredEditor].label}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {EDITORS.map((editor) => (
                <DropdownMenuItem
                  key={editor.id}
                  onClick={() => setPreferredEditor(editor.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[editor.id] ? (
                    <img
                      src={EDITOR_ICONS[editor.id]}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{editor.label}</span>
                </DropdownMenuItem>
              ))}
              {TERMINALS.map((app) => (
                <DropdownMenuItem
                  key={app.id}
                  onClick={() => setPreferredEditor(app.id)}
                  className="flex items-center gap-2"
                >
                  {EDITOR_ICONS[app.id] ? (
                    <img
                      src={EDITOR_ICONS[app.id]}
                      alt=""
                      className="h-4 w-4 flex-shrink-0 object-contain"
                    />
                  ) : (
                    <div className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span>{app.label}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <img
                    src={vscodeBaseIcon}
                    alt=""
                    className="h-4 w-4 flex-shrink-0 object-contain"
                  />
                  <span>VS Code</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-48" sideOffset={6} alignOffset={-4}>
                  {VSCODE.map((app) => (
                    <DropdownMenuItem
                      key={app.id}
                      onClick={() => setPreferredEditor(app.id)}
                      className="flex items-center gap-2"
                    >
                      {EDITOR_ICONS[app.id] ? (
                        <img
                          src={EDITOR_ICONS[app.id]}
                          alt=""
                          className="h-4 w-4 flex-shrink-0 object-contain"
                        />
                      ) : (
                        <div className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span>{app.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="flex items-center gap-2">
                  <img
                    src={jetbrainsBaseIcon}
                    alt=""
                    className="h-4 w-4 flex-shrink-0 object-contain"
                  />
                  <span>JetBrains</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent
                  className="w-48 max-h-[300px] overflow-y-auto"
                  sideOffset={6}
                  alignOffset={-4}
                >
                  {JETBRAINS.map((app) => (
                    <DropdownMenuItem
                      key={app.id}
                      onClick={() => setPreferredEditor(app.id)}
                      className="flex items-center gap-2"
                    >
                      {EDITOR_ICONS[app.id] ? (
                        <img
                          src={EDITOR_ICONS[app.id]}
                          alt=""
                          className="h-4 w-4 flex-shrink-0 object-contain"
                        />
                      ) : (
                        <div className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span>{app.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Privacy */}
      <div className="bg-background rounded-lg border border-border overflow-hidden">
        <div className="flex items-center justify-between gap-6 p-4">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Share Usage Analytics</span>
            <span className="text-xs text-muted-foreground">
              Help us improve Agents by sharing anonymous usage data. We only track feature usage
              and app performance–never your code, prompts, or messages. No AI training on your
              data.
            </span>
          </div>
          <Switch
            checked={!analyticsOptOut}
            onCheckedChange={(enabled) => handleAnalyticsToggle(!enabled)}
          />
        </div>
        <div className="flex items-center justify-between gap-6 p-4 border-t border-border">
          <div className="flex flex-col space-y-1">
            <span className="text-sm font-medium text-foreground">Local-only mode</span>
            <span className="text-xs text-muted-foreground">
              Block hosted services: remote sandbox chats, usage analytics, and links to hosted
              clouds. Your provider API keys, Ollama, and git remotes keep working.
            </span>
          </div>
          <Switch checked={localOnlyMode} onCheckedChange={handleLocalOnlyToggle} />
        </div>
      </div>
    </div>
  )
}
