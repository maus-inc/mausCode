import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import react from "@vitejs/plugin-react"
import autoprefixer from "autoprefixer"
import tailwindcss from "tailwindcss"

const root = dirname(fileURLToPath(import.meta.url))

export default {
  root: resolve(root, "src/renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(root, "src/renderer"),
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcss, autoprefixer],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
}
