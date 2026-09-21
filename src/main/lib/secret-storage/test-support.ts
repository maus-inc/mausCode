/**
 * Shared fixtures for the secret-storage tests.
 *
 * Every suite here needs the same two things: a keychain that behaves like the
 * OS one without being it, and a temporary app home that is always removed.
 * They live in one place so the suites stay about the behavior under test.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach } from "vitest"
import { SecretStore } from "./store"
import type { Keychain } from "./types"

export type FakeKeychainOptions = {
  available?: boolean
  backend?: string | null
  encryptThrows?: boolean
}

export type FakeKeychain = Keychain & { setAvailable(value: boolean): void }

/**
 * Stands in for the OS keyring. The ciphertext body is masked so a value cannot
 * appear in a stored file by accident, which is what makes the "the plaintext is
 * absent" assertions meaningful. The bytes before the body match the `v10`
 * prefix and nonce Electron writes.
 */
export function fakeKeychain(options: FakeKeychainOptions = {}): FakeKeychain {
  let available = options.available ?? true
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => {
      if (options.encryptThrows) throw new Error("keyring refused")
      return Buffer.concat([
        Buffer.from("v10", "latin1"),
        Buffer.from([0, 255, 1]),
        Buffer.from(value, "utf-8").map((byte) => byte ^ 0x5a),
      ])
    },
    decryptString: (payload) => {
      const head = payload.subarray(0, 6)
      if (!head.equals(Buffer.from([118, 49, 48, 0, 255, 1]))) {
        throw new Error("Ciphertext does not appear to be encrypted.")
      }
      return Buffer.from(payload.subarray(6).map((byte) => byte ^ 0x5a)).toString("utf-8")
    },
    selectedBackend: () => options.backend ?? null,
    setAvailable: (value: boolean) => {
      available = value
    },
  }
}

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** A temp home registered for removal after the test that created it. */
export function makeHome(prefix = "mauscode-secret-"): string {
  const home = mkdtempSync(join(tmpdir(), prefix))
  homes.push(home)
  return home
}

/** A store over `home`, with or without a keyring and with consent if asked. */
export function makeStore(
  home: string,
  options: { available?: boolean; consent?: boolean; backend?: string | null } = {},
): SecretStore {
  const store = new SecretStore(
    home,
    fakeKeychain({ available: options.available, backend: options.backend }),
  )
  if (options.consent) store.setPlaintextConsent(true)
  return store
}
