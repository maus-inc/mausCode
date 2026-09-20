/**
 * Native credential check, run against the bundled platform runtime.
 *
 * Confirms the two claims the app-side handling rests on:
 *  1. the runtime persists a key handed to `set_api_key` as a plaintext file in
 *     the private instance home, which is what the app now clears around the
 *     daemon lifecycle;
 *  2. a runtime without the memory-only handoff answers `set_ephemeral_api_key`
 *     with an explicit error and keeps the connection open, which is how a
 *     client detects support.
 *
 * Values are synthetic. Run with:
 *   node --experimental-strip-types .dump/app/audits/2026-09-20-native-credential-check.mjs
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { JcodeClient } from "@maus-inc/runtime-client"
import {
  clearPrivateCredentialFiles,
  privateCredentialDir,
} from "../../../src/main/lib/runtime/credential-files.ts"

const SYNTHETIC_KEY = "sk-ant-synthetic-0000000000000000"
const home = fs.mkdtempSync(path.join(os.tmpdir(), "mauscode-native-cred-check-"))
const results = []
const record = (name, value) => {
  results.push({ name, value })
  console.log(`${name}: ${JSON.stringify(value)}`)
}

const client = await JcodeClient.launch({ jcodeHome: home, inheritLogins: false })
try {
  record("capabilities", client.capabilities.slice().sort())
  record("supports_ephemeral_api_key", client.supports("ephemeral_api_key"))

  // Stateful requests need an attached session with a working directory.
  const session = await client.createSession(home)
  record(
    "session_created",
    typeof session?.session_id === "string" && session.session_id.length > 0,
  )

  await client.setApiKey("anthropic-api", SYNTHETIC_KEY)
  const credentialFile = path.join(privateCredentialDir(home), "anthropic.env")
  const onDisk = fs.existsSync(credentialFile)
  record("persisted_file_created", onDisk)
  record("persisted_file_path", credentialFile.replace(home, "$JCODE_HOME"))
  record(
    "persisted_file_mode",
    onDisk ? (fs.statSync(credentialFile).mode & 0o777).toString(8) : null,
  )
  record(
    "persisted_file_contains_key",
    onDisk ? fs.readFileSync(credentialFile, "utf-8").includes(SYNTHETIC_KEY) : null,
  )

  let ephemeralError = null
  try {
    await client.setEphemeralApiKey(session.session_id, "anthropic-api", SYNTHETIC_KEY)
  } catch (error) {
    ephemeralError = error instanceof Error ? error.message : String(error)
  }
  record("set_ephemeral_api_key_error", ephemeralError)
  record(
    "connection_alive_after_error",
    await client
      .ping()
      .then(() => true)
      .catch(() => false),
  )

  const removed = clearPrivateCredentialFiles(home)
  record("cleared_files", removed)
  record("persisted_file_after_clear", fs.existsSync(credentialFile))
  record("file_removed_by_clear", !fs.existsSync(credentialFile))
} finally {
  await client.close().catch(() => {})
  fs.rmSync(home, { recursive: true, force: true })
}

fs.writeFileSync(
  path.join(process.cwd(), ".dump/app/audits/2026-09-20-native-credential-check.json"),
  `${JSON.stringify(results, null, 2)}\n`,
)
