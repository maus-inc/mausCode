/**
 * The only module in `src/main` that calls Electron safeStorage. Every other
 * reader and writer goes through the secret store service in `./index`.
 */
import { safeStorage } from "electron"
import type { Keychain } from "./types"

export const electronKeychain: Keychain = {
  isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
  encryptString: (value) => safeStorage.encryptString(value),
  decryptString: (payload) => safeStorage.decryptString(payload),
  selectedBackend: () => {
    if (process.platform !== "linux") return null
    try {
      return safeStorage.getSelectedStorageBackend()
    } catch {
      return null
    }
  },
}
