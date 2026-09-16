/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- unified-sidebar rewrite port (Batch C, sidebar lineage adoption).
 * Adaptations: icons remapped to lucide-react; Build-mode integration
 * stripped (build/ excluded); our Kanban button re-added (kanban kept).
 * See openspec/changes/add-fork-harvest-transplants/tasks.md.
 */
"use client"

import { useAtom, useAtomValue, useSetAtom } from "jotai"
import {
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code,
  Columns3,
  FolderOpen,
  Plus,
  TerminalSquare,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useHotkeys } from "react-hotkeys-hook"
import { toast } from "sonner"
import { ConfirmArchiveDialog } from "../../components/confirm-archive-dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog"
import { Button } from "../../components/ui/button"
import { Checkbox } from "../../components/ui/checkbox"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../components/ui/context-menu"
import { ArchiveIcon, GitHubLogo, QuestionIcon, TrashIcon } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { Kbd } from "../../components/ui/kbd"
import { Skeleton } from "../../components/ui/skeleton"
import { TypewriterText } from "../../components/ui/typewriter-text"
import { getWindowId } from "../../contexts/WindowContext"
import {
  agentsSettingsDialogActiveTabAtom,
  agentsSidebarOpenAtom,
  autoAdvanceTargetAtom,
  betaAutomationsEnabledAtom,
  betaKanbanEnabledAtom,
  clearAgentChatSelectionAtom,
  isAgentMultiSelectModeAtom,
  isDesktopAtom,
  isFullscreenAtom,
  type SettingsTab,
  selectAllAgentChatsAtom,
  selectedAgentChatIdsAtom,
  selectedAgentChatsCountAtom,
  showWorkspaceIconAtom,
  toggleAgentChatSelectionAtom,
} from "../../lib/atoms"
import { useResolvedHotkeyDisplay } from "../../lib/hotkeys"
import {
  DURATION_FAST,
  DURATION_INSTANT,
  EASE_OUT,
  STAGGER_DELAY,
  STAGGER_DELAY_CHILDREN,
  TRANSITION_EXPAND,
} from "../../lib/motion"
import { trpc, trpcClient } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { isDesktopApp } from "../../lib/utils/platform"
import {
  type AgentMode,
  agentsDebugModeAtom,
  agentsSubChatUnseenChangesAtom,
  agentsUnseenChangesAtom,
  chatsAwaitingAnswerAtom,
  desktopViewAtom,
  expandedWorkspaceIdsAtom,
  justCreatedIdsAtom,
  lastChatIdPerProjectAtom,
  loadingSubChatsAtom,
  pendingUserQuestionsAtom,
  previousAgentChatIdAtom,
  pushedChatIdsAtom,
  requestNewChatFormResetAtom,
  selectedAgentChatIdAtom,
  selectedDraftIdAtom,
  selectedProjectAtom,
  showNewChatFormAtom,
  subChatFilesAtom,
  type UndoItem,
  undoStackAtom,
} from "../agents/atoms"
import { AgentsRenameSubChatDialog } from "../agents/components/agents-rename-subchat-dialog"
import { TrafficLightSpacer } from "../agents/components/traffic-light-spacer"
import { deleteNewChatDraft, type NewChatDraft, useNewChatDrafts } from "../agents/lib/drafts"
import { copyChat, exportChat } from "../agents/lib/export-chat"
import { hydrateErrorStatusesFromLatestRuns } from "../agents/stores/run-feed-projection"
import {
  OPEN_SUB_CHATS_CHANGE_EVENT,
  type SubChatMeta,
  useAgentSubChatStore,
} from "../agents/stores/sub-chat-store"
import { formatTimeAgo } from "../agents/utils/format-time-ago"
import { pluralize } from "../agents/utils/pluralize"
import { useHaptic } from "./hooks/use-haptic"
import { UsageStatsFooter } from "./usage-stats-footer"

// GitHub avatar with loading placeholder
const GitHubAvatar = React.memo(function GitHubAvatar({
  gitOwner,
  className = "h-4 w-4",
}: {
  gitOwner: string
  className?: string
}) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  const handleLoad = useCallback(() => setIsLoaded(true), [])
  const handleError = useCallback(() => setHasError(true), [])

  // Detect if parent wants rounded-full (circle) style
  const isCircle = className?.includes("rounded-full")

  if (hasError) {
    return <GitHubLogo className={cn(className, "text-muted-foreground flex-shrink-0")} />
  }

  return (
    <div className={cn(className, "relative flex-shrink-0 overflow-hidden")}>
      {/* Placeholder background while loading */}
      {!isLoaded && (
        <div
          className={cn("absolute inset-0 bg-muted", isCircle ? "rounded-full" : "rounded-sm")}
        />
      )}
      <img
        src={`https://github.com/${gitOwner}.png?size=64`}
        alt={gitOwner}
        className={cn(
          className,
          "flex-shrink-0 object-cover",
          isCircle ? "rounded-full" : "rounded-sm",
          isLoaded ? "opacity-100" : "opacity-0",
        )}
        onLoad={handleLoad}
        onError={handleError}
      />
    </div>
  )
})

// Memoized Draft Item component to prevent re-renders on hover
const DraftItem = React.memo(function DraftItem({
  draftId,
  draftText,
  draftUpdatedAt,
  projectGitOwner,
  projectGitProvider,
  projectGitRepo,
  projectName,
  isSelected,
  isMultiSelectMode,
  showIcon,
  onSelect,
  onDelete,
  formatTime,
}: {
  draftId: string
  draftText: string
  draftUpdatedAt: number
  projectGitOwner: string | null | undefined
  projectGitProvider: string | null | undefined
  projectGitRepo: string | null | undefined
  projectName: string | null | undefined
  isSelected: boolean
  isMultiSelectMode: boolean
  showIcon: boolean
  onSelect: (draftId: string) => void
  onDelete: (draftId: string) => void
  formatTime: (dateStr: string) => string
}) {
  return (
    <>
      {/* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */}
      <div
        onClick={() => onSelect(draftId)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            e.currentTarget.click()
          }
        }}
        className={cn(
          "w-full text-left py-1.5 cursor-pointer group relative",
          "transition-colors duration-75",
          "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
          isMultiSelectMode ? "px-3" : "pl-2 pr-2",
          !isMultiSelectMode && "rounded-md",
          isSelected
            ? "bg-foreground/5 text-foreground"
            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
        )}
      >
        <div className="flex items-start gap-2.5">
          {showIcon && (
            <div className="pt-0.5">
              <div className="relative flex-shrink-0 w-4 h-4">
                {projectGitOwner && projectGitProvider === "github" ? (
                  <GitHubAvatar gitOwner={projectGitOwner} />
                ) : (
                  <GitHubLogo className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
              </div>
            </div>
          )}
          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div className="flex items-center gap-1">
              <span className="truncate block text-sm leading-tight flex-1">
                {draftText.slice(0, 50)}
                {draftText.length > 50 ? "..." : ""}
              </span>
              {/* Delete button - shown on hover */}
              {!isMultiSelectMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(draftId)
                  }}
                  tabIndex={-1}
                  className="flex-shrink-0 text-muted-foreground hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover:opacity-100 group-hover:scale-100 group-hover:pointer-events-auto active:scale-[0.97]"
                  aria-label="Delete draft"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground/60 truncate">
                <span className="text-blue-500">Draft</span>
                {projectGitRepo
                  ? ` \u2022 ${projectGitRepo}`
                  : projectName
                    ? ` \u2022 ${projectName}`
                    : ""}
              </span>
              <span className="text-[11px] text-muted-foreground/60 flex-shrink-0">
                {formatTime(new Date(draftUpdatedAt).toISOString())}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

// ── Grid Pulse Spinner ─────────────────────────────────────────────────────
// A 2x2 grid of dots that pulse in staggered sequence — used as the loading
// indicator for active sub-chat threads. Uses CSS keyframes for reliability
// across re-renders (motion variant propagation was unreliable here).
const _GRID_PULSE_STYLE_ID = "grid-pulse-spinner-keyframes"

const GridPulseSpinner = React.memo(function GridPulseSpinner({
  size = 10,
  className,
  paused = false,
}: {
  size?: number
  className?: string
  paused?: boolean
}) {
  // Each dot is ~38% of container to leave gaps
  const dotSize = Math.max(1, Math.round(size * 0.38))
  const gap = Math.max(1, Math.round(size * 0.12))

  return (
    <div
      className={cn("inline-grid grid-cols-2 items-center justify-items-center", className)}
      style={{ width: size, height: size, gap }}
    >
      <style>{`
        @keyframes gridPulse {
          0%, 100% { opacity: 0.15; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1.15); }
        }
      `}</style>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-full bg-current"
          style={{
            width: dotSize,
            height: dotSize,
            opacity: paused ? 0.6 : undefined,
            animation: paused ? undefined : `gridPulse 1.4s ease-in-out ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </div>
  )
})

// Memoized Sub-Chat Item - renders an indented sub-chat row within a workspace group
const SubChatItem = React.memo(function SubChatItem({
  subChat,
  isActive,
  isLoading,
  hasUnseenChanges,
  onSelect,
  onArchive,
  accentColor,
  additions,
  deletions,
  updatedAt,
}: {
  subChat: SubChatMeta
  isActive: boolean
  isLoading: boolean
  hasUnseenChanges: boolean
  onSelect: (subChat: SubChatMeta) => void
  onArchive: (subChatId: string) => void
  accentColor?: string | null
  additions?: number
  deletions?: number
  updatedAt?: string
}) {
  // Show metadata line if we have file stats or a timestamp
  const hasStats = (additions ?? 0) > 0 || (deletions ?? 0) > 0
  const _hasMetadata = hasStats || !!updatedAt

  return (
    /* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(subChat)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          e.currentTarget.click()
        }
      }}
      style={
        accentColor
          ? {
              borderLeftColor: accentColor,
              backgroundColor: isActive ? `${accentColor}12` : undefined, // Stronger tint when active
            }
          : undefined
      }
      className={cn(
        "w-full text-left py-[6px] pl-[20px] pr-2 cursor-pointer group/subchat relative",
        "transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out rounded-md",
        // Accent color left border for visual grouping
        accentColor ? "border-l-2 rounded-l-none" : "",
        isActive
          ? accentColor
            ? "text-foreground"
            : "bg-foreground/5 text-foreground"
          : "text-muted-foreground/70 hover:bg-foreground/5 hover:text-foreground",
      )}
    >
      <div className="flex items-center gap-2">
        {/* Thread status indicator — always visible: animated when loading, paused when idle */}
        <div className="flex-shrink-0 w-[10px] flex items-center justify-center">
          {hasUnseenChanges && !isLoading ? (
            <div className="w-1.5 h-1.5 rounded-full bg-[#307BD0]" />
          ) : (
            <GridPulseSpinner
              size={10}
              className={cn(
                isLoading
                  ? "text-muted-foreground"
                  : isActive
                    ? "text-muted-foreground/30"
                    : "text-muted-foreground/15",
              )}
              paused={!isLoading}
            />
          )}
        </div>
        <span
          className={cn(
            "truncate text-[12px] leading-snug flex-1",
            isActive
              ? "font-medium text-foreground"
              : hasUnseenChanges && !isLoading
                ? "text-emerald-500 font-medium"
                : "",
          )}
        >
          {subChat.name || "New Chat"}
        </span>
        {/* Time ago — Codex style, right-aligned, fades out on hover */}
        {updatedAt && (
          <span className="flex-shrink-0 text-[11px] text-muted-foreground/45 tabular-nums transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out group-hover/subchat:opacity-0 group-hover/subchat:-translate-x-1">
            {formatTimeAgo(updatedAt)}
          </span>
        )}
        {/* Archive button on hover — slides in from right */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onArchive(subChat.id)
          }}
          tabIndex={-1}
          className="absolute right-2 flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-muted-foreground/25 hover:text-foreground/70 hover:bg-foreground/[0.08] transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out opacity-0 translate-x-1 group-hover/subchat:opacity-100 group-hover/subchat:translate-x-0 active:scale-90"
          aria-label="Archive thread"
        >
          <Archive size={12} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  )
})

// ── Confirm Thread Archive Dialog ────────────────────────────────────────
// Confirmation before archiving a sub-chat thread (canonical AlertDialog)
const ConfirmThreadArchiveDialog = React.memo(function ConfirmThreadArchiveDialog({
  isOpen,
  threadName,
  onClose,
  onConfirm,
  isPending,
}: {
  isOpen: boolean
  threadName: string
  onClose: () => void
  onConfirm: () => void
  isPending: boolean
}) {
  return (
    <AlertDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive thread?</AlertDialogTitle>
          <AlertDialogDescription>
            This archives{" "}
            <span className="font-medium text-foreground">{threadName || "this thread"}</span> and
            removes its messages. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isPending ? "Archiving..." : "Archive"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
})

// Renders the sub-chat list for an expanded workspace
const WorkspaceSubChats = React.memo(function WorkspaceSubChats({
  chatId,
  searchQuery,
  onSubChatSelect,
  accentColor,
  onNewThread,
}: {
  chatId: string
  searchQuery?: string
  onSubChatSelect: (workspaceId: string, subChat: SubChatMeta) => void
  accentColor?: string | null
  onNewThread?: (workspaceId: string) => void
}) {
  // Fetch sub-chats from tRPC for this workspace
  const { data: chatData, isLoading: isLoadingChatData } = trpc.chats.get.useQuery({ id: chatId })

  // The run feed only replays active runs, so a reload would lose a persisted
  // terminal error. chats.get attaches the newest run per sub-chat; seed the
  // store from it before any feed item can arrive for this workspace.
  useEffect(() => {
    if (chatData?.subChats) hydrateErrorStatusesFromLatestRuns(chatData.subChats)
  }, [chatData?.subChats])

  const utils = trpc.useUtils()
  const loadingSubChats = useAtomValue(loadingSubChatsAtom)
  const unseenChanges = useAtomValue(agentsSubChatUnseenChangesAtom)
  const subChatFiles = useAtomValue(subChatFilesAtom)
  const activeSubChatId = useAgentSubChatStore((state) => state.activeSubChatId)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)

  // Confirmation dialog state for thread archive
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null)
  const archiveConfirmName = useMemo(() => {
    if (!archiveConfirmId || !chatData?.subChats) return ""
    return chatData.subChats.find((sc) => sc.id === archiveConfirmId)?.name ?? "Untitled"
  }, [archiveConfirmId, chatData?.subChats])

  // Delete sub-chat mutation — actually removes from the database
  const deleteSubChatMutation = trpc.chats.deleteSubChat.useMutation({
    onSuccess: () => {
      if (archiveConfirmId) {
        // Remove from Zustand open tabs + allSubChats
        useAgentSubChatStore.getState().removeFromOpenSubChats(archiveConfirmId)
        // Invalidate the workspace query so the list refreshes
        utils.chats.get.invalidate({ id: chatId })
      }
      setArchiveConfirmId(null)
    },
    onError: () => {
      toast.error("Failed to archive thread")
      setArchiveConfirmId(null)
    },
  })

  // Sort sub-chats by most recent first, then filter by search query
  const subChats = useMemo(() => {
    if (!chatData?.subChats) return []
    const sorted = [...chatData.subChats].sort((a, b) => {
      const aT = new Date(a.updatedAt || a.createdAt || "0").getTime()
      const bT = new Date(b.updatedAt || b.createdAt || "0").getTime()
      return bT - aT
    })
    // Apply search filter if provided
    if (searchQuery?.trim()) {
      const query = searchQuery.toLowerCase()
      return sorted.filter((sc) => (sc.name ?? "").toLowerCase().includes(query))
    }
    return sorted
  }, [chatData?.subChats, searchQuery])

  // Show confirmation dialog before archiving
  const handleArchiveSubChat = useCallback((subChatId: string) => {
    setArchiveConfirmId(subChatId)
  }, [])

  // Confirm the archive — actually delete the sub-chat
  const handleConfirmArchive = useCallback(() => {
    if (!archiveConfirmId) return
    deleteSubChatMutation.mutate({ id: archiveConfirmId })
  }, [archiveConfirmId, deleteSubChatMutation])

  // Skeleton loading rows while fetching sub-chats
  if (isLoadingChatData && !chatData) {
    return (
      <div className="py-px space-y-px">
        {[1, 2].map((i) => (
          <div key={i} className="pl-[20px] pr-2 py-[6px]">
            <Skeleton className="h-[14px] rounded-sm" style={{ width: i === 1 ? "65%" : "45%" }} />
          </div>
        ))}
      </div>
    )
  }

  if (!chatData?.subChats || chatData.subChats.length === 0) {
    return (
      <div className="py-px">
        <div className="pl-[20px] pr-2 py-[5px]">
          <span className="text-[11px] text-muted-foreground/40 italic">No threads</span>
        </div>
        {onNewThread && (
          <button
            type="button"
            onClick={() => onNewThread(chatId)}
            className="w-full text-left pl-[20px] pr-2 py-[6px] flex items-center gap-2 text-[12px] text-muted-foreground/50 hover:text-foreground rounded-md hover:bg-foreground/5 transition-colors duration-150"
          >
            <Plus size={12} strokeWidth={2} />
            <span>New thread</span>
          </button>
        )}
      </div>
    )
  }

  // All sub-chats filtered out by search
  if (subChats.length === 0) {
    return null
  }

  return (
    <>
      <motion.div
        className="py-px"
        initial="collapsed"
        animate="open"
        variants={{
          collapsed: {},
          open: {
            transition: { staggerChildren: STAGGER_DELAY, delayChildren: STAGGER_DELAY_CHILDREN },
          },
        }}
      >
        {subChats.map((sc) => {
          // Compute file change stats from subChatFilesAtom
          const fileChanges = subChatFiles.get(sc.id) || []
          const stats =
            fileChanges.length > 0
              ? fileChanges.reduce(
                  (acc, f) => ({
                    additions: acc.additions + f.additions,
                    deletions: acc.deletions + f.deletions,
                  }),
                  { additions: 0, deletions: 0 },
                )
              : null

          return (
            <motion.div
              key={sc.id}
              variants={{
                collapsed: { opacity: 0, y: -3 },
                open: { opacity: 1, y: 0 },
              }}
              transition={{ duration: DURATION_FAST, ease: EASE_OUT }}
            >
              <SubChatItem
                subChat={{
                  id: sc.id,
                  name: sc.name ?? "New Chat",
                  created_at: sc.createdAt?.toISOString() ?? new Date().toISOString(),
                  updated_at: sc.updatedAt?.toISOString() ?? undefined,
                  mode: sc.mode as AgentMode | undefined,
                }}
                isActive={selectedChatId === chatId && activeSubChatId === sc.id}
                isLoading={loadingSubChats.has(sc.id)}
                hasUnseenChanges={unseenChanges.has(sc.id)}
                onSelect={(subChat) => onSubChatSelect(chatId, subChat)}
                onArchive={handleArchiveSubChat}
                accentColor={accentColor}
                additions={stats?.additions}
                deletions={stats?.deletions}
                updatedAt={sc.updatedAt?.toISOString() ?? undefined}
              />
            </motion.div>
          )
        })}
        {onNewThread && (
          <motion.div
            variants={{
              collapsed: { opacity: 0, y: -3 },
              open: { opacity: 1, y: 0 },
            }}
            transition={{ duration: DURATION_FAST, ease: EASE_OUT }}
          >
            <button
              type="button"
              onClick={() => onNewThread(chatId)}
              className="w-full text-left pl-[20px] pr-2 py-[6px] flex items-center gap-2 text-[12px] text-muted-foreground/50 hover:text-foreground rounded-md hover:bg-foreground/5 transition-colors duration-150"
            >
              <Plus size={12} strokeWidth={2} />
              <span>New thread</span>
            </button>
          </motion.div>
        )}
      </motion.div>

      {/* Thread archive confirmation dialog */}
      <ConfirmThreadArchiveDialog
        isOpen={archiveConfirmId !== null}
        threadName={archiveConfirmName}
        onClose={() => setArchiveConfirmId(null)}
        onConfirm={handleConfirmArchive}
        isPending={deleteSubChatMutation.isPending}
      />
    </>
  )
})

export type SidebarDesktopUser = {
  id: string
  email: string
  name: string | null
  imageUrl: string | null
  username: string | null
} | null

interface AgentsSidebarProps {
  desktopUser?: SidebarDesktopUser
  onSignOut?: () => void
  onToggleSidebar?: (e?: React.MouseEvent) => void
}

// Custom SVG icons matching web's icons.tsx
function SidebarInboxIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M3 12H7.5C8.12951 12 8.72229 12.2964 9.1 12.8L9.4 13.2C9.77771 13.7036 10.3705 14 11 14H13C13.6295 14 14.2223 13.7036 14.6 13.2L14.9 12.8C15.2777 12.2964 15.8705 12 16.5 12H21M21.7365 11.5389L18.5758 6.00772C18.2198 5.38457 17.5571 5 16.8394 5H7.16065C6.44293 5 5.78024 5.38457 5.42416 6.00772L2.26351 11.5389C2.09083 11.841 2 12.1831 2 12.5311V17C2 18.1046 2.89543 19 4 19H20C21.1046 19 22 18.1046 22 17V12.5311C22 12.1831 21.9092 11.841 21.7365 11.5389Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SidebarAutomationsIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M9.50006 5.39844C7.09268 6.1897 5.1897 8.09268 4.39844 10.5001M19.8597 14.5001C19.9518 14.0142 20.0001 13.5128 20.0001 13.0001C20.0001 10.9895 19.2584 9.1522 18.0337 7.74679M6.70841 19.0001C8.11868 20.2448 9.97117 21.0001 12.0001 21.0001C12.5127 21.0001 13.0141 20.9518 13.5 20.8597"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="5" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="20" cy="17" r="2.5" stroke="currentColor" strokeWidth="2" />
      <circle cx="4" cy="17" r="2.5" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

// Isolated Inbox Button - full-width navigation link matching web layout
const InboxButton = memo(function InboxButton() {
  const automationsEnabled = useAtomValue(betaAutomationsEnabledAtom)
  const desktopView = useAtomValue(desktopViewAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const handleClick = useCallback(() => {
    setSelectedChatId(null)
    setSelectedDraftId(null)
    setShowNewChatForm(false)
    setDesktopView("inbox")
  }, [setSelectedChatId, setSelectedDraftId, setShowNewChatForm, setDesktopView])

  if (!automationsEnabled) return null

  const isActive = desktopView === "inbox"

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out border border-border/50",
        isActive
          ? "bg-foreground/[0.08] text-foreground/90 border-border/60"
          : "text-muted-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground hover:border-border/70 active:scale-[0.98]",
      )}
    >
      <SidebarInboxIcon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left font-medium">Inbox</span>
    </button>
  )
})

// Isolated Automations Button - full-width navigation link matching web layout
const AutomationsButton = memo(function AutomationsButton() {
  const automationsEnabled = useAtomValue(betaAutomationsEnabledAtom)

  const handleClick = useCallback(async () => {
    const apiBase = await window.desktopApi?.getApiBaseUrl()
    if (!apiBase) return // control plane not configured (local-only mode)
    window.desktopApi.openExternal(`${apiBase}/agents/app/automations`)
  }, [])

  if (!automationsEnabled) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out border border-border/50",
        "text-muted-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground hover:border-border/70 active:scale-[0.98]",
      )}
    >
      <SidebarAutomationsIcon className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left font-medium">Automations</span>
      <ArrowUpRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
    </button>
  )
})

// Isolated Sidebar Header - contains dropdown, traffic lights, close button
// Subscribes to dropdown state internally to prevent sidebar re-renders
interface SidebarHeaderProps {
  isDesktop: boolean
  isFullscreen: boolean | null
  desktopUser: SidebarDesktopUser
  onSignOut: () => void
  onToggleSidebar?: (e?: React.MouseEvent) => void
  setSettingsDialogOpen: (open: boolean) => void
  setSettingsActiveTab: (tab: SettingsTab) => void
  handleSidebarMouseEnter: () => void
  handleSidebarMouseLeave: (e: React.MouseEvent) => void
  closeButtonRef: React.RefObject<HTMLDivElement | null>
}

const SidebarHeader = memo(function SidebarHeader({
  isDesktop,
  isFullscreen,
  handleSidebarMouseEnter,
  handleSidebarMouseLeave,
}: SidebarHeaderProps) {
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover-intent sensor for sidebar auto-show; contains no actions. */}
      <div
        className="relative flex-shrink-0"
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
      >
        {/* Spacer for macOS traffic lights — pushes sidebar content below the title bar */}
        <TrafficLightSpacer isFullscreen={isFullscreen} isDesktop={isDesktop} />
      </div>
    </>
  )
})

// Isolated Kanban Button - mausCode keep (kanban retained; upstream removed it).
// Full-width nav style matching Inbox/Automations buttons above.
const KanbanButton = memo(function KanbanButton() {
  const kanbanEnabled = useAtomValue(betaKanbanEnabledAtom)
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const openKanbanHotkey = useResolvedHotkeyDisplay("open-kanban")

  const handleClick = useCallback(() => {
    setSelectedChatId(null)
    setSelectedDraftId(null)
    setShowNewChatForm(false)
    setDesktopView(null)
  }, [setSelectedChatId, setSelectedDraftId, setShowNewChatForm, setDesktopView])

  if (!kanbanEnabled) return null

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        "group flex items-center gap-2.5 w-full px-2.5 py-1.5 rounded-lg text-[13px] transition-[background-color,color,border-color,opacity,transform] duration-150 ease-out border border-border/50",
        "text-muted-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground hover:border-border/70 active:scale-[0.98]",
      )}
    >
      <Columns3 className="h-4 w-4 flex-shrink-0" />
      <span className="flex-1 text-left font-medium">Kanban</span>
      {openKanbanHotkey && <Kbd>{openKanbanHotkey}</Kbd>}
    </button>
  )
})

function toSelectedProject(
  project:
    | {
        id: string
        name: string
        path: string
        gitRemoteUrl?: string | null
        gitProvider?: string | null
        gitOwner?: string | null
        gitRepo?: string | null
      }
    | undefined,
) {
  if (!project) return null
  return {
    id: project.id,
    name: project.name,
    path: project.path,
    gitRemoteUrl: project.gitRemoteUrl ?? null,
    gitProvider: project.gitProvider as "github" | "gitlab" | "bitbucket" | null,
    gitOwner: project.gitOwner ?? null,
    gitRepo: project.gitRepo ?? null,
  }
}

export function AgentsSidebar({
  desktopUser = {
    id: "demo-user-id",
    email: "demo@example.com",
    name: "Demo User",
    imageUrl: null,
    username: null,
  },
  onSignOut = () => {},
  onToggleSidebar,
}: AgentsSidebarProps) {
  const [selectedChatId, setSelectedChatId] = useAtom(selectedAgentChatIdAtom)
  const previousChatId = useAtomValue(previousAgentChatIdAtom)
  const autoAdvanceTarget = useAtomValue(autoAdvanceTargetAtom)
  const [selectedDraftId, setSelectedDraftId] = useAtom(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const requestNewChatFormReset = useSetAtom(requestNewChatFormResetAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const [loadingSubChats] = useAtom(loadingSubChatsAtom)
  const pushedChatIds = useAtomValue(pushedChatIdsAtom)
  const pendingQuestions = useAtomValue(pendingUserQuestionsAtom)
  // Use ref instead of state to avoid re-renders on hover
  const isSidebarHoveredRef = useRef(false)
  const closeButtonRef = useRef<HTMLDivElement>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [sortMode, setSortMode] = useState<"recent" | "alpha">("recent") // Sort toggle: recent first or alphabetical
  const [focusedChatIndex, setFocusedChatIndex] = useState<number>(-1) // -1 means no focus
  const hoveredChatIndexRef = useRef<number>(-1) // Track hovered chat for X hotkey - ref to avoid re-renders

  // Global desktop/fullscreen state from atoms (initialized in AgentsLayout)
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)

  // Multi-select state
  const [selectedChatIds, setSelectedChatIds] = useAtom(selectedAgentChatIdsAtom)
  const isMultiSelectMode = useAtomValue(isAgentMultiSelectModeAtom)
  const selectedChatsCount = useAtomValue(selectedAgentChatsCountAtom)
  const toggleChatSelection = useSetAtom(toggleAgentChatSelectionAtom)
  const selectAllChats = useSetAtom(selectAllAgentChatsAtom)
  const clearChatSelection = useSetAtom(clearAgentChatSelectionAtom)

  // Scroll gradient refs - use DOM manipulation to avoid re-renders
  const topGradientRef = useRef<HTMLDivElement>(null)
  const bottomGradientRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Multiple drafts state - uses event-based sync instead of polling
  const drafts = useNewChatDrafts()

  // Read unseen changes from global atoms
  const unseenChanges = useAtomValue(agentsUnseenChangesAtom)
  const setUnseenChanges = useSetAtom(agentsUnseenChangesAtom)
  const setSubChatUnseenChanges = useSetAtom(agentsSubChatUnseenChangesAtom)
  const chatsAwaitingAnswer = useAtomValue(chatsAwaitingAnswerAtom)
  const justCreatedIds = useAtomValue(justCreatedIdsAtom)

  // Haptic feedback
  const { trigger: triggerHaptic } = useHaptic()

  // Resolved hotkeys for tooltips
  const archiveWorkspaceHotkey = useResolvedHotkeyDisplay("archive-workspace")

  // Rename dialog state
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [renamingChat, setRenamingChat] = useState<{
    id: string
    name: string
  } | null>(null)
  const [renameLoading, setRenameLoading] = useState(false)

  // Confirm archive dialog state
  const [confirmArchiveDialogOpen, setConfirmArchiveDialogOpen] = useState(false)
  const [archivingChatId, setArchivingChatId] = useState<string | null>(null)
  const [activeProcessCount, setActiveProcessCount] = useState(0)
  const [hasWorktree, setHasWorktree] = useState(false)
  const [uncommittedCount, setUncommittedCount] = useState(0)

  // Pinned chats (stored in localStorage per project)
  const [pinnedChatIds, setPinnedChatIds] = useState<Set<string>>(new Set())
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [expandedArchiveGroups, setExpandedArchiveGroups] = useState<Set<string>>(new Set())
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Agent name tooltip refs (for truncated names) - using DOM manipulation to avoid re-renders
  const agentTooltipRef = useRef<HTMLDivElement>(null)
  const nameRefs = useRef<Map<string, HTMLSpanElement>>(new Map())
  const agentTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)
  const setDesktopViewForSettings = useSetAtom(desktopViewAtom)
  const setSidebarOpenForSettings = useSetAtom(agentsSidebarOpenAtom)
  // Navigate to settings page instead of opening a dialog
  const setSettingsDialogOpen = useCallback(
    (open: boolean) => {
      if (open) {
        setDesktopViewForSettings("settings")
        setSidebarOpenForSettings(true)
      } else {
        setDesktopViewForSettings(null)
      }
    },
    [setDesktopViewForSettings, setSidebarOpenForSettings],
  )
  // Debug mode for testing first-time user experience
  const _debugMode = useAtomValue(agentsDebugModeAtom)

  // Sidebar appearance settings
  const showWorkspaceIcon = useAtomValue(showWorkspaceIconAtom)

  // Desktop: use selectedProject instead of teams
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)

  // Map of projectId → last opened chat ID. Restored on project switch.
  const [lastChatIdPerProject, setLastChatIdPerProject] = useAtom(lastChatIdPerProjectAtom)

  // Get tRPC utils early — needed for cache invalidation in callbacks below
  const utils = trpc.useUtils()

  // Bulk-clear "unseen" notifications for one project (or every project when
  // projectId is omitted). Optimistically clears the local atoms used by the
  // sidebar paint, then refreshes the server-derived isUnseen field.
  const markAllViewedMutation = trpc.chats.markAllViewed.useMutation({
    onSuccess: (result) => {
      const clearedIds = new Set(result.ids)
      setUnseenChanges((prev) => {
        let mutated = false
        const next = new Set(prev)
        for (const id of prev) {
          if (clearedIds.has(id)) {
            next.delete(id)
            mutated = true
          }
        }
        return mutated ? next : prev
      })
      setSubChatUnseenChanges(() => new Set<string>())
      utils.chats.list.invalidate()
      utils.projects.listWithStatus.invalidate()
    },
  })

  const handleMarkAllRead = useCallback(
    (projectId?: string) => {
      if (markAllViewedMutation.isPending) return
      markAllViewedMutation.mutate(projectId ? { projectId } : {})
    },
    [markAllViewedMutation],
  )

  // ── Hierarchical sidebar: expanded workspaces state ──────────────────────
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useAtom(expandedWorkspaceIdsAtom)

  // Toggle workspace expansion (collapse if expanded, expand if collapsed)
  const handleToggleExpand = useCallback(
    (chatId: string) => {
      setExpandedWorkspaceIds((prev) => {
        const set = new Set(prev)
        if (set.has(chatId)) {
          set.delete(chatId)
        } else {
          set.add(chatId)
        }
        return Array.from(set)
      })
    },
    [setExpandedWorkspaceIds],
  )

  // Toggle sort mode between recent and alphabetical
  const _handleToggleSort = useCallback(() => {
    setSortMode((prev) => (prev === "recent" ? "alpha" : "recent"))
  }, [])

  // Auto-expand workspace only when a *different* chat is selected
  // (not when the expanded set changes, which would fight user collapse)
  const prevSelectedRef = useRef<string | null>(null)
  useEffect(() => {
    if (selectedChatId && selectedChatId !== prevSelectedRef.current) {
      prevSelectedRef.current = selectedChatId
      setExpandedWorkspaceIds((prev) => {
        if (prev.includes(selectedChatId)) return prev
        return [...prev, selectedChatId]
      })
    }
  }, [selectedChatId, setExpandedWorkspaceIds])

  // Handle sub-chat selection from the hierarchy tree
  const handleSubChatSelect = useCallback(
    (workspaceId: string, subChat: SubChatMeta) => {
      setSelectedChatId(workspaceId)

      // Set the sub-chat as active in the store
      const store = useAgentSubChatStore.getState()
      store.setChatId(workspaceId)
      if (!store.openSubChatIds.includes(subChat.id)) {
        store.addToOpenSubChats(subChat.id)
      }
      store.setActiveSubChat(subChat.id)

      // Claim chat in desktop (prevent other windows from opening same chat)
      window.desktopApi?.claimChat(workspaceId)
    },
    [setSelectedChatId],
  )

  // Create a new sub-chat within a workspace
  const handleCreateSubChat = useCallback(
    async (workspaceId: string) => {
      try {
        const newSubChat = await trpcClient.chats.createSubChat.mutate({
          chatId: workspaceId,
          name: "Untitled",
          mode: "agent",
        })

        // Expand the workspace if not already expanded
        setExpandedWorkspaceIds((prev) => {
          if (prev.includes(workspaceId)) return prev
          return [...prev, workspaceId]
        })

        // Set the workspace as selected and navigate to the new sub-chat
        setSelectedChatId(workspaceId)
        const store = useAgentSubChatStore.getState()
        store.setChatId(workspaceId)
        store.addToAllSubChats({
          id: newSubChat.id,
          name: "Untitled",
          created_at: new Date().toISOString(),
          mode: "agent",
        })
        store.addToOpenSubChats(newSubChat.id)
        store.setActiveSubChat(newSubChat.id)
        window.desktopApi?.claimChat(workspaceId)

        // Invalidate the chat query so WorkspaceSubChats re-fetches and shows the new thread
        utils.chats.get.invalidate({ id: workspaceId })
      } catch (_err) {
        toast.error("Failed to create chat")
      }
    },
    [setExpandedWorkspaceIds, setSelectedChatId, utils],
  )

  // Fetch all local chats (no project filter)
  const { data: localChats } = trpc.chats.list.useQuery({})

  // Map local chats to unified format, sorted by most recent
  const agentChats = useMemo(() => {
    if (!localChats) return []

    return [...localChats].sort((a, b) => {
      const aTime = a.updatedAt?.getTime() ?? 0
      const bTime = b.updatedAt?.getTime() ?? 0
      return bTime - aTime
    })
  }, [localChats])

  // Track open sub-chat changes for reactivity
  const [openSubChatsVersion, setOpenSubChatsVersion] = useState(0)
  useEffect(() => {
    const handleChange = () => setOpenSubChatsVersion((v) => v + 1)
    window.addEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange)
    return () => window.removeEventListener(OPEN_SUB_CHATS_CHANGE_EVENT, handleChange)
  }, [])

  // Store previous value to avoid unnecessary React Query refetches
  const prevOpenSubChatIdsRef = useRef<string[]>([])

  // Collect all open sub-chat IDs from localStorage for all workspaces
  const allOpenSubChatIds = useMemo(() => {
    // openSubChatsVersion is used to trigger recalculation when sub-chats change
    void openSubChatsVersion
    if (!agentChats) return prevOpenSubChatIdsRef.current

    const windowId = getWindowId()
    const allIds: string[] = []
    for (const chat of agentChats) {
      try {
        // Use window-prefixed key (matches sub-chat-store.ts)
        const stored = localStorage.getItem(`${windowId}:agent-open-sub-chats-${chat.id}`)
        if (stored) {
          const ids = JSON.parse(stored) as string[]
          allIds.push(...ids)
        }
      } catch {
        // Skip invalid JSON
      }
    }

    // Compare with previous - if content is same, return old reference
    // This prevents React Query from refetching when array content hasn't changed
    const prev = prevOpenSubChatIdsRef.current
    const sorted = [...allIds].sort()
    const prevSorted = [...prev].sort()
    if (sorted.length === prevSorted.length && sorted.every((id, i) => id === prevSorted[i])) {
      return prev
    }

    prevOpenSubChatIdsRef.current = allIds
    return allIds
  }, [agentChats, openSubChatsVersion])

  // File changes stats from DB - only for open sub-chats
  const { data: fileStatsData } = trpc.chats.getFileStats.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    {
      refetchInterval: 5000,
      enabled: allOpenSubChatIds.length > 0,
      placeholderData: (prev) => prev,
    },
  )

  // Pending plan approvals from DB - only for open sub-chats
  const { data: pendingPlanApprovalsData } = trpc.chats.getPendingPlanApprovals.useQuery(
    { openSubChatIds: allOpenSubChatIds },
    {
      refetchInterval: 5000,
      enabled: allOpenSubChatIds.length > 0,
      placeholderData: (prev) => prev,
    },
  )

  // Fetch all projects for git info
  const { data: projects } = trpc.projects.list.useQuery()

  // Create map for quick project lookup by id
  const projectsMap = useMemo(() => {
    if (!projects) return new Map()
    return new Map(projects.map((p) => [p.id, p]))
  }, [projects])

  // Fetch all archived chats (to get count)
  const { data: archivedChats } = trpc.chats.listArchived.useQuery({})
  const _archivedChatsCount = archivedChats?.length ?? 0

  // Unified undo stack for workspaces and sub-chats (Jotai atom)
  const [undoStack, setUndoStack] = useAtom(undoStackAtom)

  // Restore chat mutation (for undo)
  const restoreChatMutation = trpc.chats.restore.useMutation({
    onSuccess: (_, variables) => {
      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()
      // Select the restored chat
      setSelectedChatId(variables.id)
    },
  })

  // Remove workspace item from stack by chatId
  const removeWorkspaceFromStack = useCallback(
    (chatId: string) => {
      setUndoStack((prev) => {
        const index = prev.findIndex((item) => item.type === "workspace" && item.chatId === chatId)
        if (index !== -1) {
          clearTimeout(prev[index].timeoutId)
          return [...prev.slice(0, index), ...prev.slice(index + 1)]
        }
        return prev
      })
    },
    [setUndoStack],
  )

  // Archive chat mutation
  const archiveChatMutation = trpc.chats.archive.useMutation({
    onSuccess: (_, variables) => {
      // Hide tooltip if visible (element may be removed from DOM before mouseLeave fires)
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
        agentTooltipTimerRef.current = null
      }
      if (agentTooltipRef.current) {
        agentTooltipRef.current.style.display = "none"
      }

      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()

      // If archiving the currently selected chat, navigate based on auto-advance setting
      if (selectedChatId === variables.id) {
        const currentIndex = agentChats?.findIndex((c) => c.id === variables.id) ?? -1

        if (autoAdvanceTarget === "next") {
          // Find next workspace in list (after current index)
          const nextChat = agentChats?.find((c, i) => i > currentIndex && c.id !== variables.id)
          if (nextChat) {
            setSelectedChatId(nextChat.id)
          } else {
            // No next workspace, go to new workspace view
            setSelectedChatId(null)
          }
        } else if (autoAdvanceTarget === "previous") {
          // Go to previously selected workspace
          const isPreviousAvailable =
            previousChatId &&
            agentChats?.some((c) => c.id === previousChatId && c.id !== variables.id)
          if (isPreviousAvailable) {
            setSelectedChatId(previousChatId)
          } else {
            setSelectedChatId(null)
          }
        } else {
          // Close: go to new workspace view
          setSelectedChatId(null)
        }
      }

      // Clear after 10 seconds (Cmd+Z window)
      const timeoutId = setTimeout(() => {
        removeWorkspaceFromStack(variables.id)
      }, 10000)

      // Add to unified undo stack for Cmd+Z
      setUndoStack((prev) => [
        ...prev,
        {
          type: "workspace",
          chatId: variables.id,
          timeoutId,
        },
      ])
    },
  })

  // Cmd+Z to undo archive (supports multiple undos for workspaces AND sub-chats)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && undoStack.length > 0) {
        e.preventDefault()
        // Get the most recent item
        const lastItem = undoStack[undoStack.length - 1]
        if (!lastItem) return

        // Clear timeout and remove from stack
        clearTimeout(lastItem.timeoutId)
        setUndoStack((prev) => prev.slice(0, -1))

        if (lastItem.type === "workspace") {
          // Restore workspace from archive
          restoreChatMutation.mutate({ id: lastItem.chatId })
        } else if (lastItem.type === "subchat") {
          // Restore sub-chat tab (re-add to open tabs)
          const store = useAgentSubChatStore.getState()
          store.addToOpenSubChats(lastItem.subChatId)
          store.setActiveSubChat(lastItem.subChatId)
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [undoStack, setUndoStack, restoreChatMutation])

  // Batch archive mutation
  const archiveChatsBatchMutation = trpc.chats.archiveBatch.useMutation({
    onSuccess: (_, variables) => {
      // Hide tooltip if visible (element may be removed from DOM before mouseLeave fires)
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
        agentTooltipTimerRef.current = null
      }
      if (agentTooltipRef.current) {
        agentTooltipRef.current.style.display = "none"
      }

      utils.chats.list.invalidate()
      utils.chats.listArchived.invalidate()

      // Add each chat to unified undo stack for Cmd+Z
      const newItems: UndoItem[] = variables.chatIds.map((chatId) => {
        const timeoutId = setTimeout(() => {
          removeWorkspaceFromStack(chatId)
        }, 10000)
        return { type: "workspace" as const, chatId, timeoutId }
      })
      setUndoStack((prev) => [...prev, ...newItems])
    },
  })

  // Restore previously focused chat when switching projects (and remember the
  // current chat for the project we are leaving). On initial mount we don't
  // touch the selection so the persisted selectedChatId can hydrate first.
  const prevProjectIdRef = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const nextProjectId = selectedProject?.id ?? null

    // Skip on initial mount — let persisted selectedChatId hydrate first.
    if (prevProjectIdRef.current === undefined) {
      prevProjectIdRef.current = nextProjectId
      return
    }

    if (prevProjectIdRef.current === nextProjectId) {
      return
    }

    // Persist the chat that was open in the project we are leaving so we can
    // jump back to it later.
    const prevProjectId = prevProjectIdRef.current
    if (prevProjectId && selectedChatId) {
      setLastChatIdPerProject((prev) =>
        prev[prevProjectId] === selectedChatId
          ? prev
          : { ...prev, [prevProjectId]: selectedChatId },
      )
    }

    // Restore the chat previously focused for the new project (if any).
    const restoredChatId = nextProjectId ? (lastChatIdPerProject[nextProjectId] ?? null) : null
    setSelectedChatId(restoredChatId)

    prevProjectIdRef.current = nextProjectId
  }, [
    selectedProject?.id,
    selectedChatId,
    setSelectedChatId,
    setLastChatIdPerProject,
    lastChatIdPerProject,
  ]) // Don't include selectedChatId in deps to avoid loops

  // Continuously record the last chat opened within the active project so a
  // future project switch can restore it.
  useEffect(() => {
    const projectId = selectedProject?.id
    if (!projectId || !selectedChatId) return
    if (lastChatIdPerProject[projectId] === selectedChatId) return
    setLastChatIdPerProject((prev) => ({ ...prev, [projectId]: selectedChatId }))
  }, [selectedProject?.id, selectedChatId, lastChatIdPerProject, setLastChatIdPerProject])

  // Drop stale chat IDs when their parent project no longer references them
  // (e.g. the chat was archived). Runs whenever the chats list refreshes.
  useEffect(() => {
    if (!localChats) return
    const liveChatIds = new Set(localChats.map((chat) => chat.id))
    setLastChatIdPerProject((prev) => {
      let changed = false
      const next: Record<string, string> = {}
      for (const [projectId, chatId] of Object.entries(prev)) {
        if (liveChatIds.has(chatId)) {
          next[projectId] = chatId
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [localChats, setLastChatIdPerProject])

  // Load pinned IDs from localStorage when project changes
  useEffect(() => {
    if (!selectedProject?.id) {
      setPinnedChatIds(new Set())
      return
    }
    try {
      const stored = localStorage.getItem(`agent-pinned-chats-${selectedProject.id}`)
      setPinnedChatIds(stored ? new Set(JSON.parse(stored)) : new Set())
    } catch {
      setPinnedChatIds(new Set())
    }
  }, [selectedProject?.id])

  // Save pinned IDs to localStorage when they change
  const prevPinnedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!selectedProject?.id) return
    // Only save if pinnedChatIds actually changed (avoid saving on load)
    if (
      (pinnedChatIds !== prevPinnedRef.current && pinnedChatIds.size > 0) ||
      prevPinnedRef.current.size > 0
    ) {
      localStorage.setItem(
        `agent-pinned-chats-${selectedProject.id}`,
        JSON.stringify([...pinnedChatIds]),
      )
    }
    prevPinnedRef.current = pinnedChatIds
  }, [pinnedChatIds, selectedProject?.id])

  // Rename mutation
  const renameChatMutation = trpc.chats.rename.useMutation({
    onSuccess: () => {
      utils.chats.list.invalidate()
    },
    onError: () => {
      toast.error("Failed to rename agent")
    },
  })

  // Accent color mutation — updates workspace color with optimistic cache update
  // Navigate to project settings page with the given project pre-selected
  const handleNavigateToSettings = useCallback(
    (projectId: string) => {
      // Find the project to populate the selectedProjectAtom so the settings tab opens with it selected
      const project = projects?.find((p) => p.id === projectId)
      if (project) {
        setSelectedProject({ id: project.id, name: project.name, path: project.path })
      }
      setSettingsActiveTab("projects")
      setSettingsDialogOpen(true)
    },
    [projects, setSelectedProject, setSettingsActiveTab, setSettingsDialogOpen],
  )

  const handleTogglePin = useCallback((chatId: string) => {
    setPinnedChatIds((prev) => {
      const next = new Set(prev)
      if (next.has(chatId)) {
        next.delete(chatId)
      } else {
        next.add(chatId)
      }
      return next
    })
  }, [])

  const handleRenameClick = useCallback((chat: { id: string; name: string | null }) => {
    setRenamingChat(chat as { id: string; name: string })
    setRenameDialogOpen(true)
  }, [])

  const handleRenameSave = async (newName: string) => {
    if (!renamingChat) return

    const chatId = renamingChat.id
    const oldName = renamingChat.name

    setRenameLoading(true)

    try {
      // Optimistically update the query cache
      utils.chats.list.setData({}, (old) => {
        if (!old) return old
        return old.map((c) => (c.id === chatId ? { ...c, name: newName } : c))
      })

      try {
        await renameChatMutation.mutateAsync({
          id: chatId,
          name: newName,
        })
      } catch {
        // Rollback on error
        utils.chats.list.setData({}, (old) => {
          if (!old) return old
          return old.map((c) => (c.id === chatId ? { ...c, name: oldName } : c))
        })
        throw new Error("Failed to rename workspace")
      }
      setRenameDialogOpen(false)
    } catch (error) {
      console.error("[handleRenameSave] Rename failed:", error)
      toast.error("Failed to rename workspace")
    } finally {
      setRenameLoading(false)
      setRenamingChat(null)
    }
  }

  // Check if all selected chats are pinned
  const areAllSelectedPinned = useMemo(() => {
    if (selectedChatIds.size === 0) return false
    return Array.from(selectedChatIds).every((id) => pinnedChatIds.has(id))
  }, [selectedChatIds, pinnedChatIds])

  // Check if all selected chats are unpinned
  const areAllSelectedUnpinned = useMemo(() => {
    if (selectedChatIds.size === 0) return false
    return Array.from(selectedChatIds).every((id) => !pinnedChatIds.has(id))
  }, [selectedChatIds, pinnedChatIds])

  // Show pin option only if all selected have same pin state
  const canShowPinOption = areAllSelectedPinned || areAllSelectedUnpinned

  // Handle bulk pin of selected chats
  const handleBulkPin = useCallback(() => {
    const chatIdsToPin = Array.from(selectedChatIds)
    if (chatIdsToPin.length > 0) {
      setPinnedChatIds((prev) => {
        const next = new Set(prev)
        chatIdsToPin.forEach((id) => {
          next.add(id)
        })
        return next
      })
      clearChatSelection()
    }
  }, [selectedChatIds, clearChatSelection])

  // Handle bulk unpin of selected chats
  const handleBulkUnpin = useCallback(() => {
    const chatIdsToUnpin = Array.from(selectedChatIds)
    if (chatIdsToUnpin.length > 0) {
      setPinnedChatIds((prev) => {
        const next = new Set(prev)
        chatIdsToUnpin.forEach((id) => {
          next.delete(id)
        })
        return next
      })
      clearChatSelection()
    }
  }, [selectedChatIds, clearChatSelection])

  // Filter and separate pinned/unpinned agents
  // During search: show ALL workspaces (they auto-expand and sub-chats are filtered within each)
  // This allows finding threads even when the parent workspace name doesn't match the query
  const { filteredChats } = useMemo(() => {
    if (!agentChats) return { pinnedAgents: [], unpinnedAgents: [], filteredChats: [] }

    // Keep all workspaces visible during search — sub-chat filtering happens inside
    // WorkspaceSubChats, and workspace names are visually dimmed when they don't match
    const sorted = [...agentChats]

    // Apply sort mode: "alpha" sorts alphabetically, "recent" is already sorted by updatedAt
    if (sortMode === "alpha") {
      sorted.sort((a, b) => {
        const aName = (a.name ?? "").toLowerCase()
        const bName = (b.name ?? "").toLowerCase()
        return aName.localeCompare(bName)
      })
    }

    const pinned = sorted.filter((chat) => pinnedChatIds.has(chat.id))
    const unpinned = sorted.filter((chat) => !pinnedChatIds.has(chat.id))

    return {
      pinnedAgents: pinned,
      unpinnedAgents: unpinned,
      filteredChats: [...pinned, ...unpinned],
    }
  }, [agentChats, pinnedChatIds, sortMode])

  // Group chats by project for the sidebar hierarchy (owner/repo grouping)
  type ChatType = typeof filteredChats extends (infer T)[] ? T : never
  const projectGroupedChats = useMemo(() => {
    const groups: Array<{
      key: string
      label: string
      projectId: string | null
      chats: ChatType[]
      drafts: NewChatDraft[]
    }> = []
    const groupMap = new Map<string, ChatType[]>()
    const groupOrder: string[] = []
    const projectIdsWithChats = new Set<string>()

    for (const chat of filteredChats) {
      const project = chat.projectId ? projectsMap.get(chat.projectId) : null
      if (chat.projectId) projectIdsWithChats.add(chat.projectId)
      const groupKey = project ? `proj:${chat.projectId}` : "ungrouped"

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, [])
        groupOrder.push(groupKey)
      }
      groupMap.get(groupKey)?.push(chat)
    }

    // Bucket visible drafts by project group (same key shape as chats)
    const draftMap = new Map<string, NewChatDraft[]>()
    for (const draft of drafts) {
      const draftProjectId = draft.project?.id
      const groupKey =
        draftProjectId && projectsMap.has(draftProjectId) ? `proj:${draftProjectId}` : "ungrouped"
      if (!draftMap.has(groupKey)) {
        draftMap.set(groupKey, [])
        // Ensure draft-only groups still show up
        if (!groupMap.has(groupKey)) {
          groupMap.set(groupKey, [])
          groupOrder.push(groupKey)
        }
      }
      draftMap.get(groupKey)?.push(draft)
      if (draftProjectId) projectIdsWithChats.add(draftProjectId)
    }

    // Build groups from chats + drafts
    for (const key of groupOrder) {
      const chats = groupMap.get(key) ?? []
      const groupDrafts = draftMap.get(key) ?? []
      const firstChat = chats[0]
      const projectIdFromKey = key.startsWith("proj:") ? key.slice(5) : null
      const project = firstChat?.projectId
        ? projectsMap.get(firstChat.projectId)
        : projectIdFromKey
          ? projectsMap.get(projectIdFromKey)
          : null

      let label = key
      if (key === "ungrouped") {
        label = "Unlinked"
      } else if (project) {
        const owner = project.gitOwner
        const repo = project.gitRepo || project.name
        label = owner && repo ? `${owner}/${repo}` : repo || project.name || key
      }

      groups.push({
        key,
        label,
        projectId: firstChat?.projectId ?? projectIdFromKey,
        chats,
        drafts: groupDrafts,
      })
    }

    // Add projects that have no chats (show as empty groups)
    if (projects) {
      for (const project of projects) {
        if (!projectIdsWithChats.has(project.id)) {
          const owner = project.gitOwner
          const repo = project.gitRepo || project.name
          const label = owner && repo ? `${owner}/${repo}` : repo || project.name || "Project"
          groups.push({
            key: `proj:${project.id}`,
            label,
            projectId: project.id,
            chats: [],
            drafts: [],
          })
        }
      }
    }

    // When a project is selected via the projects rail, only show that project's group.
    // The rail is the primary project nav; the secondary nav scopes to the picked project.
    if (selectedProject?.id) {
      const scopedKey = `proj:${selectedProject.id}`
      return groups.filter((g) => g.key === scopedKey)
    }

    return groups
  }, [filteredChats, projectsMap, projects, drafts, selectedProject?.id])

  // Group archived chats by project key for the per-group Archived section
  const archivedByProject = useMemo(() => {
    const map = new Map<string, NonNullable<typeof archivedChats>>()
    if (!archivedChats) return map
    for (const chat of archivedChats) {
      const key = chat.projectId ? `proj:${chat.projectId}` : "ungrouped"
      if (!map.has(key)) map.set(key, [])
      map.get(key)?.push(chat)
    }
    return map
  }, [archivedChats])

  // Handle bulk archive of selected chats
  const handleBulkArchive = useCallback(() => {
    const chatIdsToArchive = Array.from(selectedChatIds)
    if (chatIdsToArchive.length === 0) return

    // If active chat is being archived, navigate to previous or new workspace
    const isArchivingActiveChat = selectedChatId && chatIdsToArchive.includes(selectedChatId)

    archiveChatsBatchMutation.mutate(
      { chatIds: chatIdsToArchive },
      {
        onSuccess: () => {
          if (isArchivingActiveChat) {
            // Check if previous chat is available (exists and not being archived)
            const remainingChats = filteredChats.filter((c) => !chatIdsToArchive.includes(c.id))
            const isPreviousAvailable =
              previousChatId && remainingChats.some((c) => c.id === previousChatId)

            if (isPreviousAvailable) {
              setSelectedChatId(previousChatId)
            } else {
              setSelectedChatId(null)
            }
          }
          clearChatSelection()
        },
      },
    )
  }, [
    selectedChatIds,
    selectedChatId,
    previousChatId,
    filteredChats,
    archiveChatsBatchMutation,
    setSelectedChatId,
    clearChatSelection,
  ])

  const handleArchiveAllBelow = useCallback(
    (chatId: string) => {
      const currentIndex = filteredChats.findIndex((c) => c.id === chatId)
      if (currentIndex === -1 || currentIndex === filteredChats.length - 1) return

      const chatsBelow = filteredChats.slice(currentIndex + 1)
      const chatIds = chatsBelow.map((c) => c.id)

      if (chatIds.length > 0) {
        archiveChatsBatchMutation.mutate({ chatIds })
      }
    },
    [filteredChats, archiveChatsBatchMutation],
  )

  const handleArchiveOthers = useCallback(
    (chatId: string) => {
      const otherChats = filteredChats.filter((c) => c.id !== chatId)
      const chatIds = otherChats.map((c) => c.id)

      if (chatIds.length > 0) {
        archiveChatsBatchMutation.mutate({ chatIds })
      }
    },
    [filteredChats, archiveChatsBatchMutation],
  )

  // Delete a draft from localStorage
  const handleDeleteDraft = useCallback(
    (draftId: string) => {
      deleteNewChatDraft(draftId)
      // If the deleted draft was selected, clear selection
      if (selectedDraftId === draftId) {
        setSelectedDraftId(null)
      }
    },
    [selectedDraftId, setSelectedDraftId],
  )

  // Select a draft for editing
  const handleDraftSelect = useCallback(
    (draftId: string) => {
      // Navigate to NewChatForm with this draft selected
      setSelectedChatId(null)
      setSelectedDraftId(draftId)
      setShowNewChatForm(false) // Clear explicit new chat state when selecting a draft
    },
    [setSelectedChatId, setSelectedDraftId, setShowNewChatForm],
  )

  // Reset focused index when search query changes
  useEffect(() => {
    setFocusedChatIndex(-1)
  }, [])

  // Scroll focused item into view
  useEffect(() => {
    if (focusedChatIndex >= 0 && filteredChats.length > 0) {
      const focusedElement = scrollContainerRef.current?.querySelector(
        `[data-chat-index="${focusedChatIndex}"]`,
      ) as HTMLElement
      if (focusedElement) {
        focusedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        })
      }
    }
  }, [focusedChatIndex, filteredChats.length])

  // Derive which chats have loading sub-chats
  const loadingChatIds = useMemo(() => new Set([...loadingSubChats.values()]), [loadingSubChats])

  // Convert file stats to a Map for easy lookup
  const workspaceFileStats = useMemo(() => {
    const statsMap = new Map<string, { fileCount: number; additions: number; deletions: number }>()

    // Use stats from DB query
    if (fileStatsData) {
      for (const stat of fileStatsData) {
        statsMap.set(stat.chatId, {
          fileCount: stat.fileCount,
          additions: stat.additions,
          deletions: stat.deletions,
        })
      }
    }

    return statsMap
  }, [fileStatsData])

  // Aggregate pending plan approvals by workspace (chatId) from DB
  const workspacePendingPlans = useMemo(() => {
    const chatIdsWithPendingPlans = new Set<string>()
    if (pendingPlanApprovalsData) {
      for (const { chatId } of pendingPlanApprovalsData) {
        chatIdsWithPendingPlans.add(chatId)
      }
    }
    return chatIdsWithPendingPlans
  }, [pendingPlanApprovalsData])

  // Get workspace IDs that have pending user questions
  const workspacePendingQuestions = useMemo(() => {
    const chatIds = new Set<string>()
    for (const question of pendingQuestions.values()) {
      chatIds.add(question.parentChatId)
    }
    return chatIds
  }, [pendingQuestions])

  const handleNewAgent = () => {
    triggerHaptic("light")
    // Bump the reset counter first so an in-progress draft in the current
    // NewChatForm gets persisted via its unmount cleanup (markDraftVisible)
    // and a fresh blank form is mounted, even when already on the new chat view.
    requestNewChatFormReset()
    setSelectedChatId(null)
    setSelectedDraftId(null) // Clear selected draft so form starts empty
    setShowNewChatForm(true) // Explicitly show new chat form
    setDesktopView(null) // Clear automations/inbox view
  }

  const handleChatClick = useCallback(
    async (chatId: string, e?: React.MouseEvent, globalIndex?: number) => {
      // Shift+click for range selection (works in both normal and multi-select mode)
      if (e?.shiftKey) {
        e.preventDefault()

        const clickedIndex = globalIndex ?? filteredChats.findIndex((c) => c.id === chatId)

        if (clickedIndex === -1) return

        // Find the anchor: use active chat or last selected item
        let anchorIndex = -1

        // First try: use currently active/selected chat as anchor
        if (selectedChatId) {
          anchorIndex = filteredChats.findIndex((c) => c.id === selectedChatId)
        }

        // If no active chat, try to use the last item in selection
        if (anchorIndex === -1 && selectedChatIds.size > 0) {
          // Find the first selected item in the list as anchor
          for (let i = 0; i < filteredChats.length; i++) {
            if (selectedChatIds.has(filteredChats[i]?.id)) {
              anchorIndex = i
              break
            }
          }
        }

        // If still no anchor, just select the clicked item
        if (anchorIndex === -1) {
          if (!selectedChatIds.has(chatId)) {
            toggleChatSelection(chatId)
          }
          return
        }

        // Select range from anchor to clicked item
        const startIndex = Math.min(anchorIndex, clickedIndex)
        const endIndex = Math.max(anchorIndex, clickedIndex)

        // Build new selection set with the range
        const newSelection = new Set(selectedChatIds)
        for (let i = startIndex; i <= endIndex; i++) {
          const chat = filteredChats[i]
          if (chat) {
            newSelection.add(chat.id)
          }
        }
        setSelectedChatIds(newSelection)
        return
      }

      // In multi-select mode, clicking on the item still navigates to the chat
      // Only clicking on the checkbox toggles selection

      // Prevent opening same chat in multiple windows.
      // Claim new chat BEFORE releasing old one — if claim fails, we keep the current chat.
      if (window.desktopApi?.claimChat) {
        const result = await window.desktopApi.claimChat(chatId)
        if (!result.ok) {
          toast.info("This workspace is already open in another window", {
            description: "Switching to the existing window.",
            duration: 3000,
          })
          await window.desktopApi.focusChatOwner(chatId)
          return
        }
        // Release old chat only after new one is successfully claimed
        if (selectedChatId && selectedChatId !== chatId) {
          await window.desktopApi.releaseChat(selectedChatId)
        }
      }

      setSelectedChatId(chatId)
      setShowNewChatForm(false) // Clear new chat form state when selecting a workspace
      setDesktopView(null) // Clear automations/inbox view when selecting a chat

      // Toggle expand/collapse when re-clicking an already-selected workspace
      if (selectedChatId === chatId) {
        handleToggleExpand(chatId)
      }
    },
    [
      filteredChats,
      selectedChatId,
      selectedChatIds,
      toggleChatSelection,
      setSelectedChatIds,
      setSelectedChatId,
      setShowNewChatForm,
      setDesktopView,
      handleToggleExpand,
    ],
  )

  const formatTime = useCallback((dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60_000)
    const diffHours = Math.floor(diffMs / 3_600_000)
    const diffDays = Math.floor(diffMs / 86_400_000)

    if (diffMins < 1) return "now"
    if (diffMins < 60) return `${diffMins}m`
    if (diffHours < 24) return `${diffHours}h`
    if (diffDays < 7) return `${diffDays}d`
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w`
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo`
    return `${Math.floor(diffDays / 365)}y`
  }, [])

  // Archive single chat - wrapped for memoized component
  // Checks for active terminal processes and worktree, shows confirmation dialog if needed
  const handleArchiveSingle = useCallback(
    async (chatId: string) => {
      const chat = agentChats?.find((c) => c.id === chatId)

      // Fetch both session count and worktree status in parallel
      const isLocalMode = !chat?.branch
      const [sessionCount, worktreeStatus] = await Promise.all([
        // Local mode: terminals are shared and won't be killed on archive, so skip count
        isLocalMode
          ? Promise.resolve(0)
          : utils.terminal.getActiveSessionCount.fetch({ workspaceId: chatId }),
        utils.chats.getWorktreeStatus.fetch({ chatId }),
      ])

      const needsConfirmation = sessionCount > 0 || worktreeStatus.hasWorktree

      if (needsConfirmation) {
        // Show confirmation dialog
        setArchivingChatId(chatId)
        setActiveProcessCount(sessionCount)
        setHasWorktree(worktreeStatus.hasWorktree)
        setUncommittedCount(worktreeStatus.uncommittedCount)
        setConfirmArchiveDialogOpen(true)
      } else {
        // No active processes and no worktree, archive directly
        archiveChatMutation.mutate({ id: chatId })
      }
    },
    [
      agentChats,
      archiveChatMutation,
      utils.terminal.getActiveSessionCount,
      utils.chats.getWorktreeStatus,
    ],
  )

  // Confirm archive after user accepts dialog (optimistic - closes immediately)
  const handleConfirmArchive = useCallback(
    (deleteWorktree: boolean) => {
      if (archivingChatId) {
        archiveChatMutation.mutate({ id: archivingChatId, deleteWorktree })
        setArchivingChatId(null)
      }
    },
    [archiveChatMutation, archivingChatId],
  )

  // Close archive confirmation dialog
  const handleCloseArchiveDialog = useCallback(() => {
    setConfirmArchiveDialogOpen(false)
    setArchivingChatId(null)
  }, [])

  // Copy branch name to clipboard
  const handleCopyBranch = useCallback((branch: string) => {
    navigator.clipboard.writeText(branch)
    toast.success("Branch name copied", { description: branch })
  }, [])

  // Ref callback for name elements
  const nameRefCallback = useCallback((chatId: string, el: HTMLSpanElement | null) => {
    if (el) {
      nameRefs.current.set(chatId, el)
    }
  }, [])

  // Handle agent card hover for truncated name tooltip (1s delay)
  // Uses DOM manipulation instead of state to avoid re-renders
  const handleAgentMouseEnter = useCallback(
    (chatId: string, name: string | null, cardElement: HTMLElement, globalIndex: number) => {
      // Update hovered index ref
      hoveredChatIndexRef.current = globalIndex

      // Clear any existing timer
      if (agentTooltipTimerRef.current) {
        clearTimeout(agentTooltipTimerRef.current)
      }

      const nameEl = nameRefs.current.get(chatId)
      if (!nameEl) return

      // Check if name is truncated
      const isTruncated = nameEl.scrollWidth > nameEl.clientWidth
      if (!isTruncated) return

      // Show tooltip after 1 second delay via DOM manipulation (no state update)
      agentTooltipTimerRef.current = setTimeout(() => {
        const tooltip = agentTooltipRef.current
        if (!tooltip) return

        const rect = cardElement.getBoundingClientRect()
        tooltip.style.display = "block"
        tooltip.style.top = `${rect.top + rect.height / 2}px`
        tooltip.style.left = `${rect.right + 8}px`
        tooltip.textContent = name || ""
      }, 1000)
    },
    [],
  )

  const handleAgentMouseLeave = useCallback(() => {
    // Reset hovered index
    hoveredChatIndexRef.current = -1
    // Clear timer if hovering ends before delay
    if (agentTooltipTimerRef.current) {
      clearTimeout(agentTooltipTimerRef.current)
      agentTooltipTimerRef.current = null
    }
    // Hide tooltip via DOM manipulation (no state update)
    const tooltip = agentTooltipRef.current
    if (tooltip) {
      tooltip.style.display = "none"
    }
  }, [])

  // Update sidebar hover UI - DOM manipulation for close button, state for TrafficLights
  // TrafficLights component handles native traffic light visibility via its own effect
  // Update sidebar hover UI via DOM manipulation (no state update to avoid re-renders)
  const updateSidebarHoverUI = useCallback((hovered: boolean) => {
    isSidebarHoveredRef.current = hovered
    // Update close button opacity
    if (closeButtonRef.current) {
      closeButtonRef.current.style.opacity = hovered ? "1" : "0"
    }
  }, [])

  const handleSidebarMouseEnter = useCallback(() => {
    updateSidebarHoverUI(true)
  }, [updateSidebarHoverUI])

  const handleSidebarMouseLeave = useCallback(
    (e: React.MouseEvent) => {
      // Electron's drag region (WebkitAppRegion: "drag") returns a non-HTMLElement
      // object as relatedTarget. We preserve hover state in this case so the
      // traffic lights remain visible when hovering over the drag area.
      const relatedTarget = e.relatedTarget
      if (!relatedTarget || !(relatedTarget instanceof HTMLElement)) return
      const isStillInSidebar = relatedTarget.closest("[data-sidebar-content]")
      if (!isStillInSidebar) {
        updateSidebarHoverUI(false)
      }
    },
    [updateSidebarHoverUI],
  )

  // Check if scroll is needed and show/hide gradients via DOM manipulation
  React.useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const checkScroll = () => {
      const needsScroll = container.scrollHeight > container.clientHeight
      if (needsScroll) {
        if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "1"
        if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      } else {
        if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "0"
        if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      }
    }

    checkScroll()
    // Re-check when content might change
    const resizeObserver = new ResizeObserver(checkScroll)
    resizeObserver.observe(container)

    return () => resizeObserver.disconnect()
  }, [])

  // Direct listener for Cmd+K to focus search input
  useEffect(() => {
    const handleSearchHotkey = (e: KeyboardEvent) => {
      // Check for Cmd+K or Ctrl+K (only for search functionality)
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyK" && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()

        // Reveal the input (search icon was removed) and focus it
        setIsSearchOpen(true)
        requestAnimationFrame(() => {
          searchInputRef.current?.focus()
          searchInputRef.current?.select()
        })
      }
    }

    window.addEventListener("keydown", handleSearchHotkey, true)

    return () => {
      window.removeEventListener("keydown", handleSearchHotkey, true)
    }
  }, [])

  // Multi-select hotkeys
  // X to toggle selection of hovered or focused chat
  useHotkeys("x", () => {
    if (!filteredChats || filteredChats.length === 0) return

    // Prefer hovered, then focused - do NOT fallback to 0 (would conflict with sub-chat sidebar)
    const targetIndex =
      hoveredChatIndexRef.current >= 0
        ? hoveredChatIndexRef.current
        : focusedChatIndex >= 0
          ? focusedChatIndex
          : -1

    if (targetIndex >= 0 && targetIndex < filteredChats.length) {
      const chatId = filteredChats[targetIndex]?.id
      // Toggle selection (both select and deselect)
      toggleChatSelection(chatId)
    }
  }, [filteredChats, focusedChatIndex, toggleChatSelection])

  // Cmd+A / Ctrl+A to select all chats (only when at least one is already selected)
  useHotkeys(
    "mod+a",
    (e) => {
      if (isMultiSelectMode && filteredChats && filteredChats.length > 0) {
        e.preventDefault()
        selectAllChats(filteredChats.map((c) => c.id))
      }
    },
    [filteredChats, selectAllChats, isMultiSelectMode],
  )

  // Escape to clear selection
  useHotkeys("escape", () => {
    if (isMultiSelectMode) {
      clearChatSelection()
      setFocusedChatIndex(-1)
    }
  }, [isMultiSelectMode, clearChatSelection])

  // Cmd+E to archive current workspace (desktop) or Opt+Cmd+E (web)
  useEffect(() => {
    const handleArchiveHotkey = (e: KeyboardEvent) => {
      const isDesktop = isDesktopApp()

      // Desktop: Cmd+E (without Alt)
      const isDesktopShortcut =
        isDesktop && e.metaKey && e.code === "KeyE" && !e.altKey && !e.shiftKey && !e.ctrlKey
      // Web: Opt+Cmd+E (with Alt)
      const isWebShortcut = e.altKey && e.metaKey && e.code === "KeyE"

      if (isDesktopShortcut || isWebShortcut) {
        e.preventDefault()

        // If multi-select mode, bulk archive selected chats
        if (isMultiSelectMode && selectedChatIds.size > 0) {
          if (!archiveChatsBatchMutation.isPending) {
            handleBulkArchive()
          }
          return
        }

        // Otherwise archive current chat (with confirmation if has active processes)
        if (selectedChatId && !archiveChatMutation.isPending) {
          handleArchiveSingle(selectedChatId)
        }
      }
    }

    window.addEventListener("keydown", handleArchiveHotkey)
    return () => window.removeEventListener("keydown", handleArchiveHotkey)
  }, [
    selectedChatId,
    archiveChatMutation,
    isMultiSelectMode,
    selectedChatIds,
    archiveChatsBatchMutation,
    handleBulkArchive,
    handleArchiveSingle,
  ])

  // Clear selection when project changes
  useEffect(() => {
    clearChatSelection()
  }, [clearChatSelection])

  // Handle scroll for gradients - use DOM manipulation to avoid re-renders
  const handleAgentsScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget
    const needsScroll = scrollHeight > clientHeight

    if (!needsScroll) {
      if (topGradientRef.current) topGradientRef.current.style.opacity = "0"
      if (bottomGradientRef.current) bottomGradientRef.current.style.opacity = "0"
      return
    }

    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 5
    const isAtTop = scrollTop <= 5

    // Update gradient visibility via DOM (no setState = no re-render)
    if (topGradientRef.current) {
      topGradientRef.current.style.opacity = isAtTop ? "0" : "1"
    }
    if (bottomGradientRef.current) {
      bottomGradientRef.current.style.opacity = isAtBottom ? "0" : "1"
    }
  }, [])

  const sidebarContent = (
    /* biome-ignore lint/a11y/useSemanticElements: sidebar landmark section. */
    <div
      role="complementary"
      className={cn(
        "group/sidebar flex flex-col gap-0 overflow-hidden select-none h-full bg-tl-background",
      )}
      onMouseEnter={handleSidebarMouseEnter}
      onMouseLeave={handleSidebarMouseLeave}
      data-sidebar-content
    >
      {/* Header area */}
      <SidebarHeader
        isDesktop={isDesktop}
        isFullscreen={isFullscreen}
        desktopUser={desktopUser}
        onSignOut={onSignOut}
        onToggleSidebar={onToggleSidebar}
        setSettingsDialogOpen={setSettingsDialogOpen}
        setSettingsActiveTab={setSettingsActiveTab}
        handleSidebarMouseEnter={handleSidebarMouseEnter}
        handleSidebarMouseLeave={handleSidebarMouseLeave}
        closeButtonRef={closeButtonRef}
      />

      {/* Kanban nav (mausCode keep) */}
      <div className="px-3 pt-1">
        <KanbanButton />
      </div>

      {/* Navigation links - Inbox & Automations (null when beta-gated off) */}
      <div className="px-3 pt-1 flex-shrink-0 space-y-0.5">
        <InboxButton />
        <AutomationsButton />
      </div>

      {/* Hidden search input for keyboard-triggered search */}
      <Input
        ref={searchInputRef}
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault()
            setSearchQuery("")
            setIsSearchOpen(false)
            searchInputRef.current?.blur()
            setFocusedChatIndex(-1)
            return
          }
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setFocusedChatIndex((prev) =>
              prev === -1 ? 0 : Math.min(prev + 1, filteredChats.length - 1),
            )
            return
          }
          if (e.key === "ArrowUp") {
            e.preventDefault()
            setFocusedChatIndex((prev) =>
              prev === -1 ? filteredChats.length - 1 : Math.max(prev - 1, 0),
            )
            return
          }
          if (e.key === "Enter") {
            e.preventDefault()
            if (focusedChatIndex >= 0) {
              const focusedChat = filteredChats[focusedChatIndex]
              if (focusedChat) {
                handleChatClick(focusedChat.id)
                searchInputRef.current?.blur()
                setSearchQuery("")
                setFocusedChatIndex(-1)
              }
            }
            return
          }
        }}
        onBlur={() => {
          if (!searchQuery) {
            setFocusedChatIndex(-1)
            setIsSearchOpen(false)
          }
        }}
        className={cn(
          "rounded-md text-[12.5px] bg-transparent border border-border/30 placeholder:text-muted-foreground/25 focus:bg-foreground/[0.03] focus:border-border/60 focus-visible:ring-0 focus-visible:ring-offset-0 px-2.5 transition-all duration-150 mx-3 mb-1",
          searchQuery || isSearchOpen
            ? "h-7 opacity-100"
            : "h-0 opacity-0 overflow-hidden border-0 p-0 m-0",
        )}
      />

      {/* Project-grouped agents list */}
      <div className="flex-1 min-h-0 relative">
        <div
          ref={scrollContainerRef}
          onScroll={handleAgentsScroll}
          className="h-full overflow-y-auto scrollbar-thin scrollbar-thumb-muted-foreground/10 hover:scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent px-3"
        >
          {projectGroupedChats.map((group) => {
            const isGroupCollapsed = collapsedGroups.has(group.key)
            const groupHasUnseen = group.chats.some(
              (chat) =>
                unseenChanges.has(chat.id) || (chat as { isUnseen?: boolean }).isUnseen === true,
            )

            return (
              <div key={group.key}>
                {/* Project header */}
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    {/* biome-ignore lint/a11y/useSemanticElements: contains block-level layout; a native button would be invalid HTML. */}
                    <div
                      role="button"
                      className="group/project-header flex items-center gap-1 mt-4 first:mt-1 cursor-pointer"
                      tabIndex={0}
                      aria-expanded={!collapsedGroups.has(group.key)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault()
                          e.currentTarget.click()
                        }
                      }}
                      onClick={() =>
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(group.key)) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                      }
                    >
                      <span className="text-[14px] text-foreground/70 font-medium truncate flex-1 py-1">
                        {group.label}
                      </span>
                      {group.projectId && groupHasUnseen && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleMarkAllRead(group.projectId ?? undefined)
                          }}
                          disabled={markAllViewedMutation.isPending}
                          className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground/90 hover:bg-foreground/[0.05] transition-[background-color,color] duration-150 disabled:opacity-40"
                          aria-label="Mark all as read"
                          title="Mark all as read"
                        >
                          <Check size={14} strokeWidth={2.4} />
                        </button>
                      )}
                      {group.projectId && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const projectPath = projects?.find(
                                (p) => p.id === group.projectId,
                              )?.path
                              if (!projectPath) {
                                toast.error("Project path not found")
                                return
                              }
                              window.desktopApi.openFolder(projectPath).then((result) => {
                                if (!result?.success) {
                                  toast.error(result?.error || "Failed to open folder")
                                }
                              })
                            }}
                            className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground/90 opacity-80 group-hover/project-header:opacity-100 transition-opacity duration-150"
                            aria-label="Reveal in file manager"
                          >
                            <FolderOpen size={15} strokeWidth={2.2} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const projectPath = projects?.find(
                                (p) => p.id === group.projectId,
                              )?.path
                              if (!projectPath) {
                                toast.error("Project path not found")
                                return
                              }
                              window.desktopApi.openVSCode(projectPath).then((result) => {
                                if (!result?.success) {
                                  toast.error(result?.error || "Failed to open VS Code")
                                }
                              })
                            }}
                            className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground/90 opacity-80 group-hover/project-header:opacity-100 transition-opacity duration-150"
                            aria-label="Open in VS Code"
                          >
                            <Code size={15} strokeWidth={2.2} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              const projectPath = projects?.find(
                                (p) => p.id === group.projectId,
                              )?.path
                              if (!projectPath) {
                                toast.error("Project path not found")
                                return
                              }
                              window.desktopApi.openTerminal(projectPath).then((result) => {
                                if (!result?.success) {
                                  toast.error(result?.error || "Failed to open terminal")
                                }
                              })
                            }}
                            className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground/90 opacity-80 group-hover/project-header:opacity-100 transition-opacity duration-150"
                            aria-label="Open terminal"
                          >
                            <TerminalSquare size={15} strokeWidth={2.2} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedProject(
                                toSelectedProject(projects?.find((p) => p.id === group.projectId)),
                              )
                              handleNewAgent()
                            }}
                            className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded text-muted-foreground/55 hover:text-foreground/90 opacity-80 group-hover/project-header:opacity-100 transition-opacity duration-150"
                            aria-label="New agent"
                          >
                            <Plus size={15} strokeWidth={2.2} />
                          </button>
                        </>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem
                      onClick={() => {
                        setCollapsedGroups((prev) => {
                          const next = new Set(prev)
                          if (next.has(group.key)) next.delete(group.key)
                          else next.add(group.key)
                          return next
                        })
                      }}
                    >
                      {isGroupCollapsed ? "Expand" : "Collapse"}
                    </ContextMenuItem>
                    {group.projectId && (
                      <>
                        <ContextMenuItem
                          onClick={() => handleNavigateToSettings(group.projectId ?? "")}
                        >
                          Project settings
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            setSelectedProject(
                              toSelectedProject(projects?.find((p) => p.id === group.projectId)),
                            )
                            handleNewAgent()
                          }}
                        >
                          New agent
                        </ContextMenuItem>
                        {groupHasUnseen && (
                          <ContextMenuItem
                            onClick={() => handleMarkAllRead(group.projectId ?? undefined)}
                            disabled={markAllViewedMutation.isPending}
                          >
                            Mark all as read
                          </ContextMenuItem>
                        )}
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>

                {/* Agents list */}
                <AnimatePresence initial={false}>
                  {!isGroupCollapsed && (
                    <motion.div
                      key={`group-${group.key}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        height: TRANSITION_EXPAND,
                        opacity: { duration: 0.1, ease: EASE_OUT },
                      }}
                      className="overflow-hidden"
                    >
                      {/* In-progress drafts for this project — clicking restores the text */}
                      {group.drafts.length > 0 &&
                        group.drafts.map((draft) => (
                          <DraftItem
                            key={draft.id}
                            draftId={draft.id}
                            draftText={draft.text}
                            draftUpdatedAt={draft.updatedAt}
                            projectGitOwner={draft.project?.gitOwner}
                            projectGitProvider={draft.project?.gitProvider}
                            projectGitRepo={draft.project?.gitRepo}
                            projectName={draft.project?.name}
                            isSelected={selectedDraftId === draft.id}
                            isMultiSelectMode={isMultiSelectMode}
                            showIcon={showWorkspaceIcon}
                            onSelect={handleDraftSelect}
                            onDelete={handleDeleteDraft}
                            formatTime={formatTime}
                          />
                        ))}
                      {group.chats.length > 0 &&
                        (() => {
                          const globalIndexMap = new Map<string, number>()
                          filteredChats.forEach((c, i) => {
                            globalIndexMap.set(c.id, i)
                          })

                          const renderChatRow = (chat: ChatType) => {
                            const isSelected = selectedChatId === chat.id
                            const isLoading = loadingChatIds.has(chat.id)
                            const hasPendingQuestion =
                              workspacePendingQuestions.has(chat.id) ||
                              (!isLoading && chatsAwaitingAnswer.has(chat.id))
                            const hasPendingPlan = workspacePendingPlans.has(chat.id)
                            const isActive = isLoading || hasPendingQuestion || hasPendingPlan
                            const isPushed = !isActive && pushedChatIds.has(chat.id)
                            const hasUnseen =
                              !isActive &&
                              !isPushed &&
                              !isSelected &&
                              (unseenChanges.has(chat.id) ||
                                (chat as { isUnseen?: boolean }).isUnseen === true)
                            const isPinned = pinnedChatIds.has(chat.id)
                            const isChecked = selectedChatIds.has(chat.id)
                            const isExpanded = expandedWorkspaceIds.includes(chat.id)
                            const globalIndex = globalIndexMap.get(chat.id) ?? -1
                            const isFocused =
                              focusedChatIndex === globalIndex && focusedChatIndex >= 0
                            const isJustCreated = justCreatedIds.has(chat.id)
                            const stats = workspaceFileStats.get(chat.id)
                            const project = chat.projectId ? projectsMap.get(chat.projectId) : null
                            const accentColor = (project?.accentColor ?? null) as string | null
                            const repoName = project?.gitRepo || project?.name
                            const displayText = chat.branch
                              ? repoName
                                ? `${repoName} • ${chat.branch}`
                                : chat.branch
                              : (repoName ?? "")

                            return (
                              <div key={chat.id}>
                                <ContextMenu>
                                  <ContextMenuTrigger asChild>
                                    {/* biome-ignore lint/a11y/useSemanticElements: row contains nested action buttons; button-in-button is invalid HTML */}
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      data-chat-item
                                      data-chat-index={globalIndex}
                                      onClick={(e) => handleChatClick(chat.id, e, globalIndex)}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                          e.preventDefault()
                                          handleChatClick(
                                            chat.id,
                                            e as unknown as React.MouseEvent,
                                            globalIndex,
                                          )
                                        }
                                      }}
                                      onMouseEnter={(e) =>
                                        handleAgentMouseEnter(
                                          chat.id,
                                          chat.name,
                                          e.currentTarget,
                                          globalIndex,
                                        )
                                      }
                                      onMouseLeave={handleAgentMouseLeave}
                                      style={
                                        accentColor
                                          ? {
                                              borderLeftColor: accentColor,
                                              backgroundColor: `${accentColor}0a`,
                                            }
                                          : undefined
                                      }
                                      className={cn(
                                        "w-full text-left py-1.5 cursor-pointer group/agent relative",
                                        "transition-colors duration-75",
                                        "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
                                        accentColor ? "border-l-2 rounded-r-md" : "",
                                        isMultiSelectMode ? "px-3" : "pl-2 pr-2",
                                        !isMultiSelectMode && !accentColor && "rounded-md",
                                        isSelected || isFocused
                                          ? "bg-foreground/5 text-foreground"
                                          : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                                        isChecked && "bg-primary/10 hover:bg-primary/15",
                                      )}
                                    >
                                      <div className="flex items-start gap-2.5">
                                        <div className="pt-0.5">
                                          {isMultiSelectMode ? (
                                            <div className="w-[18px] h-[18px] flex items-center justify-center">
                                              <Checkbox
                                                checked={isChecked}
                                                onCheckedChange={() => toggleChatSelection(chat.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="cursor-pointer h-4 w-4"
                                              />
                                            </div>
                                          ) : (
                                            <div className="w-[18px] h-[18px] flex items-center justify-center">
                                              <AnimatePresence mode="wait" initial={false}>
                                                {hasPendingQuestion ? (
                                                  <motion.span
                                                    key="question"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    aria-label="Awaiting your answer"
                                                    className="flex items-center justify-center text-blue-500"
                                                  >
                                                    <QuestionIcon className="w-3.5 h-3.5 text-blue-500" />
                                                  </motion.span>
                                                ) : hasPendingPlan ? (
                                                  <motion.span
                                                    key="plan"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    aria-label="Plan ready"
                                                    className="flex items-center justify-center"
                                                  >
                                                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                                                  </motion.span>
                                                ) : isLoading ? (
                                                  <motion.span
                                                    key="active"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    className="flex items-center justify-center text-muted-foreground"
                                                  >
                                                    <GridPulseSpinner size={12} />
                                                  </motion.span>
                                                ) : isPushed ? (
                                                  <motion.span
                                                    key="pushed"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    aria-label="Pushed"
                                                    className="flex items-center justify-center text-emerald-500"
                                                  >
                                                    <Check size={12} strokeWidth={2.5} />
                                                  </motion.span>
                                                ) : hasUnseen ? (
                                                  <motion.span
                                                    key="unseen"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    aria-label="Done — unread"
                                                    className="flex items-center justify-center"
                                                  >
                                                    <span className="w-2 h-2 rounded-full bg-[#307BD0]" />
                                                  </motion.span>
                                                ) : (
                                                  <motion.span
                                                    key="idle"
                                                    initial={{ opacity: 0, scale: 0.85 }}
                                                    animate={{ opacity: 1, scale: 1 }}
                                                    exit={{ opacity: 0, scale: 0.85 }}
                                                    transition={{
                                                      duration: DURATION_INSTANT,
                                                      ease: EASE_OUT,
                                                    }}
                                                    className="flex items-center justify-center"
                                                  >
                                                    <span
                                                      className={cn(
                                                        "w-[6px] h-[6px] rounded-full",
                                                        isSelected
                                                          ? "bg-muted-foreground/50"
                                                          : "bg-muted-foreground/25",
                                                      )}
                                                    />
                                                  </motion.span>
                                                )}
                                              </AnimatePresence>
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                                          <div className="flex items-center gap-1">
                                            <span
                                              ref={(el) => nameRefCallback(chat.id, el)}
                                              className="truncate block text-sm leading-tight flex-1"
                                            >
                                              <TypewriterText
                                                text={chat.name || ""}
                                                placeholder="New workspace"
                                                id={chat.id}
                                                isJustCreated={isJustCreated}
                                                showPlaceholder={true}
                                              />
                                            </span>
                                            {!isMultiSelectMode && (
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  handleToggleExpand(chat.id)
                                                }}
                                                tabIndex={-1}
                                                aria-label={
                                                  isExpanded ? "Collapse threads" : "Expand threads"
                                                }
                                                className={cn(
                                                  "flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center text-muted-foreground/50 hover:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 group-hover/agent:opacity-100",
                                                  isExpanded && "opacity-100",
                                                )}
                                              >
                                                <ChevronRight
                                                  size={11}
                                                  strokeWidth={2.2}
                                                  className={cn(
                                                    "transition-transform duration-150",
                                                    isExpanded && "rotate-90",
                                                  )}
                                                />
                                              </button>
                                            )}
                                            {!isMultiSelectMode && (
                                              <div className="flex-shrink-0 w-3.5 h-3.5 flex items-center justify-center relative">
                                                <button
                                                  type="button"
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    handleArchiveSingle(chat.id)
                                                  }}
                                                  tabIndex={-1}
                                                  className="absolute inset-0 flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground transition-[opacity,transform,color] duration-150 ease-out opacity-0 scale-95 pointer-events-none group-hover/agent:opacity-100 group-hover/agent:scale-100 group-hover/agent:pointer-events-auto active:scale-[0.97]"
                                                  aria-label="Archive workspace"
                                                >
                                                  <ArchiveIcon className="h-3.5 w-3.5" />
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground/60 min-w-0">
                                            <span className="truncate flex-1 min-w-0">
                                              {displayText}
                                            </span>
                                            <div className="flex items-center gap-1.5 flex-shrink-0">
                                              {stats &&
                                                (stats.additions > 0 || stats.deletions > 0) && (
                                                  <>
                                                    <span className="text-green-600 dark:text-green-400">
                                                      +{stats.additions}
                                                    </span>
                                                    <span className="text-red-600 dark:text-red-400">
                                                      -{stats.deletions}
                                                    </span>
                                                  </>
                                                )}
                                              <span>
                                                {formatTime(
                                                  chat.updatedAt?.toISOString() ??
                                                    new Date().toISOString(),
                                                )}
                                              </span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent className="w-48">
                                    {isMultiSelectMode && isChecked ? (
                                      <>
                                        {canShowPinOption && (
                                          <>
                                            <ContextMenuItem
                                              onClick={
                                                areAllSelectedPinned
                                                  ? handleBulkUnpin
                                                  : handleBulkPin
                                              }
                                            >
                                              {areAllSelectedPinned
                                                ? `Unpin ${selectedChatIds.size} ${pluralize(selectedChatIds.size, "workspace")}`
                                                : `Pin ${selectedChatIds.size} ${pluralize(selectedChatIds.size, "workspace")}`}
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                          </>
                                        )}
                                        <ContextMenuItem
                                          onClick={handleBulkArchive}
                                          disabled={archiveChatsBatchMutation.isPending}
                                        >
                                          {archiveChatsBatchMutation.isPending
                                            ? "Archiving..."
                                            : `Archive ${selectedChatIds.size} ${pluralize(selectedChatIds.size, "workspace")}`}
                                        </ContextMenuItem>
                                      </>
                                    ) : (
                                      <>
                                        <ContextMenuItem onClick={() => handleTogglePin(chat.id)}>
                                          {isPinned ? "Unpin workspace" : "Pin workspace"}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() =>
                                            handleRenameClick({ id: chat.id, name: chat.name })
                                          }
                                        >
                                          Rename workspace
                                        </ContextMenuItem>
                                        {chat.branch && (
                                          <ContextMenuItem
                                            onClick={() => handleCopyBranch(chat.branch ?? "")}
                                          >
                                            Copy branch name
                                          </ContextMenuItem>
                                        )}
                                        <ContextMenuSub>
                                          <ContextMenuSubTrigger>
                                            Export workspace
                                          </ContextMenuSubTrigger>
                                          <ContextMenuSubContent sideOffset={6} alignOffset={-4}>
                                            <ContextMenuItem
                                              onClick={() =>
                                                exportChat({ chatId: chat.id, format: "markdown" })
                                              }
                                            >
                                              Download as Markdown
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                              onClick={() =>
                                                exportChat({ chatId: chat.id, format: "json" })
                                              }
                                            >
                                              Download as JSON
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                              onClick={() =>
                                                exportChat({ chatId: chat.id, format: "text" })
                                              }
                                            >
                                              Download as Text
                                            </ContextMenuItem>
                                            <ContextMenuSeparator />
                                            <ContextMenuItem
                                              onClick={() =>
                                                copyChat({ chatId: chat.id, format: "markdown" })
                                              }
                                            >
                                              Copy as Markdown
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                              onClick={() =>
                                                copyChat({ chatId: chat.id, format: "json" })
                                              }
                                            >
                                              Copy as JSON
                                            </ContextMenuItem>
                                            <ContextMenuItem
                                              onClick={() =>
                                                copyChat({ chatId: chat.id, format: "text" })
                                              }
                                            >
                                              Copy as Text
                                            </ContextMenuItem>
                                          </ContextMenuSubContent>
                                        </ContextMenuSub>
                                        {isDesktop && (
                                          <ContextMenuItem
                                            onClick={async () => {
                                              const result = await window.desktopApi?.newWindow({
                                                chatId: chat.id,
                                              })
                                              if (result?.blocked) {
                                                toast.info(
                                                  "This workspace is already open in another window",
                                                  {
                                                    description:
                                                      "Switching to the existing window.",
                                                    duration: 3000,
                                                  },
                                                )
                                              }
                                            }}
                                          >
                                            Open in new window
                                          </ContextMenuItem>
                                        )}
                                        <ContextMenuSeparator />
                                        <ContextMenuItem
                                          onClick={() => handleArchiveSingle(chat.id)}
                                          className="justify-between"
                                        >
                                          Archive workspace
                                          {archiveWorkspaceHotkey && (
                                            <Kbd>{archiveWorkspaceHotkey}</Kbd>
                                          )}
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() => handleArchiveAllBelow(chat.id)}
                                          disabled={globalIndex === filteredChats.length - 1}
                                        >
                                          Archive all below
                                        </ContextMenuItem>
                                        <ContextMenuItem
                                          onClick={() => handleArchiveOthers(chat.id)}
                                          disabled={filteredChats.length === 1}
                                        >
                                          Archive others
                                        </ContextMenuItem>
                                      </>
                                    )}
                                  </ContextMenuContent>
                                </ContextMenu>
                                {isExpanded && !isMultiSelectMode && (
                                  <WorkspaceSubChats
                                    chatId={chat.id}
                                    searchQuery={searchQuery}
                                    onSubChatSelect={handleSubChatSelect}
                                    accentColor={accentColor}
                                    onNewThread={handleCreateSubChat}
                                  />
                                )}
                              </div>
                            )
                          }

                          const pinnedChats = group.chats.filter((chat) =>
                            pinnedChatIds.has(chat.id),
                          )
                          const unpinnedChats = group.chats.filter(
                            (chat) => !pinnedChatIds.has(chat.id),
                          )

                          const statusBuckets: Array<{
                            key: string
                            label: string
                            chats: ChatType[]
                          }> = [
                            { key: "in-progress", label: "In progress", chats: [] },
                            { key: "question", label: "Question", chats: [] },
                            { key: "done", label: "Done", chats: [] },
                            { key: "pushed", label: "Committed + pushed", chats: [] },
                          ]
                          for (const chat of unpinnedChats) {
                            const isLoading = loadingChatIds.has(chat.id)
                            const hasPendingQuestion =
                              workspacePendingQuestions.has(chat.id) ||
                              (!isLoading && chatsAwaitingAnswer.has(chat.id))
                            const hasPendingPlan = workspacePendingPlans.has(chat.id)
                            const isActive = isLoading || hasPendingQuestion || hasPendingPlan
                            const isPushed = !isActive && pushedChatIds.has(chat.id)

                            if (hasPendingQuestion || hasPendingPlan)
                              statusBuckets[1]?.chats.push(chat)
                            else if (isLoading) statusBuckets[0]?.chats.push(chat)
                            else if (isPushed) statusBuckets[3]?.chats.push(chat)
                            else statusBuckets[2]?.chats.push(chat)
                          }

                          return (
                            <>
                              {pinnedChats.length > 0 && (
                                <div className="mt-1 first:mt-0">
                                  <div className="flex items-center px-3 pt-1.5 pb-0.5 select-none">
                                    <span className="flex-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                      Pinned
                                    </span>
                                  </div>
                                  {pinnedChats.map(renderChatRow)}
                                </div>
                              )}
                              {statusBuckets
                                .filter((bucket) => bucket.chats.length > 0)
                                .map((bucket) => {
                                  const canArchiveAll =
                                    bucket.key === "done" || bucket.key === "pushed"
                                  return (
                                    <div key={bucket.key} className="mt-1 first:mt-0">
                                      <div className="group/bucket-header flex items-center px-3 pt-1.5 pb-0.5 select-none">
                                        <span className="flex-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                          {bucket.label}
                                        </span>
                                        {canArchiveAll && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              const chatIds = bucket.chats.map((c) => c.id)
                                              if (chatIds.length === 0) return
                                              const isArchivingActiveChat = selectedChatId
                                                ? chatIds.includes(selectedChatId)
                                                : false
                                              archiveChatsBatchMutation.mutate(
                                                { chatIds },
                                                {
                                                  onSuccess: () => {
                                                    if (isArchivingActiveChat) {
                                                      const remainingChats = filteredChats.filter(
                                                        (c) => !chatIds.includes(c.id),
                                                      )
                                                      const isPreviousAvailable =
                                                        previousChatId &&
                                                        remainingChats.some(
                                                          (c) => c.id === previousChatId,
                                                        )
                                                      setSelectedChatId(
                                                        isPreviousAvailable ? previousChatId : null,
                                                      )
                                                    }
                                                  },
                                                },
                                              )
                                            }}
                                            disabled={archiveChatsBatchMutation.isPending}
                                            className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground/85 opacity-0 group-hover/bucket-header:opacity-100 transition-opacity duration-150 disabled:opacity-30"
                                            aria-label={`Archive all ${bucket.label.toLowerCase()}`}
                                            title={`Archive all ${bucket.label.toLowerCase()}`}
                                          >
                                            <Archive size={13} strokeWidth={2} />
                                          </button>
                                        )}
                                      </div>
                                      {bucket.chats.map(renderChatRow)}
                                    </div>
                                  )
                                })}
                            </>
                          )
                        })()}

                      {/* Archived chats section (default collapsed) */}
                      {(() => {
                        const archivedInGroup = archivedByProject.get(group.key) ?? []
                        if (archivedInGroup.length === 0) return null
                        const isArchiveExpanded = expandedArchiveGroups.has(group.key)
                        return (
                          <div className="mt-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setExpandedArchiveGroups((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(group.key)) next.delete(group.key)
                                  else next.add(group.key)
                                  return next
                                })
                              }}
                              className="group/archive-header w-full flex items-center px-3 pt-1.5 pb-0.5 select-none text-left hover:bg-foreground/[0.02] rounded transition-colors duration-100"
                              aria-expanded={isArchiveExpanded}
                              aria-label={
                                isArchiveExpanded ? "Collapse archived" : "Expand archived"
                              }
                            >
                              <ChevronRight
                                size={11}
                                strokeWidth={2.2}
                                className={cn(
                                  "flex-shrink-0 mr-1 text-muted-foreground/50 transition-transform duration-150",
                                  isArchiveExpanded && "rotate-90",
                                )}
                              />
                              <span className="flex-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                                Archived ({archivedInGroup.length})
                              </span>
                            </button>
                            <AnimatePresence initial={false}>
                              {isArchiveExpanded && (
                                <motion.div
                                  key={`archived-${group.key}`}
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{
                                    height: TRANSITION_EXPAND,
                                    opacity: { duration: 0.1, ease: EASE_OUT },
                                  }}
                                  className="overflow-hidden"
                                >
                                  {archivedInGroup.map((chat) => {
                                    const handleRestore = () => {
                                      if (restoreChatMutation.isPending) return
                                      restoreChatMutation.mutate({ id: chat.id })
                                    }
                                    return (
                                      // biome-ignore lint/a11y/useSemanticElements: row contains a nested action button; button-in-button is invalid HTML
                                      <div
                                        key={chat.id}
                                        role="button"
                                        tabIndex={0}
                                        onClick={handleRestore}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault()
                                            handleRestore()
                                          }
                                        }}
                                        className="group/archived-row flex items-center gap-3 w-full pl-3 pr-3 py-2 rounded-lg text-[14px] text-left cursor-pointer transition-[background-color,color] duration-100 ease-out text-muted-foreground/50 hover:bg-foreground/[0.04] hover:text-foreground/80"
                                        title="Click to restore"
                                      >
                                        <span className="flex-shrink-0 flex items-center justify-center w-[18px] h-[18px] text-muted-foreground/40">
                                          <Archive size={12} strokeWidth={1.8} />
                                        </span>
                                        <span className="truncate flex-1">
                                          {chat.name || "Untitled"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleRestore()
                                          }}
                                          disabled={restoreChatMutation.isPending}
                                          className="flex-shrink-0 h-5 w-5 flex items-center justify-center rounded text-muted-foreground/35 hover:text-foreground/80 opacity-0 group-hover/archived-row:opacity-100 transition-opacity duration-150 disabled:opacity-30"
                                          aria-label="Restore from archive"
                                          title="Restore"
                                        >
                                          <ArchiveRestore size={12} strokeWidth={1.8} />
                                        </button>
                                      </div>
                                    )
                                  })}
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        )
                      })()}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          })}

          {/* Empty state when no projects have chats */}
          {projectGroupedChats.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground/30 text-[13px]">
              No workspaces yet
            </div>
          )}
        </div>

        {/* Top gradient */}
        <div
          ref={topGradientRef}
          className="absolute top-0 left-0 right-0 h-10 pointer-events-none bg-gradient-to-b from-tl-background via-tl-background/50 to-transparent transition-opacity duration-150 opacity-0"
        />
        {/* Bottom gradient */}
        <div
          ref={bottomGradientRef}
          className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none bg-gradient-to-t from-tl-background via-tl-background/50 to-transparent transition-opacity duration-150 opacity-0"
        />
      </div>

      {/* Footer - multi-select toolbar or usage stats */}
      {isMultiSelectMode ? (
        <div className="p-2 flex flex-col gap-2">
          {/* Selection info */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">{selectedChatsCount} selected</span>
            <button
              type="button"
              onClick={clearChatSelection}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBulkArchive}
              disabled={archiveChatsBatchMutation.isPending}
              className="flex-1 h-8 gap-1.5 text-xs rounded-lg"
            >
              <ArchiveIcon className="h-3.5 w-3.5" />
              {archiveChatsBatchMutation.isPending ? "Archiving..." : "Archive"}
            </Button>
          </div>
        </div>
      ) : (
        <UsageStatsFooter />
      )}
    </div>
  )

  return (
    <>
      {sidebarContent}

      {/* Agent name tooltip portal - always rendered, visibility controlled via ref/DOM */}
      {typeof document !== "undefined" &&
        createPortal(
          <div
            ref={agentTooltipRef}
            className="fixed z-[100000] max-w-xs px-2 py-1 text-xs bg-popover border border-border rounded-md shadow-lg dark pointer-events-none text-foreground/90 whitespace-nowrap"
            style={{
              display: "none",
              transform: "translateY(-50%)",
            }}
          />,
          document.body,
        )}

      {/* Rename Dialog */}
      <AgentsRenameSubChatDialog
        isOpen={renameDialogOpen}
        onClose={() => {
          setRenameDialogOpen(false)
          setRenamingChat(null)
        }}
        onSave={handleRenameSave}
        currentName={renamingChat?.name || ""}
        isLoading={renameLoading}
      />

      {/* Confirm Archive Dialog */}
      <ConfirmArchiveDialog
        isOpen={confirmArchiveDialogOpen}
        onClose={handleCloseArchiveDialog}
        onConfirm={handleConfirmArchive}
        activeProcessCount={activeProcessCount}
        hasWorktree={hasWorktree}
        uncommittedCount={uncommittedCount}
      />
    </>
  )
}
