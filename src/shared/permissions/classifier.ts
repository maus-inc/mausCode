/**
 * Tool-to-class classification: the pure function that decides which of the
 * five rule classes a resolved agent action lands in.
 *
 * One home on purpose. The destructive patterns here are the ones
 * `detectDangerousDeletion` carried inside the Claude router, moved out so the
 * rule exists once and the native runtime, the Grok argv builder and any future
 * provider all read the same table. Design:
 * `.dump/app/plans/2026-09-13-permission-floor.md`.
 */
import type { PermissionRuleClass } from "./policy"

/** A named pattern, so a denial can quote what matched. */
interface CommandPattern {
  /** Stable id, used in the rule name: `<class>.<id>`. */
  id: string
  test: (command: string, segments: CommandSegment[]) => boolean
  reason: string
}

interface CommandSegment {
  /** First command word of the segment, basename only, lowercased. */
  verb: string
  /** Every word of the segment, lowercased. */
  words: string[]
}

/** Tools that only ever read, so they carry the read-only class. */
const READ_ONLY_TOOLS = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "NotebookRead",
  "TodoWrite",
  "BashOutput",
  "AskUserQuestion",
  "Skill",
  "SlashCommand",
])

/** Tools that reach a network by design, whatever their arguments say. */
const NETWORK_TOOLS = new Set(["WebFetch", "WebSearch"])

/** Tools that write a file, so they carry the approval class. */
const FILE_EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"])

/** Tool input keys that name a filesystem path. */
const PATH_INPUT_KEYS = ["file_path", "path", "notebook_path"] as const

/** Every filesystem path this tool input names, in the order the keys appear. */
export function toolPathCandidates(toolInput: Record<string, unknown>): string[] {
  const found: string[] = []
  for (const key of PATH_INPUT_KEYS) {
    const value = toolInput[key]
    if (typeof value === "string" && value.length > 0) found.push(value)
  }
  return found
}

/** Verbs that open an egress channel. */
const NETWORK_VERBS = new Set([
  "curl",
  "wget",
  "nc",
  "ncat",
  "netcat",
  "telnet",
  "ssh",
  "scp",
  "sftp",
  "ftp",
  "lftp",
])

/** Git subcommands that talk to a remote. */
const NETWORK_GIT_SUBCOMMANDS = new Set(["push", "fetch", "clone", "pull", "remote", "ls-remote"])

/** Package-manager subcommands that publish rather than install. */
const NETWORK_PUBLISH_SUBCOMMANDS: Record<string, Set<string>> = {
  npm: new Set(["publish"]),
  yarn: new Set(["publish"]),
  pnpm: new Set(["publish"]),
  cargo: new Set(["publish"]),
  twine: new Set(["upload"]),
}

/**
 * Paths whose contents leave the machine the moment a model reads them, because
 * the model's context is uploaded to the provider by design. No later gate can
 * catch that, so the read itself is the exfiltration boundary.
 *
 * Deliberately narrow. `credentials` and `*.key` as bare substrings would match
 * ordinary source files, so each entry names a real secret location.
 */
const SECRET_PATH_PATTERNS: Array<{ id: string; test: (path: string) => boolean }> = [
  { id: "ssh-directory", test: (p) => p.includes(".ssh/") },
  {
    id: "aws-credentials",
    test: (p) => p.includes(".aws/credentials") || p.includes(".aws/config"),
  },
  { id: "github-cli-hosts", test: (p) => p.includes(".config/gh/hosts.yml") },
  { id: "netrc", test: (p) => /(^|\/)[._]netrc$/.test(p) },
  { id: "git-credentials", test: (p) => p.includes(".git-credentials") },
  { id: "provider-credentials", test: (p) => p.includes(".credentials.json") },
  { id: "private-key", test: (p) => /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/.test(p) },
  { id: "certificate", test: (p) => /\.(pem|p12|pfx|key)$/.test(p) },
  { id: "dotenv", test: (p) => isDotenvPath(p) },
]

/** Suffixes that mark a dotenv file as a template rather than a live secret. */
const DOTENV_SAFE_SUFFIXES = new Set(["example", "sample", "template", "dist", "md", "txt"])

function isDotenvPath(candidate: string): boolean {
  const segments = candidate.split(/[\\/]/)
  const name = segments.at(-1) ?? ""
  if (name === ".env") return true
  if (!name.startsWith(".env.")) return false
  return !DOTENV_SAFE_SUFFIXES.has(name.slice(".env.".length).toLowerCase())
}

/** The secret location this tool input names, when it names one. */
export function findSecretPath(
  toolInput: Record<string, unknown>,
): { id: string; path: string } | null {
  for (const candidate of toolPathCandidates(toolInput)) {
    for (const pattern of SECRET_PATH_PATTERNS) {
      if (pattern.test(candidate)) return { id: pattern.id, path: candidate }
    }
  }
  return null
}

/** True when any word of a shell command names a secret location. */
function commandNamesSecret(segments: CommandSegment[]): boolean {
  return segments
    .flatMap((segment) => segment.words)
    .some((word) => SECRET_PATH_PATTERNS.some((pattern) => pattern.test(word)))
}

/**
 * Split a shell command into segments on the operators that start a new
 * command. This is not a shell parser and does not claim to be one: it exists
 * so a verb check matches `curl` in `cd build && curl x` and does not match
 * `ssh-keygen`, which is not an egress verb.
 */
export function splitCommandSegments(command: string): CommandSegment[] {
  return command
    .split(/&&|\|\||[|;\n`()]|\$\(/)
    .map((raw) => raw.trim())
    .filter((text) => text.length > 0)
    .map((text) => {
      const words = text.split(/\s+/).filter((word) => word.length > 0)
      // Skip env assignments and sudo so `FOO=1 curl x` still reads as curl.
      const verbWord =
        words.find((word) => !word.includes("=") && word !== "sudo") ?? words[0] ?? ""
      const base = verbWord.split("/").pop() ?? verbWord
      return { verb: base.toLowerCase(), words: words.map((word) => word.toLowerCase()) }
    })
}

function hasRecursiveForceRm(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb !== "rm") return false
    const shortFlags = segment.words
      .filter((word) => /^-[a-z]+$/.test(word))
      .map((word) => word.slice(1))
      .join("")
    const recursive = shortFlags.includes("r") || segment.words.includes("--recursive")
    const force = shortFlags.includes("f") || segment.words.includes("--force")
    return recursive && force
  })
}

function hasProtectedRedirect(command: string): boolean {
  return />\s*(\/etc\/|~\/\.ssh\/|\/usr\/|\/bin\/|\/sbin\/|\/boot\/|\/dev\/)/.test(command)
}

function hasDestructiveSql(command: string): boolean {
  return /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i.test(command)
}

function hasForcedGitPush(command: string): boolean {
  return /\bgit\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f(\s|$))/.test(command)
}

function hasDiscardingGitCommand(command: string): boolean {
  return /\bgit\s+reset\s+--hard\b/.test(command) || /\bgit\s+clean\b[^\n]*\s-[a-z]*f/.test(command)
}

function hasDiskOrPowerVerb(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb.startsWith("mkfs")) return true
    if (segment.verb === "dd") {
      return segment.words.some((word) => word.startsWith("of=/dev/"))
    }
    if (segment.verb === "chmod" && segment.words.includes("777")) {
      return segment.words.some((word) => word === "/" || word.startsWith("/*"))
    }
    return ["shutdown", "reboot", "halt", "poweroff"].includes(segment.verb)
  })
}

function hasInitKill(segments: CommandSegment[]): boolean {
  return segments.some(
    (segment) =>
      (segment.verb === "kill" && segment.words.includes("1")) || segment.verb === "killall",
  )
}

/** Destructive patterns, checked in order. The first match names the rule. */
export const DESTRUCTIVE_PATTERNS: CommandPattern[] = [
  {
    id: "recursive-force-delete",
    test: (_command, segments) => hasRecursiveForceRm(segments),
    reason: "a recursive force delete removes files with no way to undo it",
  },
  {
    id: "destructive-sql",
    test: (command) => hasDestructiveSql(command),
    reason: "DROP or TRUNCATE destroys stored data",
  },
  {
    id: "forced-git-push",
    test: (command) => hasForcedGitPush(command),
    reason: "a forced push rewrites history other people may have pulled",
  },
  {
    id: "discarding-git-command",
    test: (command) => hasDiscardingGitCommand(command),
    reason: "a hard reset or forced clean discards uncommitted work",
  },
  {
    id: "protected-path-overwrite",
    test: (command) => hasProtectedRedirect(command),
    reason: "the command writes into a protected system directory",
  },
  {
    id: "disk-or-power",
    test: (_command, segments) => hasDiskOrPowerVerb(segments),
    reason: "the command reformats a device or changes machine power state",
  },
  {
    id: "init-kill",
    test: (_command, segments) => hasInitKill(segments),
    reason: "the command kills the init process or every process with a name",
  },
]

/** A command the critical-path breaker caught, with the reason it shows. */
export interface CriticalPathBreach {
  /** Stable rule suffix. The evaluator emits `critical-path.<id>`. */
  id: string
  reason: string
}

/**
 * The critical-path breaker. Null means the command is ordinary.
 *
 * This runs above the allow-list and downgrades an allow to an ask, so no rule a
 * user writes can approve it. Claude Code holds the same line: an allow rule and
 * a hook that returns allow both fail to approve an `rm` or `rmdir` on a
 * critical path, and that stays true in its most permissive mode.
 *
 * `worktreeRoot` is optional because the classifier is pure and node-free. The
 * evaluator passes the run's worktree, which makes `rm -rf <worktree>` critical
 * too. Without it the lexical targets above still apply.
 */
export function criticalPathBreach(
  command: string,
  worktreeRoot?: string,
): CriticalPathBreach | null {
  const segments = splitCommandSegments(command)

  if (hasDiskOrPowerVerb(segments)) {
    return {
      id: "disk-or-power",
      reason: "the command reformats a device or changes machine power state",
    }
  }

  for (const segment of segments) {
    if (segment.verb !== "rm" && segment.verb !== "rmdir") continue
    const target = segment.words.find(
      (word) => word !== segment.verb && word !== "sudo" && !word.startsWith("-"),
    )
    if (target === undefined) continue
    const kind = criticalTargetKind(target, worktreeRoot)
    if (kind === null) continue
    return {
      id: "critical-delete",
      reason: `the command deletes ${kind}, and nothing recovers that`,
    }
  }

  return null
}

/**
 * Names a critical target in plain words rather than echoing the token, because
 * a reason is shown in the UI and this file's other reasons never quote command
 * text. Null means the target is ordinary and the mode's own verdict governs it.
 *
 * Words arrive lowercased from `splitCommandSegments`, so `$HOME` is compared as
 * `$home`. `.` and `..` count as critical because this repository has a real
 * incident on record where an empty path variable turned a cleanup call into a
 * delete of the parent directory. A longer target such as `./node_modules` is
 * ordinary.
 */
function criticalTargetKind(target: string, worktreeRoot?: string): string | null {
  if (target === "/" || target === "/*") return "the filesystem root"
  if (target === "~" || target === "~/" || target === "$home" || target === "$home/") {
    return "the home directory"
  }
  if (target === "." || target === "./") return "the whole working directory"
  if (target === ".." || target === "../") return "the parent of the working directory"
  if (worktreeRoot !== undefined) {
    const root = worktreeRoot.toLowerCase()
    if (target === root || target === `${root}/`) return "the whole worktree"
  }
  return null
}

function hasRemoteRsync(segment: CommandSegment): boolean {
  return (
    segment.verb === "rsync" &&
    segment.words.some((word) => word.includes("@") || word.includes("://"))
  )
}

function segmentOpensNetwork(segment: CommandSegment): boolean {
  if (NETWORK_VERBS.has(segment.verb)) return true
  if (segment.verb === "git") return NETWORK_GIT_SUBCOMMANDS.has(segment.words[1] ?? "")
  if (hasRemoteRsync(segment)) return true
  const publish = NETWORK_PUBLISH_SUBCOMMANDS[segment.verb]
  return publish ? publish.has(segment.words[1] ?? "") : false
}

function hasNetworkVerb(segments: CommandSegment[]): boolean {
  return segments.some(segmentOpensNetwork)
}

/** Network patterns, checked in order. */
export const NETWORK_PATTERNS: CommandPattern[] = [
  {
    id: "egress-command",
    test: (_command, segments) => hasNetworkVerb(segments),
    reason: "the command opens a network channel out of this machine",
  },
]

/** What the classifier decided, and why. */
export interface ClassifiedAction {
  ruleClass: PermissionRuleClass
  /** Stable rule suffix. The evaluator emits `<class>.<ruleId>`. */
  ruleId: string
  /** One line for the user and the model. Names the pattern, never the command. */
  reason: string
}

/**
 * Classify one resolved tool call.
 *
 * Order matters and it is the order in the design record: exfiltration first,
 * because a secret leaving beats every other consideration; then destructive,
 * so `git push --force` reports as destructive rather than as the network call
 * it also is; then network; then the tool's own class. An unknown tool takes
 * `approval`, never `read-only`, because nobody has read its side effects.
 */
export function classifyToolAction(
  toolName: string,
  toolInput: Record<string, unknown>,
): ClassifiedAction {
  const secret = findSecretPath(toolInput)
  if (secret) {
    return {
      ruleClass: "exfiltration",
      ruleId: `secret-read.${secret.id}`,
      reason: `${toolName} targets ${secret.path}, which holds a secret`,
    }
  }

  const command = typeof toolInput.command === "string" ? toolInput.command : ""
  if (command.trim().length > 0) return classifyCommand(command)
  return classifyToolName(toolName)
}

/** Classify a shell command against the pattern tables, in table order. */
function classifyCommand(command: string): ClassifiedAction {
  const segments = splitCommandSegments(command)

  if (commandNamesSecret(segments) && hasNetworkVerb(segments)) {
    return {
      ruleClass: "exfiltration",
      ruleId: "secret-egress",
      reason: "the command sends a secret path over a network channel",
    }
  }

  const destructive = firstMatch(DESTRUCTIVE_PATTERNS, command, segments, "destructive")
  if (destructive) return destructive

  const network = firstMatch(NETWORK_PATTERNS, command, segments, "network")
  if (network) return network

  return {
    ruleClass: "approval",
    ruleId: "shell-command",
    reason: "a shell command that matches no dangerous pattern",
  }
}

/** The first pattern that matches, or null when the command matches none. */
function firstMatch(
  patterns: CommandPattern[],
  command: string,
  segments: CommandSegment[],
  ruleClass: ClassifiedAction["ruleClass"],
): ClassifiedAction | null {
  for (const pattern of patterns) {
    if (pattern.test(command, segments)) {
      return { ruleClass, ruleId: pattern.id, reason: pattern.reason }
    }
  }
  return null
}

/** Classify a call that carries no shell command, by the tool's own name. */
function classifyToolName(toolName: string): ClassifiedAction {
  if (NETWORK_TOOLS.has(toolName)) {
    return {
      ruleClass: "network",
      ruleId: "network-tool",
      reason: `${toolName} reaches a host this app does not control`,
    }
  }

  if (READ_ONLY_TOOLS.has(toolName)) {
    return {
      ruleClass: "read-only",
      ruleId: "read-only-tool",
      reason: `${toolName} reads without changing anything`,
    }
  }

  if (FILE_EDIT_TOOLS.has(toolName)) {
    return { ruleClass: "approval", ruleId: "file-edit", reason: `${toolName} changes a file` }
  }

  return {
    ruleClass: "approval",
    ruleId: "unclassified-tool",
    reason: `${toolName} has no classification, so it takes the middle tier`,
  }
}

/**
 * The text an allow-list rule matches against: the shell command for Bash, the
 * path for a file tool, the URL for a fetch, the pattern for a search.
 *
 * `relativePath` lets the caller pass the worktree-relative form of a path, so
 * `Edit(src/*)` matches even though the provider handed over an absolute one.
 */
export function toolMatchText(
  toolName: string,
  toolInput: Record<string, unknown>,
  relativePath?: string,
): string {
  if (toolName === "Bash" && typeof toolInput.command === "string") return toolInput.command
  if (relativePath !== undefined) return relativePath
  if (typeof toolInput.url === "string") return toolInput.url
  if (typeof toolInput.pattern === "string") return toolInput.pattern
  for (const key of PATH_INPUT_KEYS) {
    const value = toolInput[key]
    if (typeof value === "string") return value
  }
  return ""
}

/** True when a path is markdown, the one write plan mode allows. */
export function isMarkdownPath(candidate: string): boolean {
  return /\.md$/i.test(candidate)
}
