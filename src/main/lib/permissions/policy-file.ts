/**
 * The permission policy file: where it lives, how it is read, and what a
 * missing or broken file resolves to.
 *
 * Behaviour the roadmap fixes in `.dump/app/roadmap/10-permission-floor.md`
 * section 10: an absent file yields the shipped deny-by-default floor and is
 * never created by a read, and a file that cannot be parsed yields the same
 * floor with the failure named, so a broken policy file narrows nothing.
 */
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { APP_DATA_DIRNAME } from "../../../shared/app-identity"
import {
  type PermissionPolicy,
  type PolicySource,
  permissionPolicyDocumentSchema,
  resolvePolicy,
} from "../../../shared/permissions/policy"
import { parseConstrainedToml } from "../../../shared/permissions/toml"

/** Policy file name inside the mausCode data directory. */
export const PERMISSIONS_FILE_NAME = "permissions.toml"

/** Cache TTL, matching the 5 second window `claude-settings.ts` already uses. */
const POLICY_CACHE_TTL_MS = 5000

/** Absolute path of the policy file for the current user. */
export function permissionsPolicyPath(): string {
  return join(homedir(), APP_DATA_DIRNAME, PERMISSIONS_FILE_NAME)
}

/** A policy plus where it came from, so a denial can name the file to edit. */
export interface LoadedPolicy {
  policy: PermissionPolicy
  source: PolicySource
  /** The parse or schema failure, when the file exists but could not be used. */
  error?: string
}

let cache: { path: string; loaded: LoadedPolicy; at: number } | null = null

/** Drop the cached policy. Call after anything writes the file. */
export function invalidatePolicyCache(): void {
  cache = null
}

function floor(error?: string): LoadedPolicy {
  return {
    policy: resolvePolicy({}),
    source: error === undefined ? "default" : "invalid-file",
    ...(error === undefined ? {} : { error }),
  }
}

/**
 * Read and resolve the policy. A tool call must not cost a file read, so the
 * resolved policy is cached for 5 seconds.
 */
export async function readPolicyFile(path = permissionsPolicyPath()): Promise<LoadedPolicy> {
  // Keyed on the path because a caller may point at a fixture, and a cache that
  // ignored the path would answer the fixture for the user's own file.
  if (cache?.path === path && Date.now() - cache.at < POLICY_CACHE_TTL_MS) {
    return cache.loaded
  }

  const loaded = await loadPolicyFromDisk(path)
  cache = { path, loaded, at: Date.now() }
  return loaded
}

async function loadPolicyFromDisk(path: string): Promise<LoadedPolicy> {
  let text: string
  try {
    text = await readFile(path, "utf-8")
  } catch (error) {
    if (isMissingFile(error)) return floor()
    // The whole path, not its directory. A user has to open this file to fix it,
    // and the directory holds the worktrees and cloned repositories as well, so
    // naming it points at the wrong thing.
    return floor(`cannot read ${path}: ${describeError(error)}`)
  }

  const parsed = parseConstrainedToml(text)
  if (!parsed.ok) return floor(parsed.error)

  const validated = permissionPolicyDocumentSchema.safeParse(parsed.value)
  if (!validated.success) return floor(validated.error.issues[0]?.message ?? "invalid policy")

  return { policy: resolvePolicy(validated.data), source: "file" }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  )
}

/** One line for an error, for a message a user has to act on. */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
