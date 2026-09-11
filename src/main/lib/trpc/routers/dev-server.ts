/**
 * NOTE (transplant): dev-server detect router: package-manager + dev-script resolution (up/down search).
 * Source: sylvaindiv/1code (Apache-2.0). UI strings translated FR->EN on port.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { router, publicProcedure } from "../index"

type PackageManager = "bun" | "pnpm" | "yarn" | "npm"

interface PackageJsonShape {
  scripts?: Record<string, string>
  packageManager?: string
}

const PM_COMMANDS: Record<PackageManager, string> = {
  bun: "bun run dev",
  pnpm: "pnpm dev",
  yarn: "yarn dev",
  npm: "npm run dev",
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function parsePackageManagerField(value: string | undefined): PackageManager | null {
  if (!value || typeof value !== "string") return null
  const name = value.split("@")[0]?.trim().toLowerCase()
  if (name === "bun" || name === "pnpm" || name === "yarn" || name === "npm") {
    return name
  }
  return null
}

async function detectPackageManager(cwd: string, pkg: PackageJsonShape): Promise<PackageManager> {
  const fromField = parsePackageManagerField(pkg.packageManager)
  if (fromField) return fromField

  const checks: Array<{ file: string; pm: PackageManager }> = [
    { file: "bun.lockb", pm: "bun" },
    { file: "bun.lock", pm: "bun" },
    { file: "pnpm-lock.yaml", pm: "pnpm" },
    { file: "yarn.lock", pm: "yarn" },
    { file: "package-lock.json", pm: "npm" },
  ]

  for (const { file, pm } of checks) {
    if (await fileExists(path.join(cwd, file))) {
      return pm
    }
  }

  return "npm"
}

async function tryReadPackageJson(
  dir: string,
): Promise<{ pkg: PackageJsonShape; pkgPath: string } | null> {
  const pkgPath = path.join(dir, "package.json")
  try {
    const raw = await fs.readFile(pkgPath, "utf8")
    const pkg = JSON.parse(raw) as PackageJsonShape
    return { pkg, pkgPath }
  } catch {
    return null
  }
}

/**
 * Walk up at most `maxDepth` parent directories looking for a package.json
 * whose scripts.dev is defined. Useful when the chat's cwd is a sub-folder
 * of the actual JS project.
 */
async function searchUpward(
  startDir: string,
  maxDepth = 4,
): Promise<{ dir: string; pkg: PackageJsonShape; pkgPath: string } | null> {
  let dir = path.resolve(startDir)
  for (let depth = 0; depth <= maxDepth; depth++) {
    const found = await tryReadPackageJson(dir)
    if (found?.pkg?.scripts?.dev) {
      return { dir, pkg: found.pkg, pkgPath: found.pkgPath }
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

const MONOREPO_CONVENTIONAL_DIRS = [
  "apps",
  "packages",
  "web",
  "frontend",
  "client",
  "app",
  "src",
]

/**
 * Shallow downward search (depth 2) for a package.json with scripts.dev.
 * Handles monorepos where the chat's cwd is the repo root but the dev script
 * lives in apps/web/, packages/frontend/, etc.
 *
 * Returns the FIRST match found in conventional dirs, then any subdirectory.
 */
async function searchDownward(
  startDir: string,
): Promise<{ dir: string; pkg: PackageJsonShape; pkgPath: string } | null> {
  let entries: import("node:fs").Dirent[]
  try {
    entries = await fs.readdir(startDir, { withFileTypes: true })
  } catch {
    return null
  }

  const dirNames = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)

  // Priority order: conventional monorepo dirs first
  const ordered = [
    ...MONOREPO_CONVENTIONAL_DIRS.filter((d) => dirNames.includes(d)),
    ...dirNames.filter((d) => !MONOREPO_CONVENTIONAL_DIRS.includes(d)),
  ]

  for (const sub of ordered) {
    const subDir = path.join(startDir, sub)
    const direct = await tryReadPackageJson(subDir)
    if (direct?.pkg?.scripts?.dev) {
      return { dir: subDir, pkg: direct.pkg, pkgPath: direct.pkgPath }
    }

    // One more level deep (apps/web/package.json)
    let subEntries: import("node:fs").Dirent[]
    try {
      subEntries = await fs.readdir(subDir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const inner of subEntries) {
      if (!inner.isDirectory() || inner.name.startsWith(".") || inner.name === "node_modules") {
        continue
      }
      const innerDir = path.join(subDir, inner.name)
      const innerPkg = await tryReadPackageJson(innerDir)
      if (innerPkg?.pkg?.scripts?.dev) {
        return { dir: innerDir, pkg: innerPkg.pkg, pkgPath: innerPkg.pkgPath }
      }
    }
  }

  return null
}

export type DevServerDetectReason =
  | "ok"
  | "no-package-json"
  | "invalid-package-json"
  | "no-dev-script"

export const devServerRouter = router({
  /**
   * Detect whether the project at `cwd` has a `dev` script in its package.json,
   * and which package manager should be used to run it.
   *
   * Walks up parent directories (up to 4 levels) to handle the case where the
   * chat's cwd is a sub-folder of the actual JS project.
   */
  detect: publicProcedure
    .input(z.object({ cwd: z.string().min(1) }))
    .query(async ({ input }) => {
      const { cwd } = input
      console.log(`[devServer.detect] cwd=${cwd}`)
      const pkgPath = path.join(cwd, "package.json")

      // First pass: read the package.json directly at cwd to give precise
      // diagnostics (no-package-json vs invalid-package-json vs no-dev-script).
      let raw: string | null = null
      try {
        raw = await fs.readFile(pkgPath, "utf8")
      } catch (err) {
        console.warn(
          `[devServer.detect] No package.json at ${pkgPath}: ${
            (err as Error)?.message ?? err
          }`,
        )
      }

      let pkgAtCwd: PackageJsonShape | null = null
      if (raw !== null) {
        try {
          pkgAtCwd = JSON.parse(raw) as PackageJsonShape
        } catch (err) {
          console.warn(
            `[devServer.detect] Invalid JSON at ${pkgPath}: ${
              (err as Error)?.message ?? err
            }`,
          )
          return {
            hasDevScript: false as const,
            packageManager: null,
            command: null,
            reason: "invalid-package-json" as const,
            searchedPath: pkgPath,
            availableScripts: [] as string[],
            resolvedDir: null,
          }
        }
      }

      if (pkgAtCwd?.scripts?.dev) {
        const packageManager = await detectPackageManager(cwd, pkgAtCwd)
        return {
          hasDevScript: true as const,
          packageManager,
          command: PM_COMMANDS[packageManager],
          reason: "ok" as const,
          searchedPath: pkgPath,
          availableScripts: Object.keys(pkgAtCwd.scripts),
          resolvedDir: cwd,
        }
      }

      // Fallback 1: walk up looking for a package.json with a dev script
      // (handles cases where chat cwd is a sub-folder of the JS project).
      const upward = await searchUpward(cwd)
      if (upward) {
        console.log(
          `[devServer.detect] resolved upward at ${upward.pkgPath} (dev=${upward.pkg.scripts?.dev})`,
        )
        const packageManager = await detectPackageManager(upward.dir, upward.pkg)
        return {
          hasDevScript: true as const,
          packageManager,
          command: PM_COMMANDS[packageManager],
          reason: "ok" as const,
          searchedPath: upward.pkgPath,
          availableScripts: Object.keys(upward.pkg.scripts ?? {}),
          resolvedDir: upward.dir,
        }
      }

      // Fallback 2: shallow downward search (depth 2) for monorepos where
      // chat cwd is the repo root but the dev script lives in apps/web/,
      // packages/frontend/, etc.
      const downward = await searchDownward(cwd)
      if (downward) {
        console.log(
          `[devServer.detect] resolved downward at ${downward.pkgPath} (dev=${downward.pkg.scripts?.dev})`,
        )
        const packageManager = await detectPackageManager(downward.dir, downward.pkg)
        return {
          hasDevScript: true as const,
          packageManager,
          command: PM_COMMANDS[packageManager],
          reason: "ok" as const,
          searchedPath: downward.pkgPath,
          availableScripts: Object.keys(downward.pkg.scripts ?? {}),
          resolvedDir: downward.dir,
        }
      }

      // Nothing found. Be specific about why.
      if (pkgAtCwd === null) {
        return {
          hasDevScript: false as const,
          packageManager: null,
          command: null,
          reason: "no-package-json" as const,
          searchedPath: pkgPath,
          availableScripts: [] as string[],
          resolvedDir: null,
        }
      }

      return {
        hasDevScript: false as const,
        packageManager: null,
        command: null,
        reason: "no-dev-script" as const,
        searchedPath: pkgPath,
        availableScripts: Object.keys(pkgAtCwd.scripts ?? {}),
        resolvedDir: cwd,
      }
    }),
})
