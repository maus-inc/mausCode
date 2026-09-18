import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Node environment: tests cover main-process logic, not the renderer.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // node:test suites (not vitest) — run via `npm run test:node`.
    exclude: ["src/main/lib/runtime/*.test.ts", "node_modules"],
    // Main-process modules pull in electron/native deps; keep tests pure.
    restoreMocks: true,
  },
})
