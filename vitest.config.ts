import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // Node environment by default: tests cover main-process logic. A renderer
    // test declares `// @vitest-environment jsdom` at the top of its own file.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // node:test suites (not vitest) — run via `npm run test:node`.
    exclude: ["src/main/lib/runtime/*.test.ts", "node_modules"],
    // Main-process modules pull in electron/native deps; keep tests pure.
    restoreMocks: true,
  },
})
