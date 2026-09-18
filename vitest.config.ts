import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/main/lib/runtime/*.test.ts", "node_modules"],
    restoreMocks: true,
  },
})
