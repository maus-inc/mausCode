/**
 * The task-row memo's view of the message-level nesting map. The regression
 * under test: comparing that map through `arePartsEqual` walks the shared
 * module-level tool-state cache, so the FIRST task row's comparator consumed
 * every streaming grandchild's mutation and the rows after it saw a clean
 * cache and skipped re-render. A pure fingerprint (computed once per render
 * in the message component) makes every row's answer identical, because
 * neither of them writes anything.
 */
import { describe, expect, it } from "vitest"
import type { ToolPartLike } from "./agent-tool-state"
import { areTaskToolPropsEqual, areToolPropsEqual, nestingFingerprintOf } from "./agent-tool-utils"

function taskPart(id: string): ToolPartLike {
  return {
    type: "tool-Task",
    toolCallId: id,
    state: "output-available",
    input: { subagent_type: "Explore", description: "walk" },
    output: { status: "completed", totalSteps: 3 },
  }
}

function grandchild(
  id: string,
  filePath: string,
  state: string = "output-available",
): ToolPartLike {
  return {
    type: "tool-Read",
    toolCallId: id,
    state,
    input: { file_path: filePath },
    output: { content: `contents of ${filePath}` },
  }
}

/** Two independent maps with structurally identical content. */
function twinMaps(): { a: Map<string, ToolPartLike[]>; b: Map<string, ToolPartLike[]> } {
  const a = new Map<string, ToolPartLike[]>([
    ["A", [taskPart("A")]],
    ["A:B", [grandchild("A:B:C", "src/one.ts")]],
  ])
  const b = new Map<string, ToolPartLike[]>([
    ["A", [taskPart("A")]],
    ["A:B", [grandchild("A:B:C", "src/one.ts")]],
  ])
  return { a, b }
}

describe("nestingFingerprintOf", () => {
  it("is empty for an absent or empty map", () => {
    expect(nestingFingerprintOf(undefined)).toBe("")
    expect(nestingFingerprintOf(new Map())).toBe("")
  })

  it("is stable across rebuilds with equal content", () => {
    const { a, b } = twinMaps()
    // A rebuilt map yields the same string, and string identity (not map
    // identity) is what the row memo compares.
    expect(nestingFingerprintOf(a)).toBe(nestingFingerprintOf(b))
  })

  it("changes when a streaming grandchild mutates in place", () => {
    const map = new Map<string, ToolPartLike[]>([
      ["A", [taskPart("A")]],
      ["A:B", [grandchild("A:B:C", "src/one.ts", "input-streaming")]],
    ])
    const before = nestingFingerprintOf(map)
    // The AI SDK mutates parts in place — same part, same input object, the
    // file_path rewritten underneath. A live (non-terminal) part is
    // re-serialized every render, so the fingerprint sees it.
    const child = map.get("A:B")?.[0]
    expect(child).toBeDefined()
    const input = child?.input as { file_path: string }
    input.file_path = "src/two.ts"
    const after = nestingFingerprintOf(map)
    expect(after).not.toBe(before)
  })

  it("holds a settled terminal part's segment until a reference moves", () => {
    // The round-9 cost bound: a completed part whose input/output references
    // have not moved is not re-stringified, so a deep rewrite of a FINISHED
    // part does not reach the fingerprint — the SDK does not reopen one.
    // What keeps it honest is the other half: a changed reference or state
    // re-serializes immediately, which is the case the row memos feed on.
    const map = new Map<string, ToolPartLike[]>([
      ["A:B", [grandchild("A:B:C", "src/one.ts")]], // terminal by default
    ])
    const before = nestingFingerprintOf(map)
    const child = map.get("A:B")?.[0]
    const input = child?.input as { file_path: string }
    input.file_path = "src/deep-rewritten.ts" // same reference, settled part
    expect(nestingFingerprintOf(map)).toBe(before)

    // A new input object (the shape a replacement takes) breaks the settle.
    if (child) child.input = { file_path: "src/replaced.ts" }
    expect(nestingFingerprintOf(map)).not.toBe(before)
  })

  it("changes when only a terminal part's result is replaced", () => {
    // CodeAnt 4104721117: the ask card renders `result`, so a wholesale
    // replacement with state, input, and output all untouched has to move
    // the fingerprint — the settle gate compares the reference too.
    const part: ToolPartLike = {
      type: "tool-AskUserQuestion",
      toolCallId: "result-only-call",
      state: "result",
      input: { questions: [{ question: "Which pin?", header: "Pin" }] },
      result: { answers: { "Which pin?": "0.3.270" } },
    }
    const before = nestingFingerprintOf(new Map([["A", [part]]]))
    part.result = { answers: { "Which pin?": "0.3.280" } }
    const after = nestingFingerprintOf(new Map([["A", [part]]]))
    expect(after).not.toBe(before)
  })

  it("changes when a nested part's state moves from pending to done", () => {
    const map = new Map<string, ToolPartLike[]>([
      [
        "A:B",
        [
          {
            type: "tool-Read",
            toolCallId: "A:B:C",
            state: "input-available",
            input: { file_path: "src/one.ts" },
          },
        ],
      ],
    ])
    const before = nestingFingerprintOf(map)
    const child = map.get("A:B")?.[0]
    if (child) child.state = "output-available"
    expect(nestingFingerprintOf(map)).not.toBe(before)
  })
})

describe("areTaskToolPropsEqual fingerprint comparison", () => {
  const ownPart = taskPart("A")
  const ownNested: ToolPartLike[] = [grandchild("A:B:C", "src/one.ts")]

  /**
   * First sight of a toolCallId always counts as changed — `hasToolStateChanged`
   * seeds the shared cache on the way past, the same one-time render production
   * does after mount. Accept-expectations run after this priming pass.
   */
  function primeCache(): void {
    const props = { part: ownPart, nestedTools: ownNested }
    // The comparator returns early on the first uncached id, so one pass
    // seeds the main part only; a second pass seeds the nested list too.
    areTaskToolPropsEqual(props, { ...props })
    areTaskToolPropsEqual(props, { ...props })
  }

  it("rejects when the fingerprint moved — twice in a row", () => {
    // The old cache-backed comparator returned true on the SECOND call: the
    // first call had consumed the mutation for everyone. Two identical calls
    // must both reject, or the next task row in the list never re-renders.
    const { a, b } = twinMaps()
    const before = nestingFingerprintOf(a)
    const child = b.get("A:B")?.[0]
    if (child) child.output = { content: "streamed further" }
    const after = nestingFingerprintOf(b)

    const prev = { part: ownPart, nestedTools: ownNested, nestingFingerprint: before }
    const next = { part: ownPart, nestedTools: ownNested, nestingFingerprint: after }
    expect(areTaskToolPropsEqual(prev, next)).toBe(false)
    expect(areTaskToolPropsEqual(prev, next)).toBe(false)
  })

  it("accepts when content is equal under a rebuilt map", () => {
    const { a, b } = twinMaps()
    const prev = {
      part: ownPart,
      nestedTools: ownNested,
      nestingFingerprint: nestingFingerprintOf(a),
    }
    const next = {
      part: ownPart,
      nestedTools: ownNested,
      nestingFingerprint: nestingFingerprintOf(b),
    }
    primeCache()
    expect(areTaskToolPropsEqual(prev, next)).toBe(true)
  })

  it("accepts two rows with no fingerprint and no nesting at all", () => {
    const props = { part: ownPart, nestedTools: ownNested }
    primeCache()
    expect(areTaskToolPropsEqual(props, { ...props })).toBe(true)
  })

  it("still falls back to lookup identity when no fingerprint is supplied", () => {
    const lookup = () => ownNested
    const props = { part: ownPart, nestedTools: ownNested, nestedChildren: lookup }
    primeCache()
    expect(areTaskToolPropsEqual(props, { ...props })).toBe(true)
    expect(areTaskToolPropsEqual(props, { ...props, nestedChildren: () => ownNested })).toBe(false)
  })

  it("still detects a change in the row's own part", () => {
    const { a } = twinMaps()
    const fp = nestingFingerprintOf(a)
    const mutated = taskPart("A")
    mutated.state = "input-streaming"
    expect(
      areTaskToolPropsEqual(
        { part: ownPart, nestedTools: ownNested, nestingFingerprint: fp },
        { part: mutated, nestedTools: ownNested, nestingFingerprint: fp },
      ),
    ).toBe(false)
  })
})

describe("areToolPropsEqual", () => {
  it("moves the row when only a terminal part's result is replaced", () => {
    // Same claim at the row level (CodeAnt 4104721522's sibling): the ask
    // card renders `result`, so the row snapshot has to compare it — by
    // reference, because every writer assigns it wholesale alongside the
    // state flip rather than mutating it in place.
    const part: ToolPartLike = {
      type: "tool-AskUserQuestion",
      toolCallId: "row-result-only-call",
      state: "result",
      input: { questions: [{ question: "Which pin?", header: "Pin" }] },
      result: { answers: { "Which pin?": "0.3.270" } },
    }
    expect(areToolPropsEqual({ part }, { part })).toBe(false) // first call primes
    expect(areToolPropsEqual({ part }, { part })).toBe(true) // nothing moved
    part.result = { answers: { "Which pin?": "0.3.280" } }
    expect(areToolPropsEqual({ part }, { part })).toBe(false) // result-only change
  })
})
