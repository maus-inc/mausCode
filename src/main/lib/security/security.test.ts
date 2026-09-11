import assert from "node:assert/strict"
import { sep } from "node:path"
import { test } from "node:test"

import { isPathWithinRoot, isPathWithinRoots } from "./path-containment"
import { isSafeIpcToken, isSameApiOrigin } from "./ipc-guards"

/**
 * The prefix-matching check this replaced. Kept here as a regression fixture:
 * every case where `legacy` returns true and the shipped check returns false
 * is a bypass that used to be reachable from the renderer.
 */
const legacyPrefixMatch = (root: string, candidate: string): boolean =>
  candidate.startsWith(root + sep) || candidate.startsWith(root)

const ROOT = `${sep}home${sep}u${sep}.vscode${sep}extensions`

test("isPathWithinRoot accepts a file directly inside the root", () => {
  const file = `${ROOT}${sep}theme${sep}theme.json`
  assert.equal(isPathWithinRoot(ROOT, file), true)
  assert.equal(legacyPrefixMatch(ROOT, file), true)
})

test("isPathWithinRoot accepts the root itself", () => {
  assert.equal(isPathWithinRoot(ROOT, ROOT), true)
})

test("isPathWithinRoot rejects a sibling directory sharing a string prefix", () => {
  // Regression: the old `startsWith(root)` fallback accepted this.
  const evil = `${ROOT}EVIL${sep}theme.json`
  assert.equal(isPathWithinRoot(ROOT, evil), false)
  assert.equal(legacyPrefixMatch(ROOT, evil), true, "documents the old bypass")
})

test("isPathWithinRoot rejects ancestors and unrelated paths", () => {
  assert.equal(isPathWithinRoot(ROOT, `${sep}home${sep}u${sep}.vscode`), false)
  assert.equal(isPathWithinRoot(ROOT, `${sep}etc${sep}passwd`), false)
})

test("isPathWithinRoot does not mistake a '..config' sibling for an escape", () => {
  // relative() based check must not treat names beginning with '..' as escapes.
  const dotted = `${ROOT}${sep}..cache${sep}x.json`
  assert.equal(isPathWithinRoot(ROOT, dotted), true)
})

test("isPathWithinRoots checks every allowed root", () => {
  const roots = [ROOT, `${sep}home${sep}u${sep}.cursor${sep}extensions`]
  assert.equal(isPathWithinRoots(roots, `${roots[1]}${sep}t${sep}t.json`), true)
  assert.equal(isPathWithinRoots(roots, `${sep}tmp${sep}t.json`), false)
  assert.equal(isPathWithinRoots([], `${ROOT}${sep}t.json`), false)
})

const API_BASE = "https://21st.dev"

test("isSameApiOrigin accepts the configured backend and its paths", () => {
  assert.equal(isSameApiOrigin(`${API_BASE}/api/trpc/agents`, API_BASE), true)
  assert.equal(isSameApiOrigin(`${API_BASE}/api/agents/sandbox/x/diff?a=b`, API_BASE), true)
})

test("isSameApiOrigin rejects other origins, subdomains and schemes", () => {
  assert.equal(isSameApiOrigin("https://evil.example/api", API_BASE), false)
  // Subdomain is a different origin, not a suffix match.
  assert.equal(isSameApiOrigin("https://21st.dev.evil.example/api", API_BASE), false)
  assert.equal(isSameApiOrigin("https://cdn.21st.dev/releases", API_BASE), false)
  assert.equal(isSameApiOrigin("file:///etc/passwd", API_BASE), false)
  assert.equal(isSameApiOrigin("javascript:alert(1)", API_BASE), false)
})

test("isSameApiOrigin rejects non-URL and non-string input", () => {
  assert.equal(isSameApiOrigin("not a url", API_BASE), false)
  assert.equal(isSameApiOrigin(undefined, API_BASE), false)
  assert.equal(isSameApiOrigin({ url: API_BASE }, API_BASE), false)
  assert.equal(isSameApiOrigin(API_BASE, "not a url"), false)
})

test("isSafeIpcToken accepts generated stream ids and rejects channel smuggling", () => {
  // Shape produced by remote-chat-transport.ts generateStreamId().
  assert.equal(isSafeIpcToken("stream_1739280000000_ab12cd3"), true)
  assert.equal(isSafeIpcToken("a-b_C9"), true)
  assert.equal(isSafeIpcToken(""), false)
  assert.equal(isSafeIpcToken("x".repeat(65)), false)
  assert.equal(isSafeIpcToken("a:done"), false)
  assert.equal(isSafeIpcToken("../etc"), false)
  assert.equal(isSafeIpcToken(undefined), false)
})
