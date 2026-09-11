/**
 * Native runtime daemon manager: exactly one private JCode instance per app.
 *
 * Lifecycle: lazy-start on first native use, `ping` health checks, supervised
 * restart with backoff on crash, no idle-kill while the app runs, clean shutdown
 * on quit. All paths are injected (`ManagerPaths`) so the manager is testable
 * without Electron.
 *
 * The runtime client is ESM-only, so it is loaded via dynamic `import()` — the
 * same precedent as `@anthropic-ai/claude-agent-sdk` in the legacy path.
 */
import { EventEmitter } from "node:events"
import type { JcodeClient } from "@maus-inc/runtime-client"

export interface ManagerPaths {
  /** Stable state dir for the private instance (sessions survive restarts). */
  jcodeHome: string
  /** Packaged runtime binary, if present (undefined in dev). */
  packagedBinary?: string
  /** Extra env for the instance (provider endpoint overrides, etc.). */
  env?: Record<string, string>
}

export type RuntimeStatus = "stopped" | "starting" | "ready" | "restarting" | "failed"

const MAX_RESTARTS = 3
const RESTART_BASE_MS = 1000
const PING_TIMEOUT_MS = 10_000

type RuntimeClientModule = typeof import("@maus-inc/runtime-client")

async function loadRuntimeClient(): Promise<RuntimeClientModule> {
  return await import("@maus-inc/runtime-client")
}

export class RuntimeManager extends EventEmitter {
  private client: JcodeClient | null = null
  private starting: Promise<JcodeClient> | null = null
  private restarts = 0
  private intentionallyStopped = false

  private readonly paths: ManagerPaths

  constructor(paths: ManagerPaths) {
    super()
    this.paths = paths
  }

  status(): RuntimeStatus {
    if (this.client) return "ready"
    if (this.starting) return "starting"
    if (this.restarts >= MAX_RESTARTS) return "failed"
    return "stopped"
  }

  /** Get a connected client, starting the daemon on first use. */
  async getClient(): Promise<JcodeClient> {
    if (this.client) return this.client
    if (this.starting) return this.starting
    this.intentionallyStopped = false
    this.starting = this.start()
    try {
      const client = await this.starting
      if (this.intentionallyStopped) {
        // shutdown() won the race: release the orphan, don't adopt it.
        await client.close().catch(() => {})
        throw new Error("Runtime shut down during startup")
      }
      this.client = client
      this.restarts = 0
      this.emit("status", "ready")
      return this.client
    } finally {
      this.starting = null
    }
  }

  /** Health-check the daemon; supervised-restart on failure. */
  async ping(): Promise<void> {
    const client = await this.getClient()
    try {
      await client.ping()
    } catch (error) {
      await this.handleCrash(error)
      throw error
    }
  }

  /** Stop the daemon and release everything. Called on app quit. */
  async shutdown(): Promise<void> {
    this.intentionallyStopped = true
    this.starting = null
    const client = this.client
    this.client = null
    if (client) {
      try {
        await client.close()
      } catch {
        // Shutdown is best-effort; the OS reaps strays.
      }
    }
    this.emit("status", "stopped")
  }

  private async start(): Promise<JcodeClient> {
    this.emit("status", "starting")
    const mod = await loadRuntimeClient()
    const binary = this.paths.packagedBinary ?? mod.bundledJcodeBinary()
    if (!binary) {
      throw new Error(
        "Native runtime binary not found: no packaged binary and no " +
          "bundled platform runtime. Reinstall the app or place `jcode` on PATH.",
      )
    }
    const client = await mod.JcodeClient.launch({
      jcodeHome: this.paths.jcodeHome,
      binary,
      inheritLogins: false, // mausCode applies credentials explicitly (see credentials.ts)
      env: this.paths.env,
      clientName: "mauscode/1",
      requestTimeoutMs: PING_TIMEOUT_MS,
    })
    // The launch() client connects to its own instance; verify round-trip.
    await client.ping()
    client.on("error", (error: unknown) => {
      if (!this.intentionallyStopped) {
        void this.handleCrash(error)
      }
    })
    return client
  }

  private async handleCrash(error: unknown): Promise<void> {
    const dead = this.client
    this.client = null
    if (dead) {
      try {
        await dead.close()
      } catch {
        // Already dead; continue to restart.
      }
    }
    if (this.intentionallyStopped) return
    this.restarts += 1
    if (this.restarts > MAX_RESTARTS) {
      this.emit("status", "failed")
      this.emit("failed", error)
      return
    }
    this.emit("status", "restarting")
    const delay = RESTART_BASE_MS * 2 ** (this.restarts - 1)
    await new Promise((resolve) => setTimeout(resolve, delay))
    if (this.intentionallyStopped) return
    try {
      this.client = await this.start()
      this.restarts = 0
      this.emit("status", "ready")
    } catch (restartError) {
      await this.handleCrash(restartError)
    }
  }
}
