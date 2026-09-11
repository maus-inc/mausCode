# DeepSource catalog, 2026-09-11

Project `maus-inc/mausCode`, code analysis active, SCA inactive. Analyzers
that have run: JavaScript, Rust, Shell, SQL. Default branch `main`. Last
analyzer run recorded against commit `9f1bc76`.

## Category totals from the overview page

| Category | Count |
| --- | --- |
| Anti-patterns | 4.2k |
| Performance | 288 |
| Security | 8 |
| Style | 0 |
| Documentation | 0 |
| Coverage | 0 |
| Active issues | 4.7k |
| Issues prevented | 0 |

## Security: one check, eight occurrences

All 8 security issues are `JS-0440`, "Avoid using dangerous JSX properties",
major severity, seen in 6 files. `JS-0440` flags `dangerouslySetInnerHTML`.

`grep -rn dangerouslySetInnerHTML src/` on this branch before any fix returns 8
hits in 6 files, which matches DeepSource exactly.

| File | Injected value | Verdict |
| --- | --- | --- |
| `src/renderer/features/agents/ui/agent-tool-call.tsx:48` | `subtitleStr`, a coerced string | Vulnerable. Fixed. |
| `src/renderer/features/agents/ui/agent-tool-call.tsx:64` | `subtitleStr`, a coerced string | Vulnerable. Fixed. |
| `src/renderer/components/chat-markdown-renderer.tsx:133` | `htmlContent` from shiki | Safe, shiki escapes its input |
| `src/renderer/components/mermaid-block.tsx:451` | Mermaid-rendered SVG | Depends on `securityLevel`, see below |
| `src/renderer/components/mermaid-block.tsx:528` | Mermaid-rendered SVG | Depends on `securityLevel`, see below |
| `src/renderer/features/agents/ui/agent-edit-tool.tsx:192` | shiki output | Safe |
| `src/renderer/features/agents/ui/agent-mcp-tool-call.tsx:190` | shiki output | Safe |
| `src/renderer/features/agents/ui/message-json-display.tsx:88` | shiki output | Safe |

### The agent-tool-call sink

`AgentToolCall` received `subtitle` and rendered it with
`dangerouslySetInnerHTML={{ __html: subtitleStr }}`. The subtitles come from
`src/renderer/features/agents/ui/agent-tool-registry.tsx`, where they are built
from tool input:

- `tool-Task`: `part.input.description`
- `tool-Grep`: `part.input.pattern` and `part.input.path`
- `tool-Glob`: `part.input.pattern` and `part.input.target_directory`
- and the same shape for the remaining entries

Those values originate in the model's tool call and in the repository the model
is reading. A file named `<img src=x onerror=...>` inside a cloned repository,
surfaced by a Grep or Glob call, would have been parsed as HTML in the Electron
renderer. Renderer JavaScript reaches the preload bridge, and the bridge
exposes terminal creation, so this is a path from a malicious repository to
command execution on the user's machine.

Across the whole registry only one subtitle intentionally produced markup,
`tool-Edit` at line 275, which returned an HTML string for the `+N -N` diff
counts. One caller's formatting need turned the shared component into an HTML
sink for every other tool.

The fix keeps `subtitle` a plain string that React renders as text, and moves
the diff counts into a typed `diffStats` prop that renders a real element. No
markup path remains in `AgentToolCall`, and the prop stays a primitive so
`memo` comparison still works.

### The mermaid configuration

`src/renderer/components/mermaid-block.tsx:129` set `securityLevel: "loose"`.
In `loose` mode Mermaid allows raw HTML in node labels and honours `click`
directives that bind JavaScript. Diagram source is agent-authored markdown,
including content read out of untrusted repositories. Changed to `"strict"`,
Mermaid's default, which encodes HTML in diagram text and disables click
callbacks.

Side effect worth knowing: a diagram that relied on `<br/>` inside a label now
shows the literal text. That is the intended trade. Recorded in
`.dump/global/questions.md` as a reversible decision.

## Performance and anti-pattern categories

DeepSource reports 288 performance and 4.2k anti-pattern issues, but the issue
list pages require a logged-in session, so only the category counts are
available from here. The 8 security issues were readable without a session
because that page renders server-side.

The overlap with SonarCloud is likely large. SonarCloud already reports the
React-specific performance rules that DeepSource would call anti-patterns:
S6478 (`React.memo` misuse, 44), S6479 (unstable JSX keys, 39), S6759 (unused
props, 258). Treating the two dashboards as independent counts would
double-count most of the renderer findings.

## Access notes

`app.deepsource.com` serves the overview and the security category list without
authentication. Filtered issue lists and the per-issue occurrence pages need a
session. There is no public REST endpoint for DeepSource issue data.
