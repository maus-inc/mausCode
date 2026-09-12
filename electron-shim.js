// Shim to ensure electron is properly loaded in Electron context
const Module = require("node:module")
const originalRequire = Module.prototype.require

Module.prototype.require = function (id) {
  if (id === "electron") {
    // Check if we're in Electron by looking for process.versions.electron
    if (process.versions?.electron) {
      // Use the built-in electron module
      const { builtinModules } = require("node:module")
      if (builtinModules.includes("electron")) {
        return require.cache.electron || originalRequire.call(this, "electron")
      }
      // Access via process
      try {
        return process.electronBinding
          ? process.electronBinding("electron")
          : originalRequire.call(this, id)
      } catch {
        // Fallback
      }
    }
  }
  return originalRequire.call(this, id)
}
