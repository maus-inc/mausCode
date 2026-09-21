/**
 * App-wide access to the secret store. This is the only module that binds the
 * store to the running Electron app; all policy lives in `./store`.
 */
import { app } from "electron"
import { electronKeychain } from "./electron-keychain"
import { SecretStore } from "./store"

let store: SecretStore | null = null

export function getSecretStore(): SecretStore {
  store ??= new SecretStore(app.getPath("userData"), electronKeychain)
  return store
}

export {
  keyedStorePath,
  readKeyedSecrets,
  removeKeyedSecret,
  writeKeyedSecret,
} from "./keyed-store"
export { metadataPath, readMetadata } from "./metadata"
export {
  decodeBytes,
  decodeStoredBase64,
  encodeSecret,
  inspectBytes,
  inspectStoredBase64,
  resolveProtection,
} from "./owner"
export { SecretStore } from "./store"
export type {
  PrepareResult,
  SecretProtection,
  SecretStorageReason,
  SecretStorageStatus,
  SecretWriter,
} from "./types"
export { SecretStorageError } from "./types"
