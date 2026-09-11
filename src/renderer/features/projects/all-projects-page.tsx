/**
 * Transplanted from erenbertr/1code (Apache-2.0, (c) the 1Code contributors)
 * -- file-level port, not a merge. Icons remapped to lucide-react,
 * "1Code" user-facing strings rebranded to mausCode. See
 * openspec/changes/add-fork-harvest-transplants/tasks.md (Phase 3 Batch C).
 */
"use client"

import { useSetAtom } from "jotai"
import {
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu"
import { LoadingDot } from "../../components/ui/icons"
import { Input } from "../../components/ui/input"
import { ProjectIcon } from "../../components/ui/project-icon"
import { agentsSidebarOpenAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"
import { cn } from "../../lib/utils"
import { selectedProjectAtom } from "../agents/atoms"

type Project = {
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
  updatedAt?: Date | null
  inProgressCount?: number
  unseenCount?: number
}

function projectLabel(project: Pick<Project, "name" | "gitOwner" | "gitRepo">) {
  if (project.gitOwner && project.gitRepo) {
    return `${project.gitOwner}/${project.gitRepo}`
  }
  return project.name
}

function ProjectStatusBadges({
  inProgressCount,
  unseenCount,
}: {
  inProgressCount: number
  unseenCount: number
}) {
  if (inProgressCount === 0 && unseenCount === 0) return null

  return (
    <div
      className="flex shrink-0 items-center gap-1.5"
      role="status"
      aria-label={`${inProgressCount} in progress, ${unseenCount} unseen`}
    >
      {inProgressCount > 0 && (
        <span
          title={`${inProgressCount} chat${inProgressCount === 1 ? "" : "s"} in progress`}
          className="flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          <LoadingDot isLoading={true} className="h-3 w-3 text-muted-foreground" />
          {inProgressCount}
        </span>
      )}
      {unseenCount > 0 && (
        <span
          title={`${unseenCount} chat${unseenCount === 1 ? "" : "s"} with unseen updates`}
          className="flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[#307BD0]" />
          {unseenCount}
        </span>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onRevealInFinder,
  onStartRename,
  onRequestDelete,
  onRefreshGit,
  onToggleRailVisibility,
  isRenaming,
  draftName,
  onDraftNameChange,
  onCommitRename,
  onCancelRename,
}: {
  project: Project
  onOpen: () => void
  onRevealInFinder: () => void
  onStartRename: () => void
  onRequestDelete: () => void
  onRefreshGit: () => void
  onToggleRailVisibility: () => void
  isRenaming: boolean
  draftName: string
  onDraftNameChange: (value: string) => void
  onCommitRename: () => void
  onCancelRename: () => void
}) {
  // undefined → treat as visible (older rows pre-migration)
  const isHiddenFromRail = project.showInRail === false
  const renameInputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border border-border/60 bg-background/50 p-4",
        "transition-colors hover:border-border hover:bg-foreground/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none"
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10",
              !project.accentColor && "bg-muted",
            )}
            style={project.accentColor ? { backgroundColor: project.accentColor } : undefined}
          >
            <ProjectIcon project={project} className="h-7 w-7" />
          </span>
          <span className="min-w-0 flex-1">
            {isRenaming ? (
              <input
                ref={renameInputRef}
                // biome-ignore lint/a11y/noAutofocus: just-entered rename mode from user action; focus must move to the editor
                autoFocus
                value={draftName}
                onChange={(e) => onDraftNameChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    onCommitRename()
                  } else if (e.key === "Escape") {
                    e.preventDefault()
                    onCancelRename()
                  }
                }}
                onBlur={onCommitRename}
                className="block w-full truncate bg-transparent text-sm font-medium outline-none rounded focus-visible:ring-1 focus-visible:ring-ring/70"
              />
            ) : (
              <span className="block truncate text-sm font-medium text-foreground">
                {projectLabel(project)}
              </span>
            )}
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {project.path}
            </span>
          </span>
        </button>

        <ProjectStatusBadges
          inProgressCount={project.inProgressCount ?? 0}
          unseenCount={project.unseenCount ?? 0}
        />

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onToggleRailVisibility()
          }}
          aria-label={isHiddenFromRail ? "Show in left rail" : "Hide from left rail"}
          title={isHiddenFromRail ? "Show in left rail" : "Hide from left rail"}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            isHiddenFromRail
              ? "text-muted-foreground/60 hover:bg-foreground/[0.06] hover:text-foreground"
              : "text-foreground/80 hover:bg-foreground/[0.06] hover:text-foreground",
          )}
        >
          {isHiddenFromRail ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Project actions"
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 hover:bg-foreground/[0.06] hover:text-foreground",
                "opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100",
              )}
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onOpen}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Open
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRevealInFinder}>
              <FolderOpen className="mr-2 h-4 w-4" />
              Reveal in Finder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onStartRename}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onRefreshGit}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh git info
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onToggleRailVisibility}>
              {isHiddenFromRail ? (
                <>
                  <Eye className="mr-2 h-4 w-4" />
                  Show in left rail
                </>
              ) : (
                <>
                  <EyeOff className="mr-2 h-4 w-4" />
                  Hide from left rail
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={onRequestDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Remove project
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {(project.gitOwner || project.gitRemoteUrl) && (
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground/80">
          {project.gitProvider && (
            <span className="rounded bg-foreground/[0.06] px-1.5 py-0.5 uppercase tracking-wide">
              {project.gitProvider}
            </span>
          )}
          {project.gitRemoteUrl && <span className="truncate">{project.gitRemoteUrl}</span>}
        </div>
      )}
    </div>
  )
}

export function AllProjectsPage() {
  const utils = trpc.useUtils()
  const { data: projects, isLoading } = trpc.projects.listWithStatus.useQuery(undefined, {
    // Light polling so in-progress / unseen badges stay fresh while the
    // page is open; cheap query (small JS aggregation over local SQLite).
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
  })
  const setSelectedProject = useSetAtom(selectedProjectAtom)
  const setSidebarOpen = useSetAtom(agentsSidebarOpenAtom)

  const [searchQuery, setSearchQuery] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)

  const filteredProjects = useMemo<Project[]>(() => {
    if (!projects) return []
    const list = projects as Project[]
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter((p) => {
      const label = projectLabel(p).toLowerCase()
      const path = p.path.toLowerCase()
      return label.includes(q) || path.includes(q)
    })
  }, [projects, searchQuery])

  const openFolder = trpc.projects.openFolder.useMutation({
    onSuccess: (project) => {
      if (!project) return
      utils.projects.invalidate()
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl ?? null,
        gitProvider: (project.gitProvider as "github" | "gitlab" | "bitbucket" | null) ?? null,
        gitOwner: project.gitOwner ?? null,
        gitRepo: project.gitRepo ?? null,
      })
      setSidebarOpen(true)
    },
    onError: (err) => toast.error(err.message || "Failed to add project"),
  })

  const renameProject = trpc.projects.rename.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
    },
    onError: (err) => toast.error(err.message || "Failed to rename project"),
  })

  const deleteProject = trpc.projects.delete.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
      utils.chats?.list?.invalidate?.()
      toast.success("Project removed")
    },
    onError: (err) => toast.error(err.message || "Failed to remove project"),
  })

  const refreshGitInfo = trpc.projects.refreshGitInfo.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
      toast.success("Git info refreshed")
    },
    onError: (err) => toast.error(err.message || "Failed to refresh git info"),
  })

  const setShowInRail = trpc.projects.setShowInRail.useMutation({
    onSuccess: () => {
      utils.projects.invalidate()
    },
    onError: (err) => toast.error(err.message || "Failed to update visibility"),
  })

  const handleOpenProject = useCallback(
    (project: Project) => {
      setSelectedProject({
        id: project.id,
        name: project.name,
        path: project.path,
        gitRemoteUrl: project.gitRemoteUrl,
        gitProvider: (project.gitProvider as "github" | "gitlab" | "bitbucket" | null) ?? null,
        gitOwner: project.gitOwner,
        gitRepo: project.gitRepo,
      })
      setSidebarOpen(true)
    },
    [setSelectedProject, setSidebarOpen],
  )

  const handleRevealInFinder = useCallback(async (project: Project) => {
    if (!window.desktopApi?.openFolder) {
      toast.error("Folder reveal is not supported")
      return
    }
    const result = await window.desktopApi.openFolder(project.path)
    if (!result?.success) {
      toast.error(result?.error || "Failed to open folder")
    }
  }, [])

  const handleStartRename = useCallback((project: Project) => {
    setRenamingId(project.id)
    setDraftName(project.name)
  }, [])

  const handleCommitRename = useCallback(() => {
    if (!renamingId) return
    const trimmed = draftName.trim()
    const original = (projects as Project[] | undefined)?.find((p) => p.id === renamingId)
    setRenamingId(null)
    if (!original || !trimmed || trimmed === original.name) return
    renameProject.mutate({ id: renamingId, name: trimmed })
  }, [renamingId, draftName, projects, renameProject])

  const handleCancelRename = useCallback(() => {
    setRenamingId(null)
    setDraftName("")
  }, [])

  const handleConfirmDelete = useCallback(() => {
    if (!pendingDelete) return
    deleteProject.mutate({ id: pendingDelete.id })
    setPendingDelete(null)
  }, [pendingDelete, deleteProject])

  const showEmptyState = !isLoading && filteredProjects.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-foreground">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Manage the local folders mausCode can work with.
          </p>
        </header>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search projects"
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            onClick={() => openFolder.mutate()}
            disabled={openFolder.isPending}
            className="gap-2"
          >
            <FolderPlus className="h-4 w-4" />
            {openFolder.isPending ? "Opening..." : "Add project"}
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[88px] animate-pulse rounded-xl border border-border/60 bg-foreground/[0.03]"
              />
            ))}
          </div>
        ) : showEmptyState ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 px-6 py-16 text-center">
            <FolderPlus className="h-8 w-8 text-muted-foreground/60" />
            <div>
              <div className="text-sm font-medium text-foreground">
                {searchQuery ? "No projects match your search" : "No projects yet"}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {searchQuery
                  ? "Try a different name or path."
                  : "Add a local folder to start working with agents."}
              </div>
            </div>
            {!searchQuery && (
              <Button
                type="button"
                onClick={() => openFolder.mutate()}
                disabled={openFolder.isPending}
                className="gap-2"
              >
                <FolderPlus className="h-4 w-4" />
                {openFolder.isPending ? "Opening..." : "Add your first project"}
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {filteredProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => handleOpenProject(project)}
                onRevealInFinder={() => handleRevealInFinder(project)}
                onStartRename={() => handleStartRename(project)}
                onRequestDelete={() => setPendingDelete(project)}
                onRefreshGit={() => refreshGitInfo.mutate({ id: project.id })}
                onToggleRailVisibility={() =>
                  setShowInRail.mutate({
                    id: project.id,
                    showInRail: project.showInRail === false,
                  })
                }
                isRenaming={renamingId === project.id}
                draftName={renamingId === project.id ? draftName : project.name}
                onDraftNameChange={setDraftName}
                onCommitRename={handleCommitRename}
                onCancelRename={handleCancelRename}
              />
            ))}
          </div>
        )}
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
