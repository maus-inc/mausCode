/**
 * NOTE (transplant): DevServerButton: play/stop control with detection-state tooltips (EN).
 * Source: sylvaindiv/1code (Apache-2.0). UI strings translated FR->EN on port.
 */

import { Play, Square } from "lucide-react"
import type * as React from "react"
import { Button } from "../../components/ui/button"
import { IconSpinner } from "../../components/ui/icons"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip"
import { useDevServer } from "./use-dev-server"

interface DevServerButtonProps {
  chatId: string
  scopeKey: string
  cwd: string
}

const BUTTON_CLASS =
  "h-6 w-6 p-0 hover:bg-foreground/10 transition-colors text-foreground flex-shrink-0 rounded-md ml-2"

export function DevServerButton({ chatId, scopeKey, cwd }: DevServerButtonProps) {
  const {
    canRun,
    isLoadingDetection,
    isRunning,
    command,
    start,
    stop,
    isStarting,
    isStopping,
    detectReason,
    searchedPath,
    availableScripts,
  } = useDevServer({ chatId, scopeKey, cwd })

  if (isLoadingDetection) {
    return (
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled
            className={BUTTON_CLASS}
            aria-label="Detecting dev server"
          >
            <IconSpinner className="h-3.5 w-3.5 animate-spin" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Detecting dev server...</TooltipContent>
      </Tooltip>
    )
  }

  if (!canRun) {
    let tooltipBody: React.ReactNode
    if (detectReason === "no-package-json") {
      tooltipBody = (
        <>
          No <code>package.json</code> found
          {searchedPath && (
            <>
              {" "}
              at <code className="text-[10px]">{searchedPath}</code>
            </>
          )}
        </>
      )
    } else if (detectReason === "invalid-package-json") {
      tooltipBody = (
        <>
          Invalid <code>package.json</code>
          {searchedPath && (
            <>
              {" "}
              (<code className="text-[10px]">{searchedPath}</code>)
            </>
          )}
        </>
      )
    } else {
      tooltipBody = (
        <>
          No <code>dev</code> script in <code>package.json</code>
          {searchedPath && (
            <div className="mt-1 text-[10px] opacity-70 break-all">
              Checked file: <code>{searchedPath}</code>
            </div>
          )}
          {availableScripts.length > 0 ? (
            <div className="mt-1 text-[10px] opacity-70">
              Available scripts: {availableScripts.join(", ")}
            </div>
          ) : (
            <div className="mt-1 text-[10px] opacity-70">Available scripts: (none)</div>
          )}
        </>
      )
    }

    return (
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <span>
            <Button
              variant="ghost"
              size="icon"
              disabled
              className={`${BUTTON_CLASS} opacity-50`}
              aria-label="No dev script"
            >
              <Play className="h-4 w-4" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[360px]">
          {tooltipBody}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (isRunning) {
    return (
      <Tooltip delayDuration={500}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void stop()}
            disabled={isStopping}
            className={BUTTON_CLASS}
            aria-label="Stop dev server"
          >
            {isStopping ? (
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Square className="h-4 w-4 fill-current" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Stop the dev server</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Tooltip delayDuration={500}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void start()}
          disabled={isStarting}
          className={BUTTON_CLASS}
          aria-label="Start dev server"
        >
          {isStarting ? (
            <IconSpinner className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-4 w-4 fill-current" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Run <code>{command}</code>
      </TooltipContent>
    </Tooltip>
  )
}
