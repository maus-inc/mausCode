/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. Icons remapped to lucide-react,
 * "1Code" user-facing strings rebranded to mausCode. See
 * openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3 Batch C).
 */
"use client"


import { useCallback, useMemo, useState } from "react"
import type { DragEvent } from "react"
import { useAtom, useAtomValue, useSetAtom } from "jotai"
import { toast } from "sonner"
import {
  ExternalLink,
  EyeOff,
  Folder,
  FolderOpen,
  LayoutGrid,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { LoadingDot } from "../../components/ui/icons"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../components/ui/context-menu"
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
import {
  selectedProjectAtom,
  desktopViewAtom,
  chatsAwaitingAnswerAtom,
  loadingSubChatsAtom,
} from "../agents/atoms"
import {
  agentsSidebarOpenAtom,
  isDesktopAtom,
  isFullscreenAtom,
} from "../../lib/atoms"

const RAIL_WIDTH = 56
// Reserve space at the top of the rail so the first button clears the
// macOS traffic-light buttons (only when running on desktop, non-fullscreen).
const TRAFFIC_LIGHTS_RESERVED_PX = 36

type ProjectRow = {
  id: string
  name: string
  path: string
  iconPath: string | null
  accentColor: string | null
  gitOwner: string | null
  gitRepo: string | null
  gitRemoteUrl: string | null
  gitProvider: string | null
  showInRail?: boolean
  inProgressCount?: number
  unseenCount?: number
}

// Each state has its own fixed corner so multiple states are visible at once
// (e.g. one chat finished + one chat still streaming both render dots).
//   top-left     → blue: awaiting the user's answer
//   bottom-left  → green: finished and unseen
//   bottom-right → loader: in-progress (streaming)
function StatusDots({
  inProgress,
  unseen,
  awaiting,
}: {
  inProgress: boolean
  unseen: boolean
  awaiting: boolean
}) {
  if (!inProgress && !unseen && !awaiting) return null
  const halo =
    "pointer-events-none absolute flex h-3 w-3 items-center justify-center rounded-full bg-background ring-1 ring-border/60"
  return (
    <>
      {awaiting && (
        <span aria-hidden className={cn(halo, "-top-0.5 -left-0.5")}>
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
        </span>
      )}
      {unseen && (
        <span aria-hidden className={cn(halo, "-bottom-0.5 -left-0.5")}>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
      )}
      {inProgress && (
        <span aria-hidden className={cn(halo, "-bottom-0.5 -right-0.5")}>
          <LoadingDot
            isLoading={true}
            className="h-2.5 w-2.5 text-muted-foreground"
          />
        </span>
      )}
    </>
  )
}

function projectInitial(project: Pick<ProjectRow, "name" | "gitRepo">) {
  const source = project.gitRepo || project.name || "?"
  const trimmed = source.trim()
  if (!trimmed) return "?"
  return trimmed.charAt(0).toUpperCase()
}

function projectLabel(project: Pick<ProjectRow, "name" | "gitOwner" | "gitRepo">) {
  if (project.gitOwner && project.gitRepo) {
    return `${project.gitOwner}/${project.gitRepo}`
  }
  return project.name
}

interface RailButtonProps {
  active?: boolean
  onClick: () => void
  tooltip: string
  children: React.ReactNode
  ariaLabel: string
  disabled?: boolean
}

function RailButton({
  active = false,
  onClick,
  tooltip,
  children,
  ariaLabel,
  disabled,
}: RailButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-pressed={active}
          className={cn(
            "relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-150",
            "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
            active
              ? "bg-foreground/10 text-foreground"
              : "text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        >
          {active && (
            <span
              aria-hidden
              className="absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-foreground"
            />
          )}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}

export function ProjectsRail() {
  const utils = trpc.useUtils()
  const { data: projects } = trpc.projects.listWithStatus.useQuery(undefined, {
    // Light polling so in-progress / unseen indicators stay fresh while the
    // app is open. Cheap query (small JS aggregation over local SQLite).
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
  // Awaiting-answer is tracked in a renderer-only Jotai Set<chatId>. We join
  // it with the chat→project mapping from chats.list so we can light up the
  // blue dot on the right project tile.
  const chatsAwaitingAnswer = useAtomValue(chatsAwaitingAnswerAtom)
  // Live streaming state lives in renderer memory (Map<subChatId, parentChatId>),
  // not the DB. The server-side inProgressCount can lag because subChats.streamId
  // isn't always populated during an active stream — so we OR this in to make
  // the loader dot reflect the immediate UI state.
  const loadingSubChats = useAtomValue(loadingSubChatsAtom)
  const { data: allChats } = trpc.chats.list.useQuery({})
  const [selectedProject, setSelectedProject] = useAtom(selectedProjectAtom)
  const setSidebarOpen = useSetAtom(agentsSidebarOpenAtom)
  const setDesktopView = useSetAtom(desktopViewAtom)
  const isDesktop = useAtomValue(isDesktopAtom)
  const isFullscreen = useAtomValue(isFullscreenAtom)
  const needsTrafficLightSpacer = isDesktop && isFullscreen !== true

  const sortedProjects = useMemo<ProjectRow[]>(() => {
    if (!projects) return []
    // Hide projects flagged as not-in-rail. `undefined` is treated as visible
    // so older rows behave correctly until the migration runs.
    return (projects as ProjectRow[]).filter((p) => p.showInRail !== false)
  }, [projects])

  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{
    id: string
    position: "before" | "after"
  } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ProjectRow | null>(null)

  const reorder = trpc.projects.reorder.useMutation({
    onError: () => {
      utils.projects.invalidate()
    },
  })

  const setShowInRail = trpc.projects.setShowInRail.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
    },
    onError: (err) => toast.error(err.message || "Failed to update visibility"),
  })

  const refreshGitInfo = trpc.projects.refreshGitInfo.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
      toast.success("Git info refreshed")
    },
    onError: (err) => toast.error(err.message || "Failed to refresh git info"),
  })

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
      utils.chats?.list?.invalidate?.()
      toast.success("Project removed")
    },
    onError: (err) => toast.error(err.message || "Failed to remove project"),
  })

  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (!project) return
      utils.projects.listWithStatus.setData(undefined, (oldData) => {
        const enriched = { ...project, inProgressCount: 0, unseenCount: 0 }
        if (!oldData) return [enriched]
        const exists = oldData.some((p) => p.id === project.id)
        if (exists) {
          return oldData.map((p) =>
            p.id === project.id ? { ...p, updatedAt: project.updatedAt } : p,
          )
        }
        return [enriched, ...oldData]
      })
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl ?? null,
        gitProvider: (project.gitProvider as
          | "github"
          | "gitlab"
          | "bitbucket"
          | null) ?? null,
        gitOwner: project.gitOwner ?? null,
        gitRepo: project.gitRepo ?? null,
      })
      setSidebarOpen(true)
    },
  })

  const handleSelectProject = useCallback(
    (project: ProjectRow) => {
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: (project.gitProvider as
          | "github"
          | "gitlab"
          | "bitbucket"
          | null) ?? null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setSidebarOpen(true)
    },
    [setSelectedProject, setSidebarOpen],
  )

  const handleSelectAll = useCallback(() => {
    setSelectedProject(null)
    setSidebarOpen(true)
  }, [setSelectedProject, setSidebarOpen])

  const handleAddProject = useCallback(() => {
    if (openFolder.isPending) return
    openFolder.mutate()
  }, [openFolder])

  const handleOpenSettings = useCallback(() => {
    setDesktopView("settings")
    setSidebarOpen(true)
  }, [setDesktopView, setSidebarOpen])

  const handleRevealInFinder = useCallback(async (project: ProjectRow) => {
    if (!window.desktopApi?.openFolder) {
      toast.error("Folder reveal is not supported")
      return
    }
    const result = await window.desktopApi.openFolder(project.path)
    if (!result?.success) {
      toast.error(result?.error || "Failed to open folder")
    }
  }, [])

  const handleHideFromRail = useCallback(
    (project: ProjectRow) => {
      setShowInRail.mutate({ id: project.id, showInRail: false })
      toast(`Hidden "${projectLabel(project)}" from rail`, {
        description: "Visible on the projects page",
      })
    },
    [setShowInRail],
  )

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return
    deleteProject.mutate({ id: pendingDelete.id })
    setPendingDelete(null)
  }, [pendingDelete, deleteProject])

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      setDraggedId(id)
      e.dataTransfer.effectAllowed = "move"
      try {
        e.dataTransfer.setData("text/plain", id)
      } catch {
        // noop — some browsers throw on setData during certain drag phases
      }
    },
    [],
  )

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      if (!draggedId || draggedId === id) return
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      const rect = e.currentTarget.getBoundingClientRect()
      const position: "before" | "after" =
        e.clientY - rect.top < rect.height / 2 ? "before" : "after"
      setDropTarget((prev) =>
        prev && prev.id === id && prev.position === position
          ? prev
          : { id, position },
      )
    },
    [draggedId],
  )

  const handleDragLeave = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      // Only clear when leaving the wrapper, not when entering child nodes
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setDropTarget((prev) => (prev?.id === id ? null : prev))
    },
    [],
  )

  const handleDragEnd = useCallback(() => {
    setDraggedId(null)
    setDropTarget(null)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault()
      const draggingId = draggedId
      const target = dropTarget
      setDraggedId(null)
      setDropTarget(null)
      if (!draggingId || draggingId === targetId || !target) return

      const current = sortedProjects
      const draggedItem = current.find((p) => p.id === draggingId)
      if (!draggedItem) return

      const without = current.filter((p) => p.id !== draggingId)
      const targetIdx = without.findIndex((p) => p.id === targetId)
      if (targetIdx === -1) return

      const insertIdx =
        target.position === "before" ? targetIdx : targetIdx + 1
      const newOrderIds = [
        ...without.slice(0, insertIdx).map((p) => p.id),
        draggingId,
        ...without.slice(insertIdx).map((p) => p.id),
      ]

      // Compare against current order to avoid no-op mutations
      const sameAsCurrent = newOrderIds.every(
        (id, i) => current[i]?.id === id,
      )
      if (sameAsCurrent) return

      utils.projects.listWithStatus.setData(undefined, (old) => {
        if (!old) return old
        const map = new Map(old.map((p) => [p.id, p]))
        return newOrderIds
          .map((id) => map.get(id))
          .filter((p): p is NonNullable<typeof p> => p != null)
      })

      reorder.mutate({ orderedIds: newOrderIds })
    },
    [draggedId, dropTarget, sortedProjects, utils, reorder],
  )

  const isAllActive = selectedProject == null

  // projectId → has any chat awaiting an answer in this session.
  const awaitingByProject = useMemo(() => {
    const set = new Set<string>()
    if (!allChats || chatsAwaitingAnswer.size === 0) return set
    for (const c of allChats) {
      if (chatsAwaitingAnswer.has(c.id)) {
        set.add(c.projectId)
      }
    }
    return set
  }, [allChats, chatsAwaitingAnswer])

  // projectId → has any chat currently streaming (live, renderer-side truth).
  const liveInProgressByProject = useMemo(() => {
    const set = new Set<string>()
    if (!allChats || loadingSubChats.size === 0) return set
    const loadingParentChatIds = new Set(loadingSubChats.values())
    for (const c of allChats) {
      if (loadingParentChatIds.has(c.id)) {
        set.add(c.projectId)
      }
    }
    return set
  }, [allChats, loadingSubChats])

  return (
    <div
      className="flex flex-col items-center justify-between border-r bg-background/60 pb-3"
      style={{
        width: RAIL_WIDTH,
        borderRightWidth: "0.5px",
        paddingTop: needsTrafficLightSpacer ? TRAFFIC_LIGHTS_RESERVED_PX : 12,
      }}
    >
      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          active={isAllActive}
          onClick={handleSelectAll}
          tooltip="All projects"
          ariaLabel="Show all projects"
        >
          <LayoutGrid className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </RailButton>

        <div className="my-1 h-px w-6 bg-foreground/[0.08]" aria-hidden />

        {sortedProjects.map((project) => {
          const isActive = selectedProject?.id === project.id
          const label = projectLabel(project)
          const initial = projectInitial(project)
          const accent = project.accentColor ?? undefined
          const isDragging = draggedId === project.id
          const showBefore =
            dropTarget?.id === project.id && dropTarget.position === "before"
          const showAfter =
            dropTarget?.id === project.id && dropTarget.position === "after"
          const inProgress =
            (project.inProgressCount ?? 0) > 0 ||
            liveInProgressByProject.has(project.id)
          const unseen = (project.unseenCount ?? 0) > 0
          const awaiting = awaitingByProject.has(project.id)
          return (
            <ContextMenu key={project.id}>
              <ContextMenuTrigger asChild>
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, project.id)}
                  onDragOver={(e) => handleDragOver(e, project.id)}
                  onDragLeave={(e) => handleDragLeave(e, project.id)}
                  onDragEnd={handleDragEnd}
                  onDrop={(e) => handleDrop(e, project.id)}
                  className={cn(
                    "relative cursor-grab active:cursor-grabbing",
                    isDragging && "opacity-40",
                  )}
                >
                  {showBefore && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -top-[3px] left-1 right-1 h-[2px] rounded-full bg-foreground"
                    />
                  )}
                  <RailButton
                    active={isActive}
                    onClick={() => handleSelectProject(project)}
                    tooltip={label}
                    ariaLabel={`Open project ${label}`}
                  >
                    {project.iconPath ? (
                      <span
                        className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-md"
                        style={{ backgroundColor: accent }}
                      >
                        <img
                          src={`file://${project.iconPath}`}
                          alt=""
                          className="h-full w-full object-cover"
                          draggable={false}
                        />
                      </span>
                    ) : (
                      <span
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-md text-[11px] font-semibold uppercase tracking-wide",
                          "border border-foreground/10",
                        )}
                        style={{
                          backgroundColor: accent ?? "var(--color-muted, rgba(255,255,255,0.04))",
                          color: accent ? "#fff" : undefined,
                        }}
                      >
                        {initial || <Folder className="h-4 w-4" strokeWidth={1.75} />}
                      </span>
                    )}
                  </RailButton>
                  {showAfter && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute -bottom-[3px] left-1 right-1 h-[2px] rounded-full bg-foreground"
                    />
                  )}
                  <StatusDots
                    inProgress={inProgress}
                    unseen={unseen}
                    awaiting={awaiting}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => handleSelectProject(project)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    void handleRevealInFinder(project)
                  }}
                >
                  <FolderOpen className="mr-2 h-4 w-4" />
                  Reveal in Finder
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => refreshGitInfo.mutate({ id: project.id })}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh git info
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => handleHideFromRail(project)}>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Hide from rail
                </ContextMenuItem>
                <ContextMenuItem onSelect={handleSelectAll}>
                  <LayoutGrid className="mr-2 h-4 w-4" />
                  Manage on projects page
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  onSelect={() => setPendingDelete(project)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Remove project
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )
        })}

        <RailButton
          onClick={handleAddProject}
          tooltip={openFolder.isPending ? "Opening..." : "Add project"}
          ariaLabel="Add project"
          disabled={openFolder.isPending}
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </RailButton>
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          onClick={handleOpenSettings}
          tooltip="Settings"
          ariaLabel="Open settings"
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={1.75} />
        </RailButton>
      </div>

      <AlertDialog
        open={pendingDelete != null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes{" "}
              <span className="font-medium text-foreground">
                {pendingDelete ? projectLabel(pendingDelete) : ""}
              </span>{" "}
              and all of its chats from mausCode. The folder on disk is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
