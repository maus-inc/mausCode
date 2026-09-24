/**
 * The registry entries the 0.3.270 pin renamed, and the sharing that keeps the
 * two spellings of one tool from drifting apart. The names come from the pinned
 * CLI itself: grepping the 2.1.270 platform binary for its emitted tool table
 * returns `Agent`, `TaskOutput` and `TaskStop` with no `Task`, no `BashOutput`
 * and no `KillShell`, and its normalization table maps `KillShell` and
 * `KillBash` to `TaskStop` and `BashOutput`, `BashOutputTool`, `AgentOutput`,
 * `AgentOutputTool` to `TaskOutput`. The legacy keys stay registered because
 * transcripts persisted before the bump carry them.
 */
import { describe, expect, it } from "vitest"
import { isSubagentToolType, SUBAGENT_TOOL_TYPES } from "../lib/subagent-tool-types"
import { AgentToolRegistry, type ToolDisplayPart } from "./agent-tool-registry"

const pendingSubagent: ToolDisplayPart = {
  state: "input-available",
  input: { subagent_type: "Explore", description: "Audit the permission gate" },
}

const streamingSubagent: ToolDisplayPart = {
  state: "input-streaming",
  input: { subagent_type: "Explore", description: "Audit the permission gate" },
}

const finishedSubagent: ToolDisplayPart = {
  state: "output-available",
  input: {
    subagent_type: "Explore",
    description: "Read the transform and list every chunk kind it emits",
  },
  output: { task: { subject: "Run the gate" } },
}

const taskOutputById: ToolDisplayPart = {
  state: "output-available",
  input: { task_id: "bg_7" },
  output: { task: { subject: "Run the gate" } },
}

const shellOutputByPid: ToolDisplayPart = {
  state: "input-available",
  input: { pid: 4242 },
}

describe("agent tool registry: renamed sub-agent and background task tools", () => {
  it("registers the sub-agent under both names as one meta", () => {
    expect(AgentToolRegistry["tool-Agent"]).toBeDefined()
    // Same object, not an equal copy: two entries for one tool drift apart the
    // first time someone edits the wording of one of them.
    expect(AgentToolRegistry["tool-Agent"]).toBe(AgentToolRegistry["tool-Task"])
  })

  it("registers TaskOutput as the meta BashOutput already had", () => {
    expect(AgentToolRegistry["tool-TaskOutput"]).toBe(AgentToolRegistry["tool-BashOutput"])
    expect(AgentToolRegistry["tool-TaskStop"]).toBeDefined()
    expect(AgentToolRegistry["tool-KillShell"]).toBeDefined()
  })

  // The pinned CLI's normalization table folds these six names into the two it
  // emits, so each one has to reach the same meta or a persisted call renders as
  // an unnamed generic row. Listed here rather than derived from the registry:
  // dropping a key from the registry must fail this test, not shrink it.
  it.each(["tool-BashOutput", "tool-BashOutputTool", "tool-AgentOutput", "tool-AgentOutputTool"])(
    "routes %s to the TaskOutput meta",
    (alias) => {
      expect(AgentToolRegistry[alias]).toBe(AgentToolRegistry["tool-TaskOutput"])
    },
  )

  it.each(["tool-KillShell", "tool-KillBash"])("routes %s to the shell-stopping meta", (alias) => {
    expect(AgentToolRegistry[alias]).toBe(AgentToolRegistry["tool-KillShell"])
    // The current name says task, because what it stops may be a sub-agent.
    expect(AgentToolRegistry[alias]).not.toBe(AgentToolRegistry["tool-TaskStop"])
  })

  it("titles a sub-agent by state", () => {
    const meta = AgentToolRegistry["tool-Agent"]
    expect(meta.title(streamingSubagent)).toBe("Preparing agent")
    expect(meta.title(pendingSubagent)).toBe("Running Explore")
    expect(meta.title(finishedSubagent)).toBe("Explore completed")
  })

  it("names the sub-agent even when the payload carries no type", () => {
    const meta = AgentToolRegistry["tool-Agent"]
    expect(meta.title({ state: "input-available", input: {} })).toBe("Running Agent")
    expect(meta.title({ state: "output-available", input: {} })).toBe("Agent completed")
  })

  it("calls a launched sub-agent a launch, not a completion", () => {
    const meta = AgentToolRegistry["tool-Agent"]
    const base: ToolDisplayPart = {
      state: "output-available",
      input: { subagent_type: "Explore", description: "Hand the run off" },
    }
    expect(meta.title({ ...base, output: { status: "async_launched" } })).toBe("Explore launched")
    expect(meta.title({ ...base, output: { status: "remote_launched" } })).toBe("Explore launched")
    // A real completion still says so.
    expect(meta.title({ ...base, output: { status: "completed" } })).toBe("Explore completed")
  })

  it("truncates a long sub-agent description and hides it while streaming", () => {
    const meta = AgentToolRegistry["tool-Agent"]
    expect(meta.subtitle?.(streamingSubagent)).toBe("")
    expect(meta.subtitle?.(pendingSubagent)).toBe("Audit the permission gate")
    // The registry's rule is 47 characters plus an ellipsis, so a 53 character
    // description loses its last word rather than growing the row.
    expect(meta.subtitle?.(finishedSubagent)).toBe(
      "Read the transform and list every chunk kind it...",
    )
  })

  it("reads a task id or a shell pid into one subtitle", () => {
    const meta = AgentToolRegistry["tool-TaskOutput"]
    expect(meta.title(shellOutputByPid)).toBe("Getting output")
    expect(meta.subtitle?.(shellOutputByPid)).toBe("PID: 4242")
    expect(meta.title(taskOutputById)).toBe("Got output")
    expect(meta.subtitle?.(taskOutputById)).toBe("Task: bg_7")
    expect(meta.subtitle?.({ state: "output-available", input: {} })).toBe("")
  })

  it("says task for TaskStop and shell for the name it replaced", () => {
    expect(AgentToolRegistry["tool-TaskStop"].title(shellOutputByPid)).toBe("Stopping task")
    expect(AgentToolRegistry["tool-TaskStop"].title(taskOutputById)).toBe("Stopped task")
    expect(AgentToolRegistry["tool-KillShell"].title(shellOutputByPid)).toBe("Stopping shell")
    expect(AgentToolRegistry["tool-KillShell"].title(taskOutputById)).toBe("Stopped shell")
    // Both read the same subtitle, so a task id renders under either name.
    expect(AgentToolRegistry["tool-TaskStop"].subtitle?.(taskOutputById)).toBe("Task: bg_7")
  })

  it("counts the sub-agent family and leaves the background task family out", () => {
    expect([...SUBAGENT_TOOL_TYPES]).toEqual(["tool-Task", "tool-Agent"])
    expect(isSubagentToolType("tool-Task")).toBe(true)
    expect(isSubagentToolType("tool-Agent")).toBe(true)
    // Same prefix, different tool: these manage background work, not sub-agents.
    expect(isSubagentToolType("tool-TaskCreate")).toBe(false)
    expect(isSubagentToolType("tool-TaskStop")).toBe(false)
    expect(isSubagentToolType("tool-TaskOutput")).toBe(false)
    expect(isSubagentToolType("tool-Bash")).toBe(false)
  })
})
