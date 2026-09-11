/**
 * hermes-agent ACP chat tests against the mock NDJSON stdio agent: full
 * prompt stream (text + tool + finish), cross-process resume failure (true
 * hermes behavior: ACP sessions are process-scoped), cancel termination,
 * plus the router's pure helpers (allowlist, error classifier) and the
 * launch/manifest wiring.
 */
import { createACPProvider } from "@mcpc-tech/acp-ai-provider"
import { assert, it } from "@effect/vitest"
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { vi } from "vitest"
import { providerCapabilitySchema } from "../../../shared/provider-capabilities"
import { resolveHermesAcpLaunch, resolveHermesCli } from "../hermes-binary"
import { extractHermesError, isHermesAuthError, isHermesReadonlyCommand } from "./policy"

// The provider registry pulls electron + better-sqlite3 (absent in this
// node-only env); stub both — the registry test never touches them.
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: () => tmpdir(),
  },
}))
vi.mock("better-sqlite3", () => ({ default: class {} }))

const { getBackend } = await import("../providers/index")
import { getHermesCapability } from "../providers/hermes"

const MOCK_PATH = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "test",
  "fixtures",
  "hermes-acp-mock.mjs",
)

async function collectStreamParts(model: any): Promise<any[]> {
  const { stream } = await model.doStream({
    prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  })
  const parts: any[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return parts
}

it("streams a full turn (text + tool + finish) through the ACP provider", async () => {
  const provider = createACPProvider({
    command: process.execPath,
    args: [MOCK_PATH],
    env: { ...process.env } as Record<string, string>,
    session: { cwd: process.cwd(), mcpServers: [] },
    persistSession: true,
  })
  try {
    const sessionInfo = await provider.initSession()
    assert.ok(provider.getSessionId())
    assert.equal(sessionInfo?.models?.currentModelId, "hermes-default")

    const parts = await collectStreamParts(provider.languageModel("hermes-alt"))
    const types = parts.map((part) => part.type)
    assert.ok(types.includes("text-start"))
    assert.ok(types.includes("text-delta"))
    assert.ok(types.includes("tool-input-start"))
    assert.ok(types.includes("finish"))
    const delta = parts.find((part) => part.type === "text-delta")
    assert.equal(delta.delta, "Hello from mock.")
  } finally {
    provider.cleanup()
  }
})

it("fails resume against a fresh process (ACP sessions are process-scoped)", async () => {
  const first = createACPProvider({
    command: process.execPath,
    args: [MOCK_PATH],
    env: {},
    session: { cwd: process.cwd(), mcpServers: [] },
    persistSession: true,
  })
  await first.initSession()
  const sessionId = first.getSessionId()
  assert.ok(sessionId)
  first.cleanup()

  const second = createACPProvider({
    command: process.execPath,
    args: [MOCK_PATH],
    env: {},
    session: { cwd: process.cwd(), mcpServers: [] },
    existingSessionId: sessionId!,
    persistSession: true,
  })
  let failure = ""
  try {
    await second.initSession()
  } catch (error) {
    failure = String(error)
  } finally {
    second.cleanup()
  }
  assert.ok(
    failure.includes("session not found"),
    "expected initSession to reject for an unknown session id",
  )
})

it("terminates a pending prompt when the consumer aborts", async () => {
  const provider = createACPProvider({
    command: process.execPath,
    args: [MOCK_PATH],
    env: {
      ...(process.env as Record<string, string>),
      HERMES_MOCK_MODE: "never",
    },
    session: { cwd: process.cwd(), mcpServers: [] },
    persistSession: true,
  })
  try {
    await provider.initSession()
    const controller = new AbortController()
    const { stream } = await provider.languageModel().doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      abortSignal: controller.signal,
    } as any)
    const reader = stream.getReader()
    const read = reader.read()
    controller.abort()
    await reader.cancel().catch(() => {})
    const settled = await Promise.race([
      read.then(() => "settled" as const),
      new Promise((resolve) => setTimeout(() => resolve("timeout" as const), 5000)),
    ])
    assert.equal(settled, "settled")
  } finally {
    provider.cleanup()
  }
})

it("maps prompt failures through the hermes error classifier", async () => {
  const provider = createACPProvider({
    command: process.execPath,
    args: [MOCK_PATH],
    env: {
      ...(process.env as Record<string, string>),
      HERMES_MOCK_MODE: "prompt-error",
    },
    session: { cwd: process.cwd(), mcpServers: [] },
    persistSession: true,
  })
  try {
    await provider.initSession()
    // The provider enqueues {type:"error"} but never closes the stream on
    // prompt failure, so read until the error part (never read-to-close).
    const { stream } = await provider.languageModel().doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    })
    const reader = stream.getReader()
    let errorPart: any = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value?.type === "error") {
        errorPart = value
        break
      }
    }
    await reader.cancel().catch(() => {})
    assert.ok(errorPart, "expected an error part")
    const normalized = extractHermesError(errorPart)
    assert.ok(normalized.message.length > 0)
    assert.equal(isHermesAuthError(normalized), false)
  } finally {
    provider.cleanup()
  }
})

it("classifies auth errors and passes through plain failures", () => {
  assert.equal(isHermesAuthError(extractHermesError(new Error("Invalid API key"))), true)
  assert.equal(isHermesAuthError(extractHermesError({ message: "boom" })), false)
  assert.equal(extractHermesError({ data: { message: "deep" } }).message, "deep")
})

it("allowlist admits read-only state and rejects everything else", () => {
  for (const command of ["status", "cron", "skills", "mcp", "auth", "doctor"]) {
    assert.equal(isHermesReadonlyCommand(command), true)
  }
  for (const command of ["chat", "send", "gateway", "exec", "update", ""]) {
    assert.equal(isHermesReadonlyCommand(command), false)
  }
  assert.equal(isHermesReadonlyCommand("  status  "), true)
})

it.runIf(process.platform !== "win32")(
  "resolves the hermes launch from PATH and throws when missing",
  () => {
    const binDir = mkdtempSync(join(tmpdir(), "hermes-bin-"))
    const fake = join(binDir, "hermes")
    writeFileSync(fake, "#!/bin/sh\nexit 0\n")
    chmodSync(fake, 0o755)

    const previousPath = process.env.PATH
    try {
      process.env.PATH = `${binDir}${previousPath ? `:${previousPath}` : ""}`
      assert.equal(resolveHermesCli(), fake)
      assert.deepEqual(resolveHermesAcpLaunch(), { command: fake, args: ["acp"] })

      const emptyDir = mkdtempSync(join(tmpdir(), "hermes-empty-"))
      process.env.PATH = emptyDir
      assert.throws(() => resolveHermesCli(), /hermes/)
    } finally {
      if (previousPath === undefined) {
        delete process.env.PATH
      } else {
        process.env.PATH = previousPath
      }
    }
  },
)

it("registers a schema-valid hermes capability", () => {
  const parsed = providerCapabilitySchema.parse(getHermesCapability())
  assert.equal(parsed.id, "hermes")
  assert.equal(getBackend("hermes")?.displayName, "Hermes")
})
