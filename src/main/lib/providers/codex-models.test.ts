/**
 * mausCode-authored tests for the Codex default-model resolver. The catalog
 * read runs against the app-server mock peer over real stdio, so the spawn,
 * the JSON-RPC handshake, the `model/list` decode and the child cleanup are
 * all exercised, not stubbed.
 */
import { assert, beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_UI_MODEL,
} from "../../../shared/codex-model-id"
import {
  type CodexCatalogModel,
  clearCodexDefaultModelCache,
  type KnownCodexModel,
  peekCodexDefaultModel,
  readCodexModelCatalog,
  resolveCodexDefaultModel,
  selectCodexDefault,
} from "./codex-models.ts"

const peerPath = new URL(
  "../codex-app-server/test/fixtures/codex-app-server-turn-mock-peer.ts",
  import.meta.url,
).pathname

const peer = (env: Record<string, string> = {}) => ({
  binaryPath: process.execPath,
  argv: [peerPath],
  versionArgs: [peerPath, "--version"],
  cwd: process.cwd(),
  env: { ...process.env, ...env } as Record<string, string>,
})

const EFFORTS = ["low", "medium", "high", "xhigh"]

const known = (ids: ReadonlyArray<string>): KnownCodexModel[] =>
  ids.map((id) => ({ id, efforts: EFFORTS }))

const entry = (over: Partial<CodexCatalogModel> & { id: string }): CodexCatalogModel => ({
  id: over.id,
  hidden: over.hidden ?? false,
  isDefault: over.isDefault ?? false,
  defaultReasoningEffort: over.defaultReasoningEffort ?? "medium",
})

beforeEach(() => {
  clearCodexDefaultModelCache()
  vi.restoreAllMocks()
})

describe("readCodexModelCatalog", () => {
  it("reads the catalog over model/list and reaps the child", async () => {
    const catalog = await readCodexModelCatalog(peer())

    assert.equal(catalog.length, 2)
    assert.deepEqual(catalog[1], {
      id: "gpt-mock",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "high",
    })
  })

  it("surfaces a catalog the server refuses as a thrown error", async () => {
    await expect(readCodexModelCatalog(peer({ MOCK_MODEL_LIST_FAIL: "1" }))).rejects.toThrow()
  })
})

describe("selectCodexDefault", () => {
  const knownBoth = known(["older", "current", "first", "second", "shown", "odd"])

  it("takes the entry the catalog marks default", () => {
    const selected = selectCodexDefault(
      [
        entry({ id: "older" }),
        entry({ id: "current", isDefault: true, defaultReasoningEffort: "high" }),
      ],
      knownBoth,
    )
    assert.deepEqual(selected, { modelId: "current", reasoningEffort: "high" })
  })

  it("falls back to the first known visible entry when nothing is marked", () => {
    const selected = selectCodexDefault(
      [entry({ id: "first" }), entry({ id: "second" })],
      knownBoth,
    )
    assert.deepEqual(selected, { modelId: "first", reasoningEffort: "medium" })
  })

  it("skips hidden entries, blank ids and ids the app does not know", () => {
    const selected = selectCodexDefault(
      [
        entry({ id: "", isDefault: true }),
        entry({ id: "renamed-upstream", isDefault: true }),
        entry({ id: "hidden", hidden: true, isDefault: true }),
        entry({ id: "shown" }),
      ],
      knownBoth,
    )
    assert.deepEqual(selected, { modelId: "shown", reasoningEffort: "medium" })
  })

  it("returns null for a catalog with nothing the app knows", () => {
    assert.equal(selectCodexDefault([], knownBoth), null)
    assert.equal(selectCodexDefault([entry({ id: "renamed-upstream" })], knownBoth), null)
  })

  it("substitutes the shared effort when the model does not support the catalog default", () => {
    const selected = selectCodexDefault(
      [entry({ id: "odd", isDefault: true, defaultReasoningEffort: "extreme" })],
      knownBoth,
    )
    assert.deepEqual(selected, { modelId: "odd", reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT })
  })
})

describe("resolveCodexDefaultModel", () => {
  const knownMocks = known(["gpt-mock", "gpt-mock-older"])

  it("resolves from the pinned CLI when it answers", async () => {
    const resolved = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })

    assert.equal(resolved.source, "cli")
    assert.equal(resolved.modelId, "gpt-mock")
    assert.equal(resolved.reasoningEffort, "high")
    assert.equal(resolved.fallbackReason, undefined)
  })

  it("exposes the resolved default to a caller that must not spawn", () => {
    assert.equal(peekCodexDefaultModel().source, "static-fallback")
  })

  it("degrades to the shared static default on an empty catalog and says why", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const resolved = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_EMPTY: "1" }),
      knownModels: knownMocks,
    })

    assert.equal(resolved.source, "static-fallback")
    assert.equal(resolved.modelId, DEFAULT_CODEX_UI_MODEL)
    assert.equal(resolved.reasoningEffort, DEFAULT_CODEX_REASONING_EFFORT)
    assert.equal(
      resolved.fallbackReason,
      "catalog listed 0 models and none matched the 2 the app knows",
    )
  })

  it("degrades to the shared static default when the catalog read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const resolved = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_FAIL: "1" }),
      knownModels: knownMocks,
    })

    assert.equal(resolved.source, "static-fallback")
    assert.equal(resolved.modelId, DEFAULT_CODEX_UI_MODEL)
    expect(resolved.fallbackReason?.length).toBeGreaterThan(0)
  })

  it("serves a successful read from cache until it is cleared", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    const first = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })
    assert.equal(first.source, "cli")
    assert.equal(info.mock.calls.length, 1)

    const second = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_FAIL: "1" }),
      knownModels: knownMocks,
    })
    assert.equal(second.source, "cli")
    assert.equal(info.mock.calls.length, 1, "a cache hit must not read the CLI again")

    clearCodexDefaultModelCache()
    const third = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })
    assert.equal(third.source, "cli")
    assert.equal(info.mock.calls.length, 2, "clearing the cache must read the CLI again")
  })

  it("re-reads when the binary version changes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await resolveCodexDefaultModel({
      ...peer({ MOCK_CODEX_VERSION: "codex-mock 1.0.0" }),
      knownModels: knownMocks,
    })
    assert.equal(info.mock.calls.length, 1)

    await resolveCodexDefaultModel({
      ...peer({ MOCK_CODEX_VERSION: "codex-mock 2.0.0" }),
      knownModels: knownMocks,
    })
    assert.equal(info.mock.calls.length, 2, "a new binary version must invalidate the cache")
  })

  it("retries a failed read once its short cache window passes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    let now = 0
    const at = (env: Record<string, string>) => ({
      ...peer(env),
      knownModels: knownMocks,
      now: () => now,
    })

    const failed = await resolveCodexDefaultModel(at({ MOCK_MODEL_LIST_FAIL: "1" }))
    assert.equal(failed.source, "static-fallback")
    assert.equal(warn.mock.calls.length, 1)

    const cached = await resolveCodexDefaultModel(at({}))
    assert.equal(cached.source, "static-fallback", "the fallback is cached so a turn is not slow")
    assert.equal(warn.mock.calls.length, 1)

    now += 61_000
    const retried = await resolveCodexDefaultModel(at({}))
    assert.equal(retried.source, "cli")
    assert.equal(retried.modelId, "gpt-mock")
  })
})
