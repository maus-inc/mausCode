/**
 * The tool types that mean "a sub-agent is running", under every name the
 * pinned Claude CLI has used for it.
 *
 * The 2.1.270 binary emits `Agent`. Its own normalization table maps the older
 * spellings to the current ones, and the SDK changelog at 0.2.69 records why
 * both exist: the wire name was reverted to `Task` with the note that it "will
 * migrate to `Agent` in the next minor release", which the 0.3 line did. So a
 * transcript persisted before the bump carries `Task` and one recorded after it
 * carries `Agent`, and grouping, dispatch and suppression all have to treat the
 * two as one tool or a resumed session renders differently from a new one.
 *
 * The background-task family is NOT in this list. `TaskCreate`, `TaskUpdate`,
 * `TaskGet`, `TaskList` and `TaskStop` share the `Task` prefix and nothing else:
 * they manage background shells and tasks, not sub-agents, and
 * `assistant-message-item.tsx` keeps its own `TASK_TOOLS` set for them.
 */
export const SUBAGENT_TOOL_TYPES = ["tool-Task", "tool-Agent"] as const

export type SubagentToolType = (typeof SUBAGENT_TOOL_TYPES)[number]

const SUBAGENT_TOOL_TYPE_SET: ReadonlySet<string> = new Set(SUBAGENT_TOOL_TYPES)

export function isSubagentToolType(type: string): type is SubagentToolType {
  return SUBAGENT_TOOL_TYPE_SET.has(type)
}
