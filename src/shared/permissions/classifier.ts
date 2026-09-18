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

/**
 * Tools that only ever read, so they carry the read-only class.
 *
 * `SlashCommand` is deliberately absent. A custom slash command can carry a `!`
 * shell execution that does not come back through the Bash tool, so treating it
 * as read-only would let plan mode run a command, and a repository can ship its
 * own commands. It takes the residual `approval` class instead, which plan mode
 * refuses. `Skill` stays here because a skill's actions arrive as their own
 * gated tool calls.
 */
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
 * Verbs that run the command after them instead of doing work of their own.
 *
 * Stripped before the real verb is read, because a wrapper otherwise hides a
 * command from every pattern in this file. `timeout 30 rm -rf /` read as the
 * verb `timeout`, which is not a delete, so the command landed in `approval` and
 * Agent mode allowed it. Claude Code strips the same idea before matching a Bash
 * rule, which its documentation lists as timeout, time, nice, nohup, stdbuf and
 * bare xargs, "so they cannot be used to smuggle a command past a rule".
 *
 * The shell verbs are here too, with their `-c` payload. Quotes are stripped
 * from every word first, so `bash -c "rm -rf /"` reads as the words
 * `bash -c rm -rf /` and the verb resolves to `rm`.
 */
const WRAPPER_VERBS = new Set([
  "sudo",
  "doas",
  "env",
  "command",
  "exec",
  "nohup",
  "nice",
  "ionice",
  "time",
  "timeout",
  "stdbuf",
  "xargs",
  "setsid",
  "chroot",
  "sh",
  "bash",
  "zsh",
  "dash",
  "ksh",
  "eval",
])

/**
 * Wrapper options that take a separate value, so the value is skipped with them.
 * Without this, `sudo -u root rm -rf /` resolved its verb to `-u` and then to
 * `root`, and `nice -n 5 rm -rf /` resolved to `5`.
 *
 * `-c` is deliberately absent. It takes a value for some wrappers but for the
 * shell verbs it introduces the payload this file needs to read, so skipping the
 * next word would skip the real verb.
 */
const WRAPPER_VALUE_FLAGS = new Set([
  "-u",
  "-n",
  "-g",
  "-t",
  "--user",
  "--group",
  "--priority",
  "--cores",
])

/** A bare duration, which is what `timeout` and `time` take as their argument. */
const DURATION_WORD = /^\d+(?:\.\d+)?[smhd]?$/

/** Drop quote characters, so `of="/dev/sda"` reads as `of=/dev/sda`. */
function unquote(word: string): string {
  return word.replace(/["'`]/g, "")
}

/**
 * The verb of one segment: the first word that is not an environment
 * assignment, not a wrapper, and not a flag or a wrapper's value.
 */
function readVerb(words: string[]): string {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (word === undefined) break
    if (word.includes("=")) continue
    if (word.startsWith("-")) {
      if (WRAPPER_VALUE_FLAGS.has(word)) index += 1
      continue
    }
    const base = word.split("/").pop() ?? word
    if (DURATION_WORD.test(base)) continue
    if (WRAPPER_VERBS.has(base)) continue
    return base
  }
  return ""
}

/**
 * Split a shell command into segments on the operators that start a new
 * command. This is not a shell parser and does not claim to be one, and it is
 * not a security boundary on its own: an interpreter that takes inline code,
 * `python -c` or `node -e`, still hides whatever it runs. That gap is recorded
 * in `.dump/app/decisions/2026-09-13-permission-floor.md` rather than papered
 * over here, because the research on agent shell filters is unanimous that a
 * pattern list cannot win against a shell grammar and only an OS sandbox can.
 */
export function splitCommandSegments(command: string): CommandSegment[] {
  return command
    .split(/&&|\|\||[|;\n`()]|\$\(/)
    .map((raw) => raw.trim())
    .filter((text) => text.length > 0)
    .map((text) => {
      const words = text
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => unquote(word).toLowerCase())
        .filter((word) => word.length > 0)
      return { verb: readVerb(words), words }
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

/**
 * A `git push` that rewrites remote history. Read from the segment rather than
 * by regex over the whole command, because the regex needed `git` and `push` to
 * be adjacent and so missed `git -C /repo push --force`.
 */
function hasForcedGitPush(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb !== "git" || readSubcommand(segment) !== "push") return false
    return segment.words.some(isForceSpelling)
  })
}

/**
 * True for any way of spelling a forced push: the long flags, a short-flag
 * cluster containing `f` such as `-f` or `-fu`, and the `+refspec` form, which
 * forces the update without naming a flag at all.
 */
function isForceSpelling(word: string): boolean {
  if (word.startsWith("--force")) return true
  if (word.startsWith("+") && word.length > 1) return true
  return /^-[a-z]*f[a-z]*$/.test(word)
}

function hasDiscardingGitCommand(command: string): boolean {
  return /\bgit\s+reset\s+--hard\b/.test(command) || /\bgit\s+clean\b[^\n]*\s-[a-z]*f/.test(command)
}

/** Partition and filesystem tools, which destroy data whatever their args. */
const DISK_VERBS = new Set(["wipefs", "fdisk", "cfdisk", "sfdisk", "parted", "sgdisk", "gdisk"])

/** Power-state verbs, whether invoked directly or through a service manager. */
const POWER_VERBS = new Set(["shutdown", "reboot", "halt", "poweroff"])

function hasDiskOrPowerVerb(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb.startsWith("mkfs")) return true
    if (DISK_VERBS.has(segment.verb)) return true
    if (segment.verb === "dd") {
      return segment.words.some((word) => word.startsWith("of=/dev/"))
    }
    if (segment.verb === "shred") {
      return segment.words.some((word) => word.startsWith("/dev/"))
    }
    if (segment.verb === "chmod" && segment.words.includes("777")) {
      return segment.words.some((word) => word === "/" || word.startsWith("/*"))
    }
    // `systemctl poweroff` and `service host reboot` reach the same place the
    // bare verbs do, so the subcommand is read for them too.
    if (segment.verb === "systemctl" || segment.verb === "service") {
      return segment.words.some((word) => POWER_VERBS.has(word))
    }
    return POWER_VERBS.has(segment.verb)
  })
}

/**
 * A `find` that deletes what it matches. It removes a whole tree with no `rm`
 * in the command line, so a delete check keyed on `rm` alone misses it.
 */
function hasFindDelete(segments: CommandSegment[]): boolean {
  return segments.some((segment) => segment.verb === "find" && segment.words.includes("-delete"))
}

/** A `shred` of anything. It overwrites a file so it cannot be recovered. */
function hasShred(segments: CommandSegment[]): boolean {
  return segments.some((segment) => segment.verb === "shred")
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
    id: "bulk-find-delete",
    test: (_command, segments) => hasFindDelete(segments),
    reason: "a find with -delete removes every path it matches, with no undo",
  },
  {
    id: "shred",
    test: (_command, segments) => hasShred(segments),
    reason: "shred overwrites a file so its contents cannot be recovered",
  },
  {
    id: "destructive-sql",
    test: (command) => hasDestructiveSql(command),
    reason: "DROP or TRUNCATE destroys stored data",
  },
  {
    id: "forced-git-push",
    test: (_command, segments) => hasForcedGitPush(segments),
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
    if (!segmentDeletes(segment)) continue
    // Every target, not just the first. `rm -rf /tmp/build /` names an ordinary
    // path before the filesystem root, and a scan that stopped at the first
    // candidate would let the root through.
    for (const target of deleteTargets(segment)) {
      const kind = criticalTargetKind(target, worktreeRoot)
      if (kind === null) continue
      return {
        id: "critical-delete",
        reason: `the command deletes ${kind}, and nothing recovers that`,
      }
    }
  }

  return null
}

/**
 * True when this segment deletes something the breaker should look at: `rm`,
 * `rmdir`, or a `find` carrying `-delete`.
 */
function segmentDeletes(segment: CommandSegment): boolean {
  if (segment.verb === "rm" || segment.verb === "rmdir") return true
  return segment.verb === "find" && segment.words.includes("-delete")
}

/**
 * The candidate delete targets in one segment: every word that is not the verb,
 * not `sudo`, and not a flag. A delete can name several paths at once, so this
 * returns them all rather than the first one that happens to match.
 *
 * For a `find` the search root is the first non-flag word, and the remaining
 * words are predicates such as `-name` and their values, which are not paths.
 * They are harmless here because `criticalTargetKind` only answers for the exact
 * critical spellings and returns null for anything else.
 */
function deleteTargets(segment: CommandSegment): string[] {
  return segment.words.filter(
    (word) => word !== segment.verb && word !== "sudo" && !word.startsWith("-"),
  )
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

/**
 * git options that sit between `git` and the subcommand and take a separate
 * value. `git -C /repo push` read its subcommand as `-C` before this, which is
 * the bypass filed upstream against Claude Code: options inserted between the
 * command and the subcommand defeat a matcher that expects them adjacent.
 */
const SUBCOMMAND_VALUE_FLAGS = new Set(["-c", "--git-dir", "--work-tree", "--namespace"])

/** The subcommand of a `git` or package-manager segment, skipping global flags. */
function readSubcommand(segment: CommandSegment): string {
  for (let index = 1; index < segment.words.length; index += 1) {
    const word = segment.words[index]
    if (word === undefined) break
    if (word.startsWith("-")) {
      if (SUBCOMMAND_VALUE_FLAGS.has(word)) index += 1
      continue
    }
    return word
  }
  return ""
}

function segmentOpensNetwork(segment: CommandSegment): boolean {
  if (NETWORK_VERBS.has(segment.verb)) return true
  if (segment.verb === "git") return NETWORK_GIT_SUBCOMMANDS.has(readSubcommand(segment))
  if (hasRemoteRsync(segment)) return true
  const publish = NETWORK_PUBLISH_SUBCOMMANDS[segment.verb]
  return publish ? publish.has(readSubcommand(segment)) : false
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
