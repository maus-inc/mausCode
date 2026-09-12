import type { ToolPartLike } from "../ui/agent-tool-state"

/** Bash tool input/output fields read for git activity extraction. */
type BashToolView = {
  input?: { toolName?: string; command?: string }
  output?: { stdout?: string; output?: string; stderr?: string }
}

/** Edit/Write tool input fields read for changed-file extraction. */
type EditToolView = {
  input?: {
    toolName?: string
    file_path?: string
    old_string?: string
    new_string?: string
    content?: string
  }
}

export interface GitCommitInfo {
  type: "commit"
  message: string
  hash?: string
  pushed?: boolean
}

export interface GitPrInfo {
  type: "pr"
  title: string
  url: string
  number?: number
}

export type GitActivity = GitCommitInfo | GitPrInfo

export interface ChangedFileInfo {
  filePath: string
  displayPath: string
  additions: number
  deletions: number
}

/**
 * Extract commit message from a git commit command and its output.
 */
function extractCommitInfo(command: string, stdout: string): GitCommitInfo | null {
  if (!/git\s+commit/.test(command)) return null

  // Verify commit actually succeeded by checking stdout for git's commit output
  // Format: [branch-name hash] commit message
  const stdoutMatch = stdout.match(/\[[\w/.:-]+\s+([\da-f]+)\]\s+(.+)/)
  if (!stdoutMatch) return null

  const hash = stdoutMatch[1]
  const stdoutMessage = stdoutMatch[2]
  if (!stdoutMessage) return null
  let message = stdoutMessage.trim()

  // If stdout message is truncated, try to get full message from command
  // Pattern 1: HEREDOC pattern (Claude's preferred format)
  const heredocMatch = command.match(/<<'?EOF'?\s*\n([\s\S]*?)\n\s*EOF/)
  if (heredocMatch) {
    const heredocFirstLine = heredocMatch[1]?.split("\n")[0]?.trim()
    if (heredocFirstLine) {
      message = heredocFirstLine
    }
  }

  // Pattern 2: -m "message" or -m 'message' (simple inline message)
  if (!heredocMatch) {
    const mFlagMatch = command.match(/-m\s+["']([^"']+)["']/)
    if (mFlagMatch) {
      const mFlagMessage = mFlagMatch[1]
      if (mFlagMessage) {
        message = mFlagMessage.trim()
      }
    }
  }

  return { type: "commit", message, hash }
}

/**
 * Extract PR info from a gh pr create command and its output.
 */
function extractPrInfo(command: string, stdout: string): GitPrInfo | null {
  if (!/gh\s+pr\s+create/.test(command)) return null

  // Extract URL from stdout
  const urlMatch = stdout.match(/(https:\/\/github\.com\/[^\s]+\/pull\/\d+)/)
  if (!urlMatch) return null

  const url = urlMatch[1]
  if (!url) return null
  const numberMatch = url.match(/\/pull\/(\d+)/)
  const numberStr = numberMatch?.[1]
  const number = numberStr ? parseInt(numberStr, 10) : undefined

  // Extract title from --title flag in command
  const titleMatch = command.match(/--title\s+["']([^"']+)["']/)
  const title = titleMatch?.[1] || `PR #${number || ""}`

  return { type: "pr", title, url, number }
}

/**
 * Scan message parts and return the most significant git activity.
 * Priority: last PR > last commit (PR is more significant).
 * Returns null if no git activity found.
 */
export function extractGitActivity(parts: ToolPartLike[]): GitActivity | null {
  let lastCommit: GitCommitInfo | null = null
  let lastPr: GitPrInfo | null = null
  let lastPushHash: string | null = null
  let hadRebase = false

  for (const part of parts) {
    const bashInput = part.input as BashToolView["input"]
    const bashOutput = part.output as BashToolView["output"]
    const toolName = bashInput?.toolName || part.type?.replace("tool-", "")
    const isBash =
      part.type === "tool-Bash" ||
      toolName === "run_shell_command" ||
      toolName === "Bash" ||
      toolName === "Run"

    if (!isBash) continue
    if (!part.output) continue

    const command: string = bashInput?.command || ""
    const stdout: string = bashOutput?.stdout || bashOutput?.output || ""
    const stderr: string = bashOutput?.stderr || ""

    const commit = extractCommitInfo(command, stdout)
    if (commit) lastCommit = commit

    const pr = extractPrInfo(command, stdout)
    if (pr) lastPr = pr

    // Detect rebase (git pull --rebase rewrites commit hashes)
    if (/git\s+pull\s+--rebase/.test(command)) {
      hadRebase = true
    }

    // Detect successful git push and extract the final pushed hash
    // Push output format: "oldHash..newHash branch -> origin/branch"
    if (/git\s+push/.test(command) && !stderr.includes("error")) {
      // Check stdout and stderr for push ref update (git push outputs to stderr)
      const pushOutput = `${stdout}\n${stderr}`
      const pushMatch = pushOutput.match(/[\da-f]+\.\.([\da-f]+)\s+\S+\s*->\s*\S+/)
      if (pushMatch) {
        lastPushHash = pushMatch[1] ?? ""
      } else {
        // Push succeeded but no hash in output (e.g. first push with -u)
        lastPushHash = ""
      }
    }
  }

  if (lastCommit && lastPushHash !== null) {
    // If rebase happened after commit, the original hash is invalid —
    // use the hash from the final git push output instead
    if (hadRebase && lastPushHash) {
      lastCommit.hash = lastPushHash
      lastCommit.pushed = true
    } else if (hadRebase && !lastPushHash) {
      // Rebase happened but couldn't extract new hash from push output —
      // don't mark as pushed (old hash would 404 on GitHub)
      lastCommit.pushed = false
    } else {
      // No rebase — original hash is valid
      lastCommit.pushed = true
    }
  }

  // PR is more significant than commit (PR implies push already happened)
  return lastPr || lastCommit
}

function countLines(text: string): number {
  if (!text) return 0
  return text.split("\n").length
}

/**
 * Convert absolute file path to relative path from project root.
 * Falls back to basename if project path doesn't match.
 */
function toRelativePath(filePath: string, projectPath?: string): string {
  if (projectPath && filePath.startsWith(projectPath)) {
    const relative = filePath.slice(projectPath.length)
    return relative.startsWith("/") ? relative.slice(1) : relative
  }
  // Handle worktree paths: /Users/.../.21st/worktrees/{chatId}/{subChatId}/relativePath
  const worktreeMatch = filePath.match(/\.21st\/worktrees\/[^/]+\/[^/]+\/(.+)$/)
  if (worktreeMatch) {
    const worktreeRelPath = worktreeMatch[1]
    if (worktreeRelPath) return worktreeRelPath
  }
  return filePath.split("/").pop() || filePath
}

/**
 * Extract changed files from Edit/Write tool parts in a message.
 * Tracks additions and deletions per file.
 * @param projectPath - project root path for computing relative display paths
 */
export function extractChangedFiles(
  parts: ToolPartLike[],
  projectPath?: string,
): ChangedFileInfo[] {
  const fileMap = new Map<string, ChangedFileInfo>()

  for (const part of parts) {
    const editInput = part.input as EditToolView["input"]
    const toolName = editInput?.toolName || part.type?.replace("tool-", "")
    const isEdit = part.type === "tool-Edit" || toolName === "replace" || toolName === "Edit"
    const isWrite = part.type === "tool-Write" || toolName === "write_file" || toolName === "Write"

    if (!isEdit && !isWrite) continue
    const filePath: string = editInput?.file_path || ""
    if (!filePath) continue

    // Skip session/plan files
    if (filePath.includes("claude-sessions") || filePath.includes("Application Support")) continue

    // Use relative path as display, full path as key
    const displayPath = toRelativePath(filePath, projectPath)

    const existing = fileMap.get(filePath)

    if (isEdit) {
      const oldLines = countLines(editInput?.old_string || "")
      const newLines = countLines(editInput?.new_string || "")
      if (existing) {
        existing.additions += newLines
        existing.deletions += oldLines
      } else {
        fileMap.set(filePath, { filePath, displayPath, additions: newLines, deletions: oldLines })
      }
    } else {
      // tool-Write: all new content = additions
      const lines = countLines(editInput?.content || "")
      if (existing) {
        existing.additions += lines
      } else {
        fileMap.set(filePath, { filePath, displayPath, additions: lines, deletions: 0 })
      }
    }
  }

  return Array.from(fileMap.values())
}
