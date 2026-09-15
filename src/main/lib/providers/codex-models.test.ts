/**
 * mausCode-authored tests for the Codex default-model resolver. The catalog
 * read runs against the app-server mock peer over real stdio, so the spawn,
 * the JSON-RPC handshake, the `model/list` decode and the child cleanup are
 * all exercised, not stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
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

    expect(catalog).toHaveLength(2)
    expect(catalog[1]).toEqual({
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
    expect(selected).toEqual({ modelId: "current", reasoningEffort: "high" })
  })

  it("falls back to the first known visible entry when nothing is marked", () => {
    const selected = selectCodexDefault(
      [entry({ id: "first" }), entry({ id: "second" })],
      knownBoth,
    )
    expect(selected).toEqual({ modelId: "first", reasoningEffort: "medium" })
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
    expect(selected).toEqual({ modelId: "shown", reasoningEffort: "medium" })
  })

  it("returns null for a catalog with nothing the app knows", () => {
    expect(selectCodexDefault([], knownBoth)).toBeNull()
    expect(selectCodexDefault([entry({ id: "renamed-upstream" })], knownBoth)).toBeNull()
  })

  it("substitutes the shared effort when the model does not support the catalog default", () => {
    const selected = selectCodexDefault(
      [entry({ id: "odd", isDefault: true, defaultReasoningEffort: "extreme" })],
      knownBoth,
    )
    expect(selected).toEqual({ modelId: "odd", reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT })
  })
})

describe("resolveCodexDefaultModel", () => {
  const knownMocks = known(["gpt-mock", "gpt-mock-older"])

  it("resolves from the pinned CLI when it answers", async () => {
    const resolved = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })

    expect(resolved.source).toBe("cli")
    expect(resolved.modelId).toBe("gpt-mock")
    expect(resolved.reasoningEffort).toBe("high")
    expect(resolved.fallbackReason).toBeUndefined()
  })

  it("exposes the resolved default to a caller that must not spawn", () => {
    expect(peekCodexDefaultModel().source).toBe("static-fallback")
  })

  it("degrades to the shared static default on an empty catalog and says why", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const resolved = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_EMPTY: "1" }),
      knownModels: knownMocks,
    })

    expect(resolved.source).toBe("static-fallback")
    expect(resolved.modelId).toBe(DEFAULT_CODEX_UI_MODEL)
    expect(resolved.reasoningEffort).toBe(DEFAULT_CODEX_REASONING_EFFORT)
    expect(resolved.fallbackReason).toBe(
      "catalog listed 0 models and none matched the 2 the app knows",
    )
  })

  it("degrades to the shared static default when the catalog read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const resolved = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_FAIL: "1" }),
      knownModels: knownMocks,
    })

    expect(resolved.source).toBe("static-fallback")
    expect(resolved.modelId).toBe(DEFAULT_CODEX_UI_MODEL)
    expect(resolved.fallbackReason?.length).toBeGreaterThan(0)
  })

  it("serves a successful read from cache until it is cleared", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    const first = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })
    expect(first.source).toBe("cli")
    expect(info.mock.calls).toHaveLength(1)

    const second = await resolveCodexDefaultModel({
      ...peer({ MOCK_MODEL_LIST_FAIL: "1" }),
      knownModels: knownMocks,
    })
    expect(second.source).toBe("cli")
    // A cache hit must not read the CLI again.
    expect(info.mock.calls).toHaveLength(1)

    clearCodexDefaultModelCache()
    const third = await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks })
    expect(third.source).toBe("cli")
    // Clearing the cache must read the CLI again.
    expect(info.mock.calls).toHaveLength(2)
  })

  it("re-reads when the binary version changes", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await resolveCodexDefaultModel({
      ...peer({ MOCK_CODEX_VERSION: "codex-mock 1.0.0" }),
      knownModels: knownMocks,
    })
    expect(info.mock.calls).toHaveLength(1)

    await resolveCodexDefaultModel({
      ...peer({ MOCK_CODEX_VERSION: "codex-mock 2.0.0" }),
      knownModels: knownMocks,
    })
    // A new binary version must invalidate the cache.
    expect(info.mock.calls).toHaveLength(2)
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
    expect(failed.source).toBe("static-fallback")
    expect(warn.mock.calls).toHaveLength(1)

    const cached = await resolveCodexDefaultModel(at({}))
    // The fallback is cached so a turn is not slow.
    expect(cached.source).toBe("static-fallback")
    expect(warn.mock.calls).toHaveLength(1)

    now += 61_000
    const retried = await resolveCodexDefaultModel(at({}))
    expect(retried.source).toBe("cli")
    expect(retried.modelId).toBe("gpt-mock")
  })
  it("serves one read to concurrent callers instead of racing two", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    const [first, second] = await Promise.all([
      resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks }),
      resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks }),
    ])

    // Both callers share one read, so neither can overwrite the other's
    // answer with an older one.
    expect(info.mock.calls).toHaveLength(1)
    expect(second).toEqual(first)
    expect(peekCodexDefaultModel()).toEqual(first)
  })

  it("keeps one credential's catalog away from another", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})

    await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks, cacheKey: "key-a" })
    await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks, cacheKey: "key-a" })
    await resolveCodexDefaultModel({ ...peer(), knownModels: knownMocks, cacheKey: "key-b" })

    // key-a is read once and served from cache, and key-b is not handed that
    // answer.
    expect(info.mock.calls).toHaveLength(2)
  })

  it("will not offer a ChatGPT-only model to an API-key chat", () => {
    const catalog = [
      entry({ id: "gpt-5.3-codex-spark", isDefault: true }),
      entry({ id: "gpt-mock" }),
    ]

    expect(selectCodexDefault(catalog, known(["gpt-5.3-codex-spark", "gpt-mock"]))).toEqual({
      modelId: "gpt-5.3-codex-spark",
      reasoningEffort: "medium",
    })

    // codexKnownModels drops the subscription-only ids for API-key auth, which
    // is the list the resolver is handed, so the marked default is not a
    // candidate.
    expect(selectCodexDefault(catalog, known(["gpt-mock"]))).toEqual({
      modelId: "gpt-mock",
      reasoningEffort: "medium",
    })
  })
})
