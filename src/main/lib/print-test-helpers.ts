/**
 * Assertions shared by the provider print-mode session tests.
 *
 * These tests read a chunk out of the emitted stream with `Array.prototype.find` and then assert on
 * its fields. On its own that is a type hole (the lookup can be `undefined`) and a bad failure mode
 * (a missing chunk throws "cannot read properties of undefined" instead of saying what was missing).
 * `requireChunk` closes both: the compiler sees the chunk type, and a missing chunk fails with the
 * chunk type it expected.
 */

import { assert } from "vitest"

/**
 * Returns a looked-up value or fails the test naming what was expected. `Array.prototype.find`
 * hands back `T | undefined`, and asserting on a field of that straight away is both a type hole
 * and a confusing failure; this closes both.
 */
export function requireValue<T>(found: T | undefined, expected: string): T {
  assert.ok(found, `expected ${expected}`)
  if (found === undefined) {
    // Unreachable once the assertion above holds; it is what tells the type system the same thing.
    throw new Error(`expected ${expected}`)
  }
  return found
}

/** `requireValue` for a chunk pulled out of an emitted stream. */
export function requireChunk<T>(found: T | undefined, expectedType: string): T {
  return requireValue(found, `a "${expectedType}" chunk in the emitted stream`)
}
