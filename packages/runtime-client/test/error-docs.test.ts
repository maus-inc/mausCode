/** Keep the public error reference in sync with client and server code. */

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const sdkRoot = path.resolve(here, "..")
// mausCode: see schema-parity.test.ts for why this path is configurable.
const rustCrate = process.env.JCODE_HARNESS_API_SRC
  ? path.resolve(process.env.JCODE_HARNESS_API_SRC)
  : path.resolve(here, "../../../runtime/jcode/crates/jcode-harness-api/src")
const rustEvents = path.join(rustCrate, "events.rs")

function snakeCase(variant: string): string {
  return variant.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()
}

function clientErrorCodes(): string[] {
  const source = ["client.ts", "launch.ts", "structured.ts"]
    .map((file) => fs.readFileSync(path.join(sdkRoot, "src", file), "utf8"))
    .join("\n")
  const codes = new Set<string>()
  for (const match of source.matchAll(/(?:new HarnessError|super)\(\s*"([a-z_]+)"/g)) {
    codes.add(match[1]!)
  }
  return [...codes]
}

function serverErrorCodes(): string[] {
  const source = fs.readFileSync(rustEvents, "utf8")
  const start = source.indexOf("pub enum ErrorCode {")
  assert.notEqual(start, -1, "Rust ErrorCode enum not found")
  const body = source.slice(start).split("\n}", 1)[0]!
  return [...body.matchAll(/^ {4}([A-Z][A-Za-z0-9]*),$/gm)].map((match) => snakeCase(match[1]!))
}

test("README documents every stable SDK and server error code", () => {
  const readme = fs.readFileSync(path.join(sdkRoot, "README.md"), "utf8")
  const missing = [...new Set([...clientErrorCodes(), ...serverErrorCodes()])]
    .sort()
    .filter((code) => !readme.includes(`\`${code}\``))
  assert.deepEqual(missing, [], `undocumented error codes: ${missing.join(", ")}`)
})
