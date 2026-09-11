/**
 * Stock-JCode baseline: launch/ping/session latency + idle RSS.
 *
 * Usage (from repo root):
 *   cd packages/runtime-client && npm install && cd ../..
 *   node benchmarks/runtime-harness/stock-baseline.mjs
 *
 * Prints JSON lines. Record runs in `.dump/app/benchmarks/<date>-<subject>.md`
 * with hardware/OS/versions/caveats. Never commit results here.
 */
import { execSync } from "node:child_process"
import { createRequire } from "node:module"
import os from "node:os"

const require = createRequire(import.meta.url)
const pkgDir = new URL("../../packages/runtime-client/", import.meta.url)
const { launchInstance, JcodeClient } = await import(new URL("dist/index.js", pkgDir).href)

const out = (obj) => console.log(JSON.stringify(obj))
out({ meta: { os: `${os.platform()} ${os.arch()} ${os.release()}`, node: process.version } })

// Isolate from user state; never inherit credentials for a benchmark.
process.env.DO_NOT_TRACK = "1"

const launches = []
let inst
for (let i = 0; i < 3; i++) {
  const t0 = Date.now()
  inst = await launchInstance({ shareCredentials: false })
  launches.push(Date.now() - t0)
  if (i < 2) await inst.shutdown()
}
out({ launch_ms: launches })

const client = await JcodeClient.connect({
  socketPath: inst.socketPath,
  clientName: "mauscode-bench/0",
})
await client.ping()
out({ ping: "ok" })

const t1 = Date.now()
const created = await client.createSession({ workingDir: process.cwd() })
out({ create_session_ms: Date.now() - t1, session_id: created.session_id })
out({ sessions: await client.listSessions() })

await new Promise((r) => setTimeout(r, 1500))
try {
  // Deliberately obscure pattern: pgrep -f must not match this script's own line.
  const pids = execSync('pgrep -f "jcode-linux-x86_64[.]bin|jcode-darwin[^ ]*[.]bin|jcode[.]exe"')
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
  const rss = []
  for (const pid of pids) {
    try {
      rss.push(execSync(`ps -o rss=,args= -p ${pid}`).toString().trim())
    } catch {
      /* raced with shutdown */
    }
  }
  out({ runtime_procs_rss_kb_cmd: rss })
} catch (e) {
  out({ rss: `unavailable: ${e.message}` })
}

client.close()
await inst.shutdown()
out({ done: true })
