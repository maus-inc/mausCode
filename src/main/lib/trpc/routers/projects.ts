/**
 * NOTE (transplant): sort-order list, `listWithStatus`, `reorder`,
 * `updateColor`, and `setShowInRail` were transplanted from erenbertr/1code
 * (Apache-2.0, © the 1Code contributors).
 */
import { exec } from "node:child_process"
import { existsSync } from "node:fs"
import { copyFile, mkdir, unlink } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { promisify } from "node:util"
import { asc, desc, eq, isNull } from "drizzle-orm"
import { app, BrowserWindow, dialog } from "electron"
import { z } from "zod"
import { trackProjectOpened } from "../../analytics"
import { getLaunchDirectory } from "../../cli"
import { chats, getDatabase, projects, subChats } from "../../db"
import { getGitRemoteInfo } from "../../git"
import { publicProcedure, router } from "../index"

const execAsync = promisify(exec)

export const projectsRouter = router({
  /**
   * Get launch directory from CLI args (consumed once)
   * Based on PR #16 by @caffeinum
   */
  getLaunchDirectory: publicProcedure.query(() => {
    return getLaunchDirectory()
  }),

  /**
   * List all projects.
   * Order: explicit sort_order ASC first; ties fall back to most-recently updated.
   */
  list: publicProcedure.query(() => {
    const db = getDatabase()
    return db
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder), desc(projects.updatedAt))
      .all()
  }),

  /**
   * List all projects with per-project chat status counts:
   * - inProgressCount: chats where any sub-chat is currently streaming
   *   (sub_chats.stream_id IS NOT NULL).
   * - unseenCount: non-archived, non-streaming chats whose latest activity
   *   (max of chat.updated_at and sub_chats.updated_at) is newer than the
   *   user's last view (chats.last_viewed_at). NULL last_viewed_at counts as 0.
   *
   * Aggregation is done in JS on top of three small selects to keep the SQL
   * portable across SQLite versions.
   */
  listWithStatus: publicProcedure.query(() => {
    const db = getDatabase()

    const projectList = db
      .select()
      .from(projects)
      .orderBy(asc(projects.sortOrder), desc(projects.updatedAt))
      .all()

    const activeChats = db
      .select({
        id: chats.id,
        projectId: chats.projectId,
        updatedAt: chats.updatedAt,
        lastViewedAt: chats.lastViewedAt,
      })
      .from(chats)
      .where(isNull(chats.archivedAt))
      .all()
    const activeChatIds = new Set(activeChats.map((c) => c.id))

    const subChatRows = db
      .select({
        chatId: subChats.chatId,
        streamId: subChats.streamId,
        updatedAt: subChats.updatedAt,
      })
      .from(subChats)
      .all()

    const perChat = new Map<string, { hasStream: boolean; latestActivityMs: number }>()
    for (const sc of subChatRows) {
      if (!activeChatIds.has(sc.chatId)) continue
      const cur = perChat.get(sc.chatId) ?? {
        hasStream: false,
        latestActivityMs: 0,
      }
      const next = {
        hasStream: cur.hasStream || sc.streamId != null,
        latestActivityMs: Math.max(cur.latestActivityMs, sc.updatedAt ? sc.updatedAt.getTime() : 0),
      }
      perChat.set(sc.chatId, next)
    }

    const perProject = new Map<string, { inProgressCount: number; unseenCount: number }>()
    for (const c of activeChats) {
      const status = perChat.get(c.id) ?? {
        hasStream: false,
        latestActivityMs: 0,
      }
      const chatActivityMs = Math.max(
        status.latestActivityMs,
        c.updatedAt ? c.updatedAt.getTime() : 0,
      )
      const lastViewedMs = c.lastViewedAt ? c.lastViewedAt.getTime() : 0
      const isUnseen = !status.hasStream && chatActivityMs > lastViewedMs

      const cur = perProject.get(c.projectId) ?? {
        inProgressCount: 0,
        unseenCount: 0,
      }
      const next = {
        inProgressCount: cur.inProgressCount + (status.hasStream ? 1 : 0),
        unseenCount: cur.unseenCount + (isUnseen ? 1 : 0),
      }
      perProject.set(c.projectId, next)
    }

    return projectList.map((p) => {
      const counts = perProject.get(p.id) ?? {
        inProgressCount: 0,
        unseenCount: 0,
      }
      return {
        ...p,
        inProgressCount: counts.inProgressCount,
        unseenCount: counts.unseenCount,
      }
    })
  }),

  /**
   * Reorder projects in the rail. Accepts the full ordered list of project IDs.
   * Each id's index becomes its new sort_order so subsequent list() reflects it.
   */
  reorder: publicProcedure
    .input(z.object({ orderedIds: z.array(z.string().min(1)) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      db.transaction((tx) => {
        input.orderedIds.forEach((id, index) => {
          tx.update(projects).set({ sortOrder: index }).where(eq(projects.id, id)).run()
        })
      })
      return { success: true as const }
    }),

  /**
   * Get a single project by ID
   */
  get: publicProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    const db = getDatabase()
    return db.select().from(projects).where(eq(projects.id, input.id)).get()
  }),

  /**
   * Open folder picker and create project
   */
  openFolder: publicProcedure.mutation(async ({ ctx }) => {
    const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

    if (!window) {
      console.error("[Projects] No window available for folder dialog")
      return null
    }

    // Ensure window is focused before showing dialog (fixes first-launch timing issue on macOS)
    if (!window.isFocused()) {
      console.log("[Projects] Window not focused, focusing before dialog...")
      window.focus()
      // Small delay to ensure focus is applied by the OS
      await new Promise((resolve) => setTimeout(resolve, 100))
    }

    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Project Folder",
      buttonLabel: "Open Project",
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const folderPath = result.filePaths[0]
    const folderName = basename(folderPath)

    // Get git remote info
    const gitInfo = await getGitRemoteInfo(folderPath)

    const db = getDatabase()

    // Check if project already exists
    const existing = db.select().from(projects).where(eq(projects.path, folderPath)).get()

    if (existing) {
      // Update the updatedAt timestamp and git info (in case remote changed)
      const updatedProject = db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, existing.id))
        .returning()
        .get()

      // Track project opened
      trackProjectOpened({
        id: updatedProject?.id,
        hasGitRemote: !!gitInfo.remoteUrl,
      })

      return updatedProject
    }

    // Create new project with git info
    const newProject = db
      .insert(projects)
      .values({
        name: folderName,
        path: folderPath,
        gitRemoteUrl: gitInfo.remoteUrl,
        gitProvider: gitInfo.provider,
        gitOwner: gitInfo.owner,
        gitRepo: gitInfo.repo,
      })
      .returning()
      .get()

    // Track project opened
    trackProjectOpened({
      id: newProject?.id,
      hasGitRemote: !!gitInfo.remoteUrl,
    })

    return newProject
  }),

  /**
   * Create a project from a known path
   */
  create: publicProcedure
    .input(z.object({ path: z.string(), name: z.string().optional() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const name = input.name || basename(input.path)

      // Check if project already exists
      const existing = db.select().from(projects).where(eq(projects.path, input.path)).get()

      if (existing) {
        return existing
      }

      // Get git remote info
      const gitInfo = await getGitRemoteInfo(input.path)

      return db
        .insert(projects)
        .values({
          name,
          path: input.path,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()
    }),

  /**
   * Rename a project
   */
  rename: publicProcedure
    .input(z.object({ id: z.string(), name: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Delete a project and all its chats
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ input }) => {
    const db = getDatabase()
    return db.delete(projects).where(eq(projects.id, input.id)).returning().get()
  }),

  /**
   * Refresh git info for a project (in case remote changed)
   */
  refreshGitInfo: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()

      // Get project
      const project = db.select().from(projects).where(eq(projects.id, input.id)).get()

      if (!project) {
        return null
      }

      // Get fresh git info
      const gitInfo = await getGitRemoteInfo(project.path)

      // Update project
      return db
        .update(projects)
        .set({
          updatedAt: new Date(),
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Clone a GitHub repo and create a project
   */
  cloneFromGitHub: publicProcedure
    .input(z.object({ repoUrl: z.string() }))
    .mutation(async ({ input }) => {
      const { repoUrl } = input

      // Parse the URL to extract owner/repo
      let owner: string | null = null
      let repo: string | null = null

      // Match HTTPS format: https://github.com/owner/repo
      const httpsMatch = repoUrl.match(/https?:\/\/github\.com\/([^/]+)\/([^/]+)/)
      if (httpsMatch) {
        owner = httpsMatch[1] || null
        repo = httpsMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match SSH format: git@github.com:owner/repo
      const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/(.+)/)
      if (sshMatch) {
        owner = sshMatch[1] || null
        repo = sshMatch[2]?.replace(/\.git$/, "") || null
      }

      // Match short format: owner/repo
      const shortMatch = repoUrl.match(/^([^/]+)\/([^/]+)$/)
      if (shortMatch) {
        owner = shortMatch[1] || null
        repo = shortMatch[2]?.replace(/\.git$/, "") || null
      }

      if (!owner || !repo) {
        throw new Error("Invalid GitHub URL or repo format")
      }

      // Clone to ~/.mauscode/repos/{owner}/{repo}
      const homePath = app.getPath("home")
      const reposDir = join(homePath, ".mauscode", "repos", owner)
      const clonePath = join(reposDir, repo)

      // Check if already cloned
      if (existsSync(clonePath)) {
        // Project might already exist in DB
        const db = getDatabase()
        const existing = db.select().from(projects).where(eq(projects.path, clonePath)).get()

        if (existing) {
          trackProjectOpened({
            id: existing.id,
            hasGitRemote: !!existing.gitRemoteUrl,
          })
          return existing
        }

        // Create project for existing clone
        const gitInfo = await getGitRemoteInfo(clonePath)
        const newProject = db
          .insert(projects)
          .values({
            name: repo,
            path: clonePath,
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .returning()
          .get()

        trackProjectOpened({
          id: newProject?.id,
          hasGitRemote: !!gitInfo.remoteUrl,
        })
        return newProject
      }

      // Create repos directory
      await mkdir(reposDir, { recursive: true })

      // Clone the repo
      const cloneUrl = `https://github.com/${owner}/${repo}.git`
      await execAsync(`git clone "${cloneUrl}" "${clonePath}"`)

      // Get git info and create project
      const db = getDatabase()
      const gitInfo = await getGitRemoteInfo(clonePath)

      const newProject = db
        .insert(projects)
        .values({
          name: repo,
          path: clonePath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      trackProjectOpened({
        id: newProject?.id,
        hasGitRemote: !!gitInfo.remoteUrl,
      })

      return newProject
    }),

  /**
   * Open folder picker to locate an existing clone of a specific repo
   * Validates that the selected folder matches the expected owner/repo
   */
  locateAndAddProject: publicProcedure
    .input(
      z.object({
        expectedOwner: z.string(),
        expectedRepo: z.string(),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: `Locate ${input.expectedOwner}/${input.expectedRepo}`,
        buttonLabel: "Select",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const folderPath = result.filePaths[0]
      const gitInfo = await getGitRemoteInfo(folderPath)

      // Validate it's the correct repo
      if (gitInfo.owner !== input.expectedOwner || gitInfo.repo !== input.expectedRepo) {
        return {
          success: false as const,
          reason: "wrong-repo" as const,
          found:
            gitInfo.owner && gitInfo.repo
              ? `${gitInfo.owner}/${gitInfo.repo}`
              : "not a git repository",
        }
      }

      // Create or update project
      const db = getDatabase()
      const existing = db.select().from(projects).where(eq(projects.path, folderPath)).get()

      if (existing) {
        // Update git info in case it changed
        const updated = db
          .update(projects)
          .set({
            updatedAt: new Date(),
            gitRemoteUrl: gitInfo.remoteUrl,
            gitProvider: gitInfo.provider,
            gitOwner: gitInfo.owner,
            gitRepo: gitInfo.repo,
          })
          .where(eq(projects.id, existing.id))
          .returning()
          .get()

        return { success: true as const, project: updated }
      }

      const project = db
        .insert(projects)
        .values({
          name: basename(folderPath),
          path: folderPath,
          gitRemoteUrl: gitInfo.remoteUrl,
          gitProvider: gitInfo.provider,
          gitOwner: gitInfo.owner,
          gitRepo: gitInfo.repo,
        })
        .returning()
        .get()

      return { success: true as const, project }
    }),

  /**
   * Open folder picker to choose where to clone a repository
   */
  pickCloneDestination: publicProcedure
    .input(z.object({ suggestedName: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()

      if (!window) {
        return { success: false as const, reason: "no-window" as const }
      }

      // Ensure window is focused
      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      // Default to ~/.mauscode/repos/
      const homePath = app.getPath("home")
      const defaultPath = join(homePath, ".mauscode", "repos")
      await mkdir(defaultPath, { recursive: true })

      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
        title: "Choose where to clone",
        defaultPath,
        buttonLabel: "Clone Here",
      })

      if (result.canceled || !result.filePaths[0]) {
        return { success: false as const, reason: "canceled" as const }
      }

      const targetPath = join(result.filePaths[0], input.suggestedName)
      return { success: true as const, targetPath }
    }),

  /**
   * Upload a custom icon for a project (opens file picker for images)
   */
  uploadIcon: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const window = ctx.getWindow?.() ?? BrowserWindow.getFocusedWindow()
      if (!window) return null

      if (!window.isFocused()) {
        window.focus()
        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile"],
        title: "Select Project Icon",
        buttonLabel: "Set Icon",
        filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "svg", "webp", "ico"] }],
      })

      if (result.canceled || !result.filePaths[0]) return null

      const sourcePath = result.filePaths[0]
      const ext = extname(sourcePath)
      const iconsDir = join(app.getPath("userData"), "project-icons")
      await mkdir(iconsDir, { recursive: true })

      const destPath = join(iconsDir, `${input.id}${ext}`)
      await copyFile(sourcePath, destPath)

      const db = getDatabase()
      return db
        .update(projects)
        .set({ iconPath: destPath, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Update accent color for a project (hex string or null to clear)
   */
  updateColor: publicProcedure
    .input(
      z.object({
        id: z.string(),
        accentColor: z.string().nullable(),
      }),
    )
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ accentColor: input.accentColor, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Toggle whether a project appears in the leftmost rail.
   * Hidden projects still show on the all-projects page so they remain
   * accessible without cluttering the rail.
   */
  setShowInRail: publicProcedure
    .input(z.object({ id: z.string(), showInRail: z.boolean() }))
    .mutation(({ input }) => {
      const db = getDatabase()
      return db
        .update(projects)
        .set({ showInRail: input.showInRail, updatedAt: new Date() })
        .where(eq(projects.id, input.id))
        .returning()
        .get()
    }),

  /**
   * Remove custom icon for a project
   */
  removeIcon: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const db = getDatabase()
    const project = db.select().from(projects).where(eq(projects.id, input.id)).get()

    if (project?.iconPath && existsSync(project.iconPath)) {
      try {
        await unlink(project.iconPath)
      } catch {}
    }

    return db
      .update(projects)
      .set({ iconPath: null, updatedAt: new Date() })
      .where(eq(projects.id, input.id))
      .returning()
      .get()
  }),
})
