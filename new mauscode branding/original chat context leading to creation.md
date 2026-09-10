User:
wow i just saw 1code,its been archived but dang it looks really niceeee, i'm thinking now in my head of forking, doing rebranding, setting up deep good ci infra fleshing out the backend and implementing another very lightweight cli now bachend runtime jcode, to create one byok beautiful setup but super performant, and a system to let you migrate over from hermes, opencode claude cursor codex in your device allat or more or use our already performant backend locally or with docker or daytona or other device, like how t3code does,

Agent:
YES — **that is a much stronger idea than simply “fork 1Code.”**

And the current repo makes it unusually attractive as a starting point: it’s **Apache-2.0**, was archived on **July 7, 2026**, and already has a lot of the product surface you’d otherwise spend months building: Cursor-like UI, Claude Code/Codex orchestration, BYOK, worktrees, background execution, previews, Git/PR handling, MCP/plugins, queueing, plan mode, sub-agents, voice, PWA, etc. ([GitHub][1])

The architecture I'd build from that is:

```text
                 YOUR APP
        ┌────────────────────────┐
        │   beautiful client UI  │
        │                        │
        │ sessions / diff / git  │
        │ terminal / files       │
        │ agents / providers     │
        │ workspaces / preview   │
        └───────────┬────────────┘
                    │
             JCode Runtime API
                    │
        ┌───────────┼───────────┐
        │           │           │
      local       docker      remote
        │                       │
      machine                 VM / Daytona
        │                       │
        └───────────┬───────────┘
                    │
             Agent Adapter Layer
        ┌───────────┼─────────────┐
        │           │             │
     OpenCode    Claude Code    Codex
        │           │             │
     Hermes      other ACP/CLI agents
```

The **really good part** is the migration layer you're imagining.

Instead of forcing people to “switch agents,” make your product understand their existing environments:

```text
~/.claude/
~/.codex/
~/.config/opencode/
Hermes config
Cursor project configuration
MCP servers
skills
agents
rules / AGENTS.md / CLAUDE.md
API providers
git identity
```

Then:

**Import workspace → detect installed agents → map capabilities → preserve configs → choose runtime.**

So a person could arrive with:

> “I already use Claude Code.”

and your UI says:

> **Claude Code detected**
> Import configuration
> Keep Claude Code runtime
> or use JCode runtime

That is *way* more compelling than trying to convince users to abandon their existing agent.

### JCode is the piece I'd make radically smaller

Don't recreate Claude Code/OpenCode.

Make JCode basically a **universal execution/orchestration runtime**:

```text
jcode run
jcode attach
jcode exec
jcode serve
jcode workspace
jcode agent
jcode doctor
```

Its job:

**workspace lifecycle + permissions + PTY + filesystem + git/worktrees + process supervision + streaming events + provider configuration + agent adapters.**

Then agents are plugins/adapters rather than the core.

That gives you:

```text
UI
 ↓
JCode protocol
 ↓
Agent adapter
 ↓
runtime backend
```

instead of:

```text
UI
 ↓
Claude-specific implementation
 ↓
another Claude-specific implementation
 ↓
another special cloud implementation
```

And this lines up nicely with what T3 Code is doing conceptually: one runtime boundary, with local/remote execution expressed through the connection rather than making the UI care where the machine lives. ([GitHub][2])

### The one thing I would NOT blindly inherit from 1Code

**Security/permissions.**

There was a reported critical issue in the archived repo involving `allowDangerouslySkipPermissions: true` in agent mode, which could allow tool execution without the expected approval boundaries. That issue was marked closed, but because you're talking about turning the fork into the foundation of a new runtime, I'd treat **the permission model as something to re-audit from scratch**, not something to preserve blindly. ([GitHub][3])

Also, the original repo explicitly distinguishes its open-source build from hosted functionality: local AI/Claude/worktrees/terminal are open-source, while sign-in/sync and background agents were tied to the hosted backend. ([GitHub][4])

So I'd **rip out the 21st service assumptions completely** rather than trying to resurrect their backend.

### And the Apache license is unusually nice for this

You're allowed to modify and redistribute Apache-2.0 code, including commercially, provided you satisfy the license's redistribution requirements such as retaining the license/notices and marking modified files appropriately. ([Apache HTTP Server][5])

So a clean approach is:

```text
original 1Code code
        ↓
fork
        ↓
strip 21st branding/services
        ↓
new product identity
        ↓
new runtime architecture
        ↓
new backend
        ↓
new CI/release infrastructure
```

while keeping the required attribution/legal material.

Honestly, **the killer product isn't “another coding agent.”**

It's:

> **one beautiful control plane for whatever coding agent and whatever execution environment you already use.**

**Claude Code / Codex / OpenCode / Hermes / JCode / local / Docker / Daytona / remote machine — same project, same workspace, same UI, same Git state.**

That is a genuinely strong product thesis. And 1Code gives you a *massive* head start on the part users actually see. ([GitHub][1])

[1]: https://github.com/21st-dev/1code?utm_source=chatgpt.com "GitHub - 21st-dev/1code: Orchestration layer for coding agents (Claude Code, Codex) · GitHub"
[2]: https://github.com/pingdotgg/t3code/blob/main/docs/internals/remote.md?utm_source=chatgpt.com "t3code/docs/internals/remote.md at main · pingdotgg/t3code · GitHub"
[3]: https://github.com/21st-dev/1code/issues/104?utm_source=chatgpt.com "[CRITICAL] Dangerous permissions bypassed in agent mode · Issue #104 · 21st-dev/1code · GitHub"
[4]: https://github.com/21st-dev/1code/blob/main/CONTRIBUTING.md?utm_source=chatgpt.com "1code/CONTRIBUTING.md at main · 21st-dev/1code · GitHub"
[5]: https://httpd.apache.org/docs/current/license.html?utm_source=chatgpt.com "The Apache License, Version 2.0 - Apache HTTP Server Version 2.4"


User:no i'd like to use jcode refined and rebranded since its so fast and cache efficientto be able to use as the complete app default backend remote, local ssh docker daytona(like hermes agent let's you), or with a backend runnable on seperate devices like a spare linux box, like npx t3connect lets you do like , adding other agents would be secondary optional for those who want the existing clis used with our device both locally or remote

Agent:
Exactly — that distinction makes sense.

You’re **not** trying to make JCode another optional agent adapter. You want **JCode to become the native execution engine** underneath the app:

```text
                    YOUR UI
                       │
                  JCode protocol
                       │
        ┌──────────────┼──────────────┐
        │              │              │
      local           SSH           Docker
        │              │              │
     current PC     spare box      container
                                      │
                                   Daytona
                                      │
                                other sandbox
```

Then the existing CLIs become **optional compatibility runtimes**:

```text
Native
└── JCode
    ├── local
    ├── SSH
    ├── Docker
    ├── Daytona
    └── remote JCode node

Compatibility
├── Claude Code
├── Codex
├── OpenCode
├── Hermes
└── other agents
```

That is a much cleaner product architecture.

And **JCode is unusually well suited to this**. The current project is a Rust coding-agent harness explicitly optimized around performance/resource usage, supports persistent `serve`/`connect` operation, arbitrary OpenAI-compatible endpoints, multi-session workflows, browser automation, and MIT licensing. ([github.com](https://github.com/1jehuang/jcode?utm_source=chatgpt.com))

The really valuable part is that JCode already has the beginnings of the exact **local/remote daemon model** you'd need:

```text
jcode serve
     ↑
 persistent agent/runtime
     ↑
jcode connect
     ↑
 client
```

So instead of implementing a giant cloud-specific backend, your architecture could make **a JCode node the universal compute endpoint**.

### The killer UX

The user installs nothing except the app.

Then:

**Workspace → Runtime**

```text
● This device
  JCode

○ Remote machine
  + Add device

○ Docker
  + New container

○ Daytona
  + Connect

○ SSH
  + Add server

──────────────

Compatible agents
  Claude Code
  Codex
  OpenCode
  Hermes
```

And “Add device” could essentially become your equivalent of `t3 connect`: install a tiny **JCode node**, authenticate it to the account, and the machine immediately appears as an available runtime. T3's architecture already demonstrates the usefulness of separating the hosted control plane from a remote local execution node. ([github.com](https://github.com/pingdotgg/t3code/blob/main/docs/internals/t3-connect.md?utm_source=chatgpt.com))

### That also solves a huge problem with BYOK

The platform itself doesn't need to be the LLM provider.

You can have:

```text
                 Provider
                    │
             user's API key
                    │
                    ▼
UI ───────► JCode runtime ───────► workspace
```

The hosted service primarily becomes **control plane + auth + device registry + session synchronization**, while computation can happen on the user's JCode node.

That is much closer to the philosophy you're describing than a “cloud agent SaaS” where every execution has to pass through their infrastructure.

And Hermes has already validated the runtime abstraction you're thinking about: it currently exposes local, Docker, SSH, Modal, Daytona, Vercel Sandbox and Singularity backends. ([github.com](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/configuration.md?utm_source=chatgpt.com))

So I think the conceptual split should be:

**JCode = execution engine**

**Your app = control plane/UI**

**Other agents = compatibility adapters**

**Providers = BYOK**

**Backends = pluggable compute**

That gives you a single very fast default path while still letting someone say:

> “I already have Claude Code installed on this box; use that instead.”

And crucially, you don't need to turn every backend into a first-class bespoke implementation. The **JCode protocol** becomes the one stable contract everything else plugs into.


User:ok i want a solid init checklist

Agent :
Absolutely. I’d treat this as a **platform initialization checklist**, not a “start coding features” checklist.

The goal is to get from **forked 1Code + JCode** to a clean foundation where you can safely build the product without creating architectural debt in week one.

# 0. Lock the product thesis

Before touching implementation, write this into `README.md` / `docs/vision.md`:

> **A beautiful BYOK agent workspace where JCode is the native runtime and other coding agents are optional compatibility runtimes. The same workspace can execute locally, over SSH, in Docker, on Daytona, or on another JCode device.**

Decide these things now:

* [ ] JCode = **default/native runtime**
* [ ] Claude Code / Codex / OpenCode / Hermes = optional adapters
* [ ] BYOK is first-class
* [ ] Users own their provider credentials
* [ ] Remote execution is a core primitive, not an add-on
* [ ] Local execution works without an account
* [ ] Hosted control plane is optional
* [ ] JCode node can operate independently from the UI
* [ ] UI never needs to know whether execution is local/SSH/Docker/Daytona/remote
* [ ] Workspace state has a stable protocol independent of the runtime

That last one is huge.

---

# 1. Repository / ownership setup

### Fork strategy

Don't leave this as an obvious 1Code fork forever.

```text
your-project/
├── apps/
│   ├── desktop/
│   ├── web/
│   └── landing/
├── packages/
│   ├── ui/
│   ├── protocol/
│   ├── runtime-client/
│   ├── agent-adapters/
│   ├── auth/
│   └── config/
├── runtime/
│   └── jcode/
├── server/
│   ├── api/
│   ├── relay/
│   └── device-registry/
├── infrastructure/
├── docs/
└── scripts/
```

* [ ] Create fresh organization
* [ ] Create canonical repository
* [ ] Preserve required 1Code Apache-2.0 notices
* [ ] Document upstream commit/tag used as starting point
* [ ] Separate inherited code from new code where practical
* [ ] Remove abandoned 1Code cloud assumptions
* [ ] Remove 21st-specific authentication/service dependencies
* [ ] Remove dead feature flags
* [ ] Remove obsolete analytics
* [ ] Remove unused deployment code
* [ ] Establish your own package naming
* [ ] Establish your own telemetry policy
* [ ] Establish your own security policy

### Git hygiene

* [ ] `main` protected
* [ ] PR required
* [ ] CI required before merge
* [ ] conventional commits or equivalent
* [ ] changesets/versioning
* [ ] automated changelog
* [ ] CODEOWNERS
* [ ] issue templates
* [ ] PR template
* [ ] security disclosure policy
* [ ] dependency update automation

---

# 2. Create the architecture spec FIRST

Make:

```text
docs/architecture/
├── overview.md
├── runtime.md
├── protocol.md
├── workspace.md
├── providers.md
├── devices.md
├── security.md
└── agents.md
```

Draw one canonical architecture diagram.

```text
                         CLIENT
                           │
                    ┌──────▼──────┐
                    │  App / Web  │
                    └──────┬──────┘
                           │
                    Runtime Protocol
                           │
                    ┌──────▼──────┐
                    │ JCode Client │
                    └──────┬──────┘
                           │
                 ┌─────────┴─────────┐
                 │                   │
             Local JCode        Remote JCode
                 │                   │
        ┌────────┼───────┐      ┌────▼────┐
        │        │       │      │ JCode    │
      host     Docker  Daytona  │ node     │
                                 └──────────┘

Optional:
Claude Code / Codex / OpenCode / Hermes
              ↓
       Agent Adapter API
```

The key rule:

**The UI talks to a protocol, not directly to JCode internals.**

---

# 3. Define the JCode protocol

This is probably the **single most important engineering task**.

Don't start by wiring the existing UI directly into JCode.

Define:

### Runtime lifecycle

```text
create_workspace
start_runtime
stop_runtime
restart_runtime
destroy_runtime
```

### Sessions

```text
create_session
resume_session
pause_session
terminate_session
list_sessions
```

### Agent execution

```text
send_message
cancel
approve
reject
interrupt
retry
```

### Files

```text
list_files
read_file
write_file
watch_files
```

### Terminal

```text
create_terminal
send_input
resize_terminal
kill_terminal
stream_output
```

### Git

```text
status
diff
commit
branches
worktrees
checkout
```

### Events

Make everything event-driven:

```text
session.created
session.message
agent.started
agent.thinking
tool.started
tool.output
tool.finished
file.changed
terminal.output
git.changed
approval.required
agent.completed
agent.failed
```

Then your UI can render these however you want.

**Do not make raw JCode output your UI contract.**

---

# 4. Refine JCode before integrating it

Don't immediately dump upstream JCode into the product.

Create a dedicated fork/module and establish:

* [ ] project identity
* [ ] build/release process
* [ ] stable library API
* [ ] stable CLI API
* [ ] stable daemon/server API
* [ ] configuration format
* [ ] workspace abstraction
* [ ] event protocol
* [ ] process supervision
* [ ] cancellation
* [ ] reconnect behavior
* [ ] crash recovery
* [ ] session persistence
* [ ] log persistence
* [ ] filesystem watching
* [ ] PTY support
* [ ] resource limits
* [ ] graceful shutdown

And importantly:

### JCode must be usable without your application.

This should work:

```bash
jcode
```

```bash
jcode serve
```

```bash
jcode connect <device>
```

```bash
jcode run
```

Your application should **consume JCode**, not define what JCode is.

---

# 5. Build the Runtime abstraction

This becomes your superpower.

```ts
interface Runtime {
  connect(): Promise<void>
  disconnect(): Promise<void>

  createWorkspace(): Promise<Workspace>
  listWorkspaces(): Promise<Workspace[]>

  createSession(): Promise<Session>

  exec(command: string): Promise<ExecResult>

  readFile(path: string): Promise<string>
  writeFile(path: string, data: string): Promise<void>

  subscribe(listener: RuntimeEventListener): Unsubscribe
}
```

Then implement:

```text
Runtime
├── JCodeLocal
├── JCodeSSH
├── JCodeDocker
├── JCodeDaytona
├── JCodeRemote
└── AgentRuntime
    ├── ClaudeCode
    ├── Codex
    ├── OpenCode
    └── Hermes
```

Your UI shouldn't care which implementation it got.

---

# 6. Make devices a first-class concept

This is where your “spare Linux box” idea becomes excellent.

Create:

```text
Device
├── id
├── name
├── platform
├── architecture
├── status
├── capabilities
├── version
├── last_seen
└── runtimes[]
```

Example:

```text
My PC
● Online
JCode 0.x

Linux Server
● Online
JCode 0.x

MacBook
○ Offline
JCode 0.x
```

Device handshake:

```text
JCode node
    ↓
authenticate
    ↓
register
    ↓
capability discovery
    ↓
heartbeat
    ↓
available to UI
```

This should be designed **before** implementing the hosted service.

---

# 7. Build the “Connect another device” experience

Target:

```text
Settings
→ Devices
→ Add device
```

Generate:

```bash
curl ... | sh
jcode connect --token XXXX
```

or ideally:

```bash
npx jcode connect
```

The node:

* [ ] installs
* [ ] authenticates
* [ ] registers
* [ ] advertises capabilities
* [ ] establishes encrypted connection
* [ ] receives workspace assignments
* [ ] survives reconnect
* [ ] can be revoked remotely
* [ ] can be updated remotely

This is the foundation for your **T3 Connect-style experience**.

---

# 8. BYOK system

Don't bolt this on later.

Create a provider abstraction:

```text
Provider
├── OpenAI
├── Anthropic
├── OpenRouter
├── Google
├── Groq
├── Mistral
├── DeepSeek
├── local/OpenAI-compatible
└── custom endpoint
```

Provider config:

```text
provider
model
base_url
api_key
headers
capabilities
```

### Security

* [ ] API keys encrypted at rest
* [ ] never log secrets
* [ ] never send keys to telemetry
* [ ] redact secrets from error messages
* [ ] separate provider auth from account auth
* [ ] local-only BYOK mode
* [ ] remote runtime credential forwarding
* [ ] credential rotation
* [ ] credential deletion
* [ ] permission scopes

Most importantly:

**A user should be able to run the entire application without giving you an LLM API key.**

---

# 9. Workspace model

Define a workspace independently of an agent.

```text
Workspace
├── repository
├── runtime
├── sessions
├── environment
├── git
├── provider
├── MCP
├── skills
├── instructions
└── metadata
```

That allows:

```text
Workspace A
  JCode → local

Workspace B
  JCode → Daytona

Workspace C
  Claude Code → SSH

Workspace D
  Codex → remote Linux
```

without changing the UI model.

---

# 10. Migration/import engine

This should eventually be one of your biggest differentiators.

Build:

```text
Import / Migrate
```

Detect:

```text
Claude
Codex
OpenCode
Hermes
Cursor
Cline
Roo
MCP configs
AGENTS.md
CLAUDE.md
skills
rules
hooks
environment configuration
```

Then show:

```text
Claude Code detected

✓ Instructions
✓ MCP servers
✓ Skills
✓ Provider configuration
✓ Project settings

Import into workspace
```

Don't silently mutate anything.

Use:

```text
Detect → Preview → Map → Confirm → Import
```

---

# 11. Compatibility-agent API

Keep this much smaller than JCode's native interface.

```text
AgentAdapter
├── discover()
├── installStatus()
├── capabilities()
├── start()
├── stop()
├── send()
├── stream()
└── interrupt()
```

Then:

```text
ClaudeCodeAdapter
CodexAdapter
OpenCodeAdapter
HermesAdapter
```

These are **secondary**.

Don't let compatibility support pollute the JCode core.

---

# 12. UI shell

Only after the protocol exists.

Your UI primitives should be:

```text
App Shell
├── Workspace switcher
├── Project sidebar
├── Session list
├── Agent conversation
├── Activity
├── Diff
├── Files
├── Terminal
├── Preview
├── Git
└── Runtime/device selector
```

And make tool activity:

**structured components**, not giant textual tool dumps.

Example:

```text
Agent working

▾ Read 12 files
▾ Modified auth.ts
✓ Ran tests
✓ 43 tests passed

[View diff]
```

rather than:

```text
TOOL CALL
arguments...
stdout...
stderr...
JSON...
```

That is where the quality gap between OpenHands and polished products gets closed.

---

# 13. Hosted control plane

Only host what **needs** to be hosted.

### Control plane

```text
Auth
Devices
Workspace metadata
Session metadata
Relay
Secrets metadata
Sync
Notifications
```

### Don't unnecessarily host

```text
repositories
LLM inference
agent execution
terminal
filesystem
```

Those can remain on JCode nodes.

This makes your infrastructure dramatically cheaper.

---

# 14. Free hosted architecture

For the eventual free tier:

```text
Browser
   │
   ▼
Control Plane
   │
   ├── auth
   ├── device registry
   └── relay
          │
          ▼
      JCode Node
          │
          ▼
       user's API
```

Meaning you aren't paying:

> $X per agent-hour

for someone's Claude/OpenAI usage.

The user provides the key.

That makes a genuinely free platform much more feasible.

---

# 15. Docker / Daytona / SSH

Implement in this order:

### Phase 1

* [ ] local

### Phase 2

* [ ] SSH

### Phase 3

* [ ] Docker

### Phase 4

* [ ] remote JCode node

### Phase 5

* [ ] Daytona

### Phase 6

* [ ] generic remote execution provider interface

Don't make Daytona a special snowflake.

```text
ExecutionBackend
├── Local
├── SSH
├── Docker
├── Daytona
└── JCodeRemote
```

---

# 16. CI/CD

From day one:

```text
PR
 ↓
lint
 ↓
typecheck
 ↓
unit tests
 ↓
protocol tests
 ↓
runtime tests
 ↓
build
 ↓
security scan
 ↓
package
```

Matrix:

```text
Linux x64
Linux ARM64
macOS ARM64
macOS x64
Windows x64
```

For JCode specifically:

* [ ] CLI smoke tests
* [ ] daemon tests
* [ ] reconnect tests
* [ ] PTY tests
* [ ] filesystem tests
* [ ] session recovery tests
* [ ] cancellation tests
* [ ] remote-node tests
* [ ] Docker tests
* [ ] SSH integration tests

---

# 17. Security before “cool features”

Absolutely do this early.

Threat model:

```text
Untrusted agent
      ↓
filesystem
      ↓
terminal
      ↓
network
      ↓
credentials
      ↓
remote machine
```

Define:

* [ ] permission system
* [ ] approval model
* [ ] sandbox boundaries
* [ ] secret isolation
* [ ] path traversal protection
* [ ] shell escaping
* [ ] command authorization
* [ ] remote authentication
* [ ] device revocation
* [ ] session isolation
* [ ] workspace isolation
* [ ] audit events

Especially because you're allowing an agent to operate **a real remote computer**.

---

# 18. Observability

Build this into the protocol.

Track:

```text
session latency
tool latency
runtime startup time
provider latency
token usage
errors
reconnects
CPU
memory
workspace size
```

But:

**Never collect project contents by default.**

You want enough telemetry to answer:

> “Why did this session take 19 seconds to start?”

without knowing what someone's private repository contains.

---

# 19. Performance targets

Since you're specifically attracted to JCode's performance, establish benchmarks before modifying it.

Targets like:

```text
CLI startup
runtime startup
first token
first tool call
workspace creation
SSH connection
device reconnect
file indexing
session resume
memory idle
memory under load
```

Create:

```text
benchmarks/
```

and make performance regression CI-visible.

Don't just say “fast.”

Have:

```text
JCode baseline
        ↓
your modifications
        ↓
+2% / -4% / etc.
```

---

# 20. Release engineering

Automate:

```text
git tag
 ↓
build
 ↓
sign
 ↓
GitHub Release
 ↓
CLI binaries
 ↓
desktop installers
 ↓
Docker image
 ↓
npm package
 ↓
update manifest
```

Eventually:

```bash
npx jcode connect
```

should be able to install/update itself cleanly.

---

# 21. The first actual milestone

Don't build 40 features.

Your **MVP-0** should be:

```text
Beautiful UI
     ↓
JCode
     ↓
local workspace
     ↓
BYOK
     ↓
agent session
     ↓
files
     ↓
terminal
     ↓
git diff
```

Then:

```text
MVP-1
local ↔ remote JCode

MVP-2
SSH / Docker

MVP-3
device registration

MVP-4
hosted control plane

MVP-5
Daytona

MVP-6
Claude/Codex/OpenCode/Hermes adapters

MVP-7
migration system
```

---

# 22. Your initial repo should have these documents

Before serious implementation, get these committed:

```text
README.md
LICENSE
SECURITY.md
CONTRIBUTING.md

docs/
├── vision.md
├── architecture.md
├── protocol.md
├── runtime.md
├── devices.md
├── providers.md
├── agents.md
├── migration.md
├── security.md
├── deployment.md
└── roadmap.md
```

And especially:

```text
docs/protocol.md
```

That becomes your **source of truth**.

---

# The order I'd personally execute

```text
01  Fork + clean repository
02  Preserve/license/audit inherited code
03  Remove 1Code cloud assumptions
04  Define product architecture
05  Define JCode protocol
06  Refine JCode
07  Build Runtime abstraction
08  Build local JCode integration
09  Build BYOK
10  Build workspace/session model
11  Rebuild UI around the protocol
12  Build JCode remote node
13  Build device registry
14  Build SSH
15  Build Docker
16  Build hosted relay/control plane
17  Build Daytona
18  Add agent adapters
19  Build migration/import
20  Harden security
21  Performance benchmark
22  CI/CD + signed releases
23  Private alpha
24  Public beta
```

## One architectural rule I'd put in giant letters at the top of the repo

> **JCode is the product's native runtime. Everything else is an adapter.**

That prevents the project from slowly turning into another “universal agent UI” where every provider/runtime gets special-case logic and the core becomes impossible to maintain.


User:
nope it will become our own managed runtime, basecally mauscode is what we'll call it, our own full stack agent app, implementing new features from popular runtimes like opencode, hermes agent and desktop, basically openchamber but way better ui, and a way faster runtime with wayy less memory usage than opencode, with the strict rule of keeping every new change deeply rooted to keep both original modules performance + ui so stripping 1code backend  and jcode frontend

Agent:
Got you. **mauscode is the product itself**: a new full-stack agent application, with **JCode as the native managed runtime**, while the 1Code codebase is the starting point for the UI/product shell.

The key is preserving two things at the same time:

1. **1Code’s proven product/UI modules stay performant and intact** rather than rewriting everything just because the branding changed.
2. **JCode stays the performance-critical core/runtime**, with its own architecture and efficiency preserved rather than bolting a huge JS orchestration layer onto it.

That split is especially sensible because JCode already has a client/server harness boundary, and its current work explicitly calls for a versioned harness API with UI-independent runtime logic. ([GitHub][1])

## The corrected init checklist

### 1. Freeze the two upstream baselines

Create an `UPSTREAM.md` immediately.

```text
1Code baseline
commit: <exact SHA>

JCode baseline
commit: <exact SHA>
```

Record:

* [ ] exact commit SHA
* [ ] license
* [ ] upstream repository
* [ ] dependency versions
* [ ] build instructions
* [ ] benchmark numbers
* [ ] known limitations
* [ ] local modifications from day zero

**Do not start with a moving upstream branch.**

1Code is archived and read-only as of July 7, 2026, which makes a fixed baseline especially appropriate. It is Apache-2.0. ([GitHub][2])

---

# 2. Establish the sacred rule

Put this in `CONTRIBUTING.md`:

> **No feature may materially degrade runtime performance, memory efficiency, rendering performance, startup time, or existing UI behavior without an explicit benchmark and architectural justification.**

Then add:

```text
performance/
ui-regression/
protocol/
compatibility/
```

Every substantial change should answer:

```text
What did this improve?
What did this cost?
What existing behavior did it preserve?
```

This is especially important because JCode's published measurements show very low baseline memory and session scaling compared with several popular coding CLIs. Treat those numbers as **benchmarks to reproduce**, not promises to preserve blindly. ([GitHub][3])

---

# 3. Do not “merge 1Code + JCode”

That's the trap.

Instead:

```text
mauscode/
│
├── app/                 ← 1Code-derived product/UI
│
├── runtime/
│   └── jcode/           ← JCode
│
├── protocol/            ← new stable contract
│
├── server/
│   └── control-plane/   ← your managed services
│
└── integrations/
    ├── opencode/
    ├── claude/
    ├── codex/
    ├── hermes/
    └── ...
```

You're creating a **vertical seam** between them.

```text
             MAUSCODE
                 │
        ┌────────▼────────┐
        │ Runtime Protocol│
        └────────┬────────┘
                 │
             JCode
```

The UI doesn't reach into JCode's internals.

JCode doesn't learn about React components.

---

# 4. Make JCode the canonical runtime

Everything native goes through:

```text
JCode
```

Not:

```text
“whatever agent happens to be installed”
```

Native features should eventually include:

* [ ] agent sessions
* [ ] PTY/terminal
* [ ] filesystem
* [ ] process lifecycle
* [ ] git/worktrees
* [ ] context/state
* [ ] tools
* [ ] MCP
* [ ] skills
* [ ] permissions
* [ ] model/provider routing
* [ ] workspace lifecycle
* [ ] checkpoints/resume
* [ ] streaming events

Then external agents become compatibility layers.

That means:

```text
Native
  JCode

Optional
  Claude Code
  Codex
  OpenCode
  Hermes
```

---

# 5. Define the runtime protocol before UI integration

JCode currently has an internal NDJSON protocol, but its own rewrite plan calls out that the existing API is internal, unversioned and coupled to rendering assumptions. The intended direction is a stable, versioned harness boundary. ([GitHub][1])

So make **your protocol** the official boundary.

At minimum:

```text
hello
capabilities
workspace
session
message
tool
approval
terminal
filesystem
git
process
preview
error
heartbeat
```

Every event gets:

```json
{
  "version": 1,
  "request_id": "...",
  "type": "...",
  "payload": {}
}
```

And critically:

**no UI-specific structures inside the protocol.**

---

# 6. Keep JCode's hot path stupidly small

This should be a hard engineering principle.

```text
UI
 ↓
transport
 ↓
JCode
 ↓
OS/process/filesystem/network
```

Avoid:

```text
UI
 ↓
React state
 ↓
Node middleware
 ↓
JSON transformation
 ↓
another event bus
 ↓
JCode
```

for operations that can be direct.

Every extra serialization layer is potentially:

* CPU
* memory
* latency
* garbage
* complexity

And your selling point is precisely that **mauscode feels lighter than OpenCode while doing more**.

---

# 7. Rebuild 1Code's backend around JCode instead of deleting functionality

Don't think:

> “Strip 1Code backend.”

Think:

> **“Replace the execution authority while preserving useful product modules.”**

Inventory every existing 1Code backend component:

```text
Auth
Projects
Sessions
Git
Worktrees
Tasks
Providers
Agent lifecycle
Sandbox
Terminal
Files
Preview
Notifications
Background jobs
Storage
Settings
```

Mark each:

```text
KEEP
ADAPT
REPLACE WITH JCODE
REIMPLEMENT
REMOVE
```

The goal is **surgical replacement**, not a rewrite for the sake of a rewrite.

---

# 8. Keep the 1Code UI as a reference implementation

Don't immediately redesign every screen.

First get:

```text
1Code UI
   ↓
your runtime protocol
   ↓
JCode
```

working.

That gives you a functioning vertical slice.

Then redesign the UI **incrementally**.

This matters because otherwise you'll have:

```text
new UI
+ new backend
+ new runtime
+ new protocol
+ new auth
```

and you won't know which layer broke something.

---

# 9. Build your own design system after the vertical slice

Once the original flow works:

```text
mauscode-ui/
├── primitives
├── tokens
├── surfaces
├── typography
├── command-palette
├── session
├── tool-cards
├── diff
├── terminal
├── file-tree
├── runtime-picker
└── device-picker
```

Then establish strict UI rules:

* [ ] no gratuitous animations
* [ ] virtualize large lists
* [ ] lazy-load heavy panels
* [ ] minimal websocket payloads
* [ ] no repeated serialization
* [ ] stable scrolling
* [ ] no giant raw tool-output walls
* [ ] preserve keyboard-first workflows
* [ ] instant optimistic interactions where safe

T3 Code's own development guidance specifically emphasizes performance regressions from excessive WebSocket data, CSS animations/GPU load and poorly rendered lists. That's a good benchmark for your UI engineering discipline. ([GitHub][4])

---

# 10. Build the managed JCode node

This is different from “support SSH.”

Your native runtime becomes:

```text
mauscode node
```

A small daemon:

```text
mauscode node start
```

Its responsibilities:

```text
register
authenticate
heartbeat
receive workspace
spawn JCode
stream events
accept commands
reconnect
update
shutdown
```

The app sees:

```text
This computer
Linux Box
Docker
Daytona
```

but underneath, your abstraction is:

```text
RuntimeProvider
```

---

# 11. Make remote execution transport-agnostic

Define:

```text
RuntimeProvider
├── LocalJCode
├── RemoteJCode
├── SSHJCode
├── DockerJCode
└── DaytonaJCode
```

The important bit:

**all of these launch/use JCode.**

You're not implementing five different agents.

You're implementing five ways to **place the JCode runtime**.

---

# 12. Build the T3-connect-style device layer

T3 Code's current architecture is a useful reference here: its server acts as the execution runtime and exposes HTTP/WebSocket interfaces, while its remote-access system provides a relay/authentication layer for reaching those runtimes. ([GitHub][5])

Your equivalent:

```text
mauscode cloud
      │
   device registry
      │
    relay
      │
 ┌────┴────┐
 │         │
PC       Linux box
 │         │
JCode     JCode
```

Device identity:

```text
device_id
public_key
name
platform
arch
jcode_version
capabilities
last_seen
status
```

---

# 13. BYOK belongs inside JCode

Don't make BYOK a UI-only feature.

The actual provider configuration should be runtime-level:

```text
ProviderConfig
 ├─ provider
 ├─ model
 ├─ endpoint
 ├─ credential_ref
 └─ capabilities
```

Then:

```text
mauscode
   ↓
JCode
   ↓
user's provider
```

No mandatory platform model.

No hidden proxy unless explicitly enabled.

---

# 14. Native agent features

Now steal the **good ideas**, not implementations.

### From OpenCode

Think:

* session architecture
* subagents
* permissions
* MCP
* skills
* context management
* configurable agent behavior

### From Hermes Agent

Think:

* broad execution backends
* persistent sessions
* remote environments
* skills
* autonomous workflows

### From desktop agents

Think:

* persistent workspace
* background work
* notifications
* voice
* task queues
* device awareness

But everything gets implemented **through JCode**.

---

# 15. Compatibility layer

Only now:

```text
AgentAdapter
```

Examples:

```text
ClaudeCode
Codex
OpenCode
Hermes
```

The adapter should translate:

```text
mauscode protocol
       ↕
foreign agent protocol
```

It should **not** infect the native runtime architecture.

---

# 16. Import/migration

Eventually:

```text
Import environment
```

Detect:

```text
Claude
Codex
OpenCode
Hermes
Cursor
MCP
skills
rules
AGENTS.md
CLAUDE.md
.git configuration
```

Then:

```text
Detected Claude Code

Skills       14
MCP servers   6
Rules         3
Models        4

[Import]
```

This is a killer onboarding feature.

---

# 17. Managed cloud architecture

Your hosted product should ideally be:

```text
                mauscode.com
                    │
          ┌─────────▼─────────┐
          │    Control Plane  │
          │                   │
          │ Auth              │
          │ Devices           │
          │ Workspaces        │
          │ Sessions metadata │
          │ Relay             │
          └─────────┬─────────┘
                    │
                 secure
                  tunnel
                    │
          ┌─────────▼─────────┐
          │    JCode Node     │
          │                   │
          │ workspace         │
          │ agent             │
          │ terminal          │
          │ filesystem        │
          │ git               │
          └───────────────────┘
```

That gives you a very clean boundary:

**cloud = coordination**

**JCode = computation**

---

# 18. Performance CI is non-negotiable

Every release should benchmark:

```text
cold startup
warm startup
first response
first tool call
session creation
session resume
terminal startup
filesystem operations
event throughput
memory idle
memory/session
CPU idle
CPU/session
remote latency
```

Especially:

```text
1 session
5 sessions
10 sessions
25 sessions
50 sessions
```

Your claim shouldn't become:

> “We're faster than OpenCode.”

It should become:

> **“Here is reproducible benchmark X, using version Y, workload Z.”**

That's much more credible.

---

# 19. Security architecture before remote beta

Because this becomes a managed runtime that can execute commands on real machines:

```text
identity
↓
device authentication
↓
workspace authorization
↓
agent permissions
↓
tool permissions
↓
filesystem scope
↓
network scope
↓
secret scope
```

Make every boundary explicit.

The old 1Code repo also has a documented critical permission-bypass issue around agent permissions, so I would treat inherited execution permissions as **untrusted until re-audited**. ([GitHub][6])

---

# 20. Your first milestone should be tiny

Don't start with Daytona, migration, 8 agent adapters and cloud sync.

Get this working:

```text
                    MAUSCODE
                       │
                 beautiful UI
                       │
                runtime protocol
                       │
                     JCode
                       │
              local workspace
                       │
                    BYOK
                       │
                   tool call
                       │
                    result
```

Then prove:

```text
same UI
same workspace
same session

        ↓

local JCode
        ↓
remote JCode
```

without changing application behavior.

**That is the architectural proof.**

---

## And the single most important repo rule

I'd literally put this at the very top of the engineering docs:

> **mauscode is not a fork of 1Code with JCode attached. It is a new agent platform whose product/UI foundation originated from 1Code and whose native execution engine is JCode. Every architectural change must preserve the performance characteristics of JCode and the proven interaction modules of 1Code.**

That's the model you're describing.

And honestly, **the fact that current JCode is already moving toward a stable harness API separate from its UI makes this an unusually good time to build that seam cleanly rather than coupling the two.** ([GitHub][1])

[1]: https://github.com/1jehuang/jcode/blob/master/docs/HARNESS_API_AND_DESKTOP_REWRITE.md?utm_source=chatgpt.com "jcode/docs/HARNESS_API_AND_DESKTOP_REWRITE.md at master · 1jehuang/jcode · GitHub"
[2]: https://github.com/21st-dev/1code/blob/main/LICENSE?utm_source=chatgpt.com "1code/LICENSE at main · 21st-dev/1code · GitHub"
[3]: https://github.com/1jehuang/jcode?ref=grigio.org&utm_source=chatgpt.com "GitHub - 1jehuang/jcode at grigio.org · GitHub"
[4]: https://github.com/yappologistic/FACT3/blob/main/AGENTS.md?utm_source=chatgpt.com "FACT3/AGENTS.md at main · yappologistic/FACT3 · GitHub"
[5]: https://github.com/pingdotgg/t3code/blob/main/docs/internals/t3-connect.md?utm_source=chatgpt.com "t3code/docs/internals/t3-connect.md at main · pingdotgg/t3code · GitHub"
[6]: https://github.com/21st-dev/1code/issues/104?utm_source=chatgpt.com "[CRITICAL] Dangerous permissions bypassed in agent mode · Issue #104 · 21st-dev/1code · GitHub"


EOF
