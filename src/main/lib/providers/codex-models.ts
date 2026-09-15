/**
 * Resolve the Codex default model and reasoning effort from the pinned Codex
 * CLI, with the shared static values as fallback.
 *
 * The CLI is the catalog. Its `model/list` request returns `isDefault` and
 * `defaultReasoningEffort` per model, so the app does not have to guess which
 * id the pinned binary means by "default". A hardcoded id goes stale on the
 * next CLI release, which is the bug this module exists to kill. Ratified
 * 2026-09-13 in `.dump/global/decisions.md`; the two literals the release note
 * carried, `gpt-5.5` and `gpt-5.4`, were both refused.
 *
 * The read costs one short-lived `codex app-server` child, so the answer is
 * cached against the binary version and a version bump invalidates it. A
 * failed read is cached too, for a shorter window, so a missing binary cannot
 * make every turn pay for a spawn that will fail again.
 *
 * Every id the CLI returns is checked against the static list the caller
 * passes before it is used, so a renamed upstream model cannot reach the
 * picker or a turn. Nothing here reaches the network: the child answers from
 * its own catalog, and the fallback is a constant.
 *
 * mausCode-authored (no upstream port).
 */

import { execFile } from "node:child_process"
import { Effect } from "effect"
import {
  DEFAULT_CODEX_REASONING_EFFORT,
  DEFAULT_CODEX_UI_MODEL,
  isCodexReasoningEffort,
} from "../../../shared/codex-model-id"
import { connectCodexAppServer, initializeHandshake } from "../codex-app-server/connection.ts"
import type {
  V2ModelListResponse,
  V2ModelListResponse__Model,
} from "../codex-app-server/src/_generated/schema.gen.ts"

/** One catalog entry, narrowed to the fields the default read needs. */
export type CodexCatalogModel = Pick<
  V2ModelListResponse__Model,
  "id" | "hidden" | "isDefault" | "defaultReasoningEffort"
>

/** A model the app already knows, and the efforts it accepts. */
export type KnownCodexModel = {
  id: string
  efforts: ReadonlyArray<string>
}

export type ResolvedCodexDefault = {
  modelId: string
  reasoningEffort: string
  /** "cli" when the pinned binary answered, "static-fallback" when it did not. */
  source: "cli" | "static-fallback"
  /** Why the CLI answer was not used. Present only on the fallback path. */
  fallbackReason?: string
}

/**
 * Pick the catalog default. Prefers the entry the CLI marks `isDefault`, then
 * the first visible entry, and only among ids the app already knows. Returns
 * null with the reason when the catalog holds nothing usable, which the
 * caller turns into the static fallback rather than a guess.
 */
export function selectCodexDefault(
  models: ReadonlyArray<CodexCatalogModel>,
  knownModels: ReadonlyArray<KnownCodexModel>,
): { modelId: string; reasoningEffort: string } | null {
  const known = new Map(knownModels.map((model) => [model.id, model.efforts]))
  const candidates = models.filter(
    (model) => model.id.trim().length > 0 && !model.hidden && known.has(model.id.trim()),
  )
  if (candidates.length === 0) return null

  const marked = candidates.find((model) => model.isDefault) ?? candidates[0]
  const modelId = marked.id.trim()
  const efforts = known.get(modelId) ?? []
  const effort = marked.defaultReasoningEffort.trim()
  return {
    modelId,
    reasoningEffort:
      isCodexReasoningEffort(effort) && efforts.includes(effort)
        ? effort
        : DEFAULT_CODEX_REASONING_EFFORT,
  }
}

/**
 * Read the whole catalog over `model/list`, following pagination cursors.
 * Throws when the binary cannot be spawned or the handshake does not answer.
 */
export async function readCodexModelCatalog(opts: {
  binaryPath: string
  argv: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs?: number
}): Promise<ReadonlyArray<CodexCatalogModel>> {
  const timeoutMs = opts.timeoutMs ?? 30_000
  const connection = await connectCodexAppServer({
    binaryPath: opts.binaryPath,
    argv: opts.argv,
    cwd: opts.cwd,
    env: opts.env,
  })

  try {
    await connection.run(initializeHandshake.pipe(Effect.timeout(`${timeoutMs} millis`)))

    const models: CodexCatalogModel[] = []
    let cursor: string | null = null
    // A cursor the server repeats would otherwise loop forever.
    const seenCursors = new Set<string>()
    for (let page = 0; page < 100; page += 1) {
      const listed: V2ModelListResponse = await connection.run(
        connection.client
          .request("model/list", {
            cursor,
            includeHidden: false,
            limit: null,
          })
          .pipe(Effect.timeout(`${timeoutMs} millis`)),
      )
      for (const model of listed.data) {
        models.push({
          id: model.id,
          hidden: model.hidden,
          isDefault: model.isDefault,
          defaultReasoningEffort: model.defaultReasoningEffort,
        })
      }
      const next = listed.nextCursor ?? null
      if (!next || seenCursors.has(next)) break
      seenCursors.add(next)
      cursor = next
    }
    return models
  } finally {
    await connection.dispose()
  }
}

const VERSION_TIMEOUT_MS = 15_000
const SUCCESS_CACHE_TTL_MS = 10 * 60_000
const FAILURE_CACHE_TTL_MS = 60_000

/** `codex --version`, so a binary swap invalidates the cached default. */
function codexVersion(
  binaryPath: string,
  versionArgs: ReadonlyArray<string>,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolvePromise) => {
    execFile(
      binaryPath,
      [...versionArgs],
      { timeout: VERSION_TIMEOUT_MS, env },
      (error, stdout) => {
        const output = String(stdout ?? "").trim()
        resolvePromise(error || output.length === 0 ? "unknown" : output)
      },
    )
  })
}

type CacheEntry = { at: number; version: string; value: ResolvedCodexDefault }

let cache: CacheEntry | null = null

function staticFallback(reason: string): ResolvedCodexDefault {
  return {
    modelId: DEFAULT_CODEX_UI_MODEL,
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
    source: "static-fallback",
    fallbackReason: reason,
  }
}

/** Drop the cached answer. Callers use it after a login or logout. */
export function clearCodexDefaultModelCache(): void {
  cache = null
}

/**
 * The cached default without reading the CLI. A turn uses this so no turn
 * waits on a catalog read; when nothing is cached it returns the shared
 * static default and says so.
 */
export function peekCodexDefaultModel(): ResolvedCodexDefault {
  return cache?.value ?? staticFallback("catalog not read yet")
}

/**
 * Resolve the default, reading the CLI when the cache is empty, stale, or
 * keyed to a different binary version. Never throws: a CLI that cannot answer
 * degrades to the shared static default and says so in `fallbackReason`,
 * which the caller surfaces rather than hides.
 */
export async function resolveCodexDefaultModel(opts: {
  binaryPath: string
  argv: string[]
  cwd: string
  env: Record<string, string>
  knownModels: ReadonlyArray<KnownCodexModel>
  /** Arguments that print the binary version. Injectable for tests. */
  versionArgs?: ReadonlyArray<string>
  /** Injectable for tests. */
  now?: () => number
}): Promise<ResolvedCodexDefault> {
  const now = opts.now ?? Date.now
  const timestamp = now()
  const version = await codexVersion(opts.binaryPath, opts.versionArgs ?? ["--version"], opts.env)

  if (cache && cache.version === version && timestamp - cache.at < ttlFor(cache.value)) {
    return cache.value
  }

  let value: ResolvedCodexDefault
  try {
    const catalog = await readCodexModelCatalog(opts)
    const selected = selectCodexDefault(catalog, opts.knownModels)
    if (selected) {
      value = { ...selected, source: "cli" }
      console.info(
        `[codex-models] resolved from CLI ${version}: model=${selected.modelId} effort=${selected.reasoningEffort} catalogEntries=${catalog.length}`,
      )
    } else {
      value = staticFallback(
        `catalog listed ${catalog.length} models and none matched the ${opts.knownModels.length} the app knows`,
      )
      console.warn(
        `[codex-models] catalog had no usable model, using ${value.modelId}/${value.reasoningEffort}: ${value.fallbackReason}`,
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    value = staticFallback(message)
    console.warn(
      `[codex-models] CLI catalog read failed, using ${value.modelId}/${value.reasoningEffort}: ${message}`,
    )
  }

  cache = { at: timestamp, version, value }
  return value
}

function ttlFor(value: ResolvedCodexDefault): number {
  return value.source === "cli" ? SUCCESS_CACHE_TTL_MS : FAILURE_CACHE_TTL_MS
}
