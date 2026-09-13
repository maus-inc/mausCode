import appcodeIcon from "@/assets/app-icons/appcode.svg"
import clionIcon from "@/assets/app-icons/clion.svg"
// Editor icon imports
import cursorIcon from "@/assets/app-icons/cursor.png"
import datagripIcon from "@/assets/app-icons/datagrip.svg"
import fleetIcon from "@/assets/app-icons/fleet.svg"
import ghosttyIcon from "@/assets/app-icons/ghostty.svg"
import golandIcon from "@/assets/app-icons/goland.svg"
import intellijIcon from "@/assets/app-icons/intellij.svg"
import phpstormIcon from "@/assets/app-icons/phpstorm.svg"
import pycharmIcon from "@/assets/app-icons/pycharm.svg"
import riderIcon from "@/assets/app-icons/rider.svg"
import rubymineIcon from "@/assets/app-icons/rubymine.svg"
import rustroverIcon from "@/assets/app-icons/rustrover.svg"
import sublimeIcon from "@/assets/app-icons/sublime.svg"
import traeIcon from "@/assets/app-icons/trae.svg"
import vscodeIcon from "@/assets/app-icons/vscode.svg"
import vscodeInsidersIcon from "@/assets/app-icons/vscode-insiders.svg"
import webstormIcon from "@/assets/app-icons/webstorm.svg"
import windsurfIcon from "@/assets/app-icons/windsurf.svg"
import xcodeIcon from "@/assets/app-icons/xcode.svg"
import zedIcon from "@/assets/app-icons/zed.png"
import type { ExternalApp } from "../../shared/external-apps"

export const EDITOR_ICONS: Partial<Record<ExternalApp, string>> = {
  cursor: cursorIcon,
  vscode: vscodeIcon,
  "vscode-insiders": vscodeInsidersIcon,
  zed: zedIcon,
  windsurf: windsurfIcon,
  sublime: sublimeIcon,
  xcode: xcodeIcon,
  trae: traeIcon,
  intellij: intellijIcon,
  webstorm: webstormIcon,
  pycharm: pycharmIcon,
  phpstorm: phpstormIcon,
  rubymine: rubymineIcon,
  goland: golandIcon,
  clion: clionIcon,
  rider: riderIcon,
  datagrip: datagripIcon,
  appcode: appcodeIcon,
  fleet: fleetIcon,
  rustrover: rustroverIcon,
  ghostty: ghosttyIcon,
}
