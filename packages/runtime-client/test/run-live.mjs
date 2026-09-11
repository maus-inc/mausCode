/** mausCode: run live-launch.mjs against the bundled platform binary (or PATH). */
import { spawnSync } from "node:child_process"
import { bundledJcodeBinary } from "../dist/index.js"

const bin = process.argv[2] ?? bundledJcodeBinary() ?? "jcode"
const result = spawnSync(process.execPath, ["test/live-launch.mjs", bin], {
  stdio: "inherit",
})
process.exit(result.status ?? 1)
