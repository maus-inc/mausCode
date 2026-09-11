/**
 * Live native-turn regression test against a localhost Responses-API stub.
 * Proves, with no real credentials: custom endpoint honoring (daemon routes
 * the turn to OPENAI_BASE_URL), SSE streaming through the harness, and
 * translator chunk output. Needs the pinned platform binary:
 *   node --test --experimental-strip-types src/main/lib/runtime/stub-turn.test.ts
 */
import { test } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"
import { RuntimeManager } from "./manager.ts"
import { NativeTranslator } from "./translate.ts"

function startStub(): Promise<{ server: http.Server; base: string; hits: string[] }> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    req.resume()
    req.on("end", () => {
      hits.push(`${req.method} ${req.url}`)
      if (req.method === "GET" && req.url === "/models") {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ data: [{ id: "gpt-4o" }] }))
        return
      }
      res.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" })
      res.write(`data: {"type":"response.output_text.delta","delta":"Hello from stub"}\n\n`)
      res.write(`data: [DONE]\n\n`)
      res.end()
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address()
      const port = typeof addr === "object" && addr ? addr.port : 0
      resolve({ server, base: `http://127.0.0.1:${port}`, hits })
    })
  })
}

test("stubbed turn streams text_delta through the translator", async () => {
  const { server, base, hits } = await startStub()
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "maus-stub-turn-"))
  const manager = new RuntimeManager({
    jcodeHome: home,
    env: { OPENAI_BASE_URL: base },
  })
  try {
    const client = await manager.getClient()
    const session = await client.createSession(os.tmpdir())
    await client.setApiKey("openai-api", "stub-key")
    // The account model list loads async after setApiKey; retry into it.
    let modelOk = false
    for (let i = 0; i < 10 && !modelOk; i++) {
      try {
        await client.setModel(session.session_id, "gpt-4o")
        modelOk = true
      } catch {
        await new Promise((r) => setTimeout(r, 1000))
      }
    }
    assert.equal(modelOk, true, "setModel gpt-4o should succeed once the account list loads")

    const translator = new NativeTranslator()
    translator.beginTurn()
    const stream = client.events(session.session_id)
    await client.sendMessage(session.session_id, "Say hello.")
    let sawText = ""
    let sawDone = false
    const chunks: string[] = []
    for await (const event of stream) {
      for (const chunk of translator.translate(event)) {
        chunks.push((chunk as { type: string }).type)
      }
      const ev = event as { ev: string; text?: string }
      if (ev.ev === "text_delta") sawText += ev.text ?? ""
      if (ev.ev === "turn_done" || ev.ev === "error") {
        sawDone = ev.ev === "turn_done"
        break
      }
    }
    assert.equal(sawDone, true, "turn should complete")
    assert.ok(
      sawText.includes("Hello from stub"),
      `stub text should stream (got ${JSON.stringify(sawText)})`,
    )
    assert.ok(
      hits.some((h) => h === "POST /responses"),
      `daemon should POST to the stub (hits: ${hits})`,
    )
    assert.ok(chunks.includes("text-delta"), `translator should emit text-delta (got ${chunks})`)
    assert.ok(chunks.includes("finish"), `translator should emit finish (got ${chunks})`)
  } finally {
    await manager.shutdown()
    server.close()
    fs.rmSync(home, { recursive: true, force: true })
  }
})
