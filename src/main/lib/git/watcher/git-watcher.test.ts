import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gitWatcherRegistry, type GitWatchEvent } from "./git-watcher";

/**
 * The watcher only watches `.git/index` and `.git/HEAD`, so both must exist
 * before it can report anything.
 */
async function withTempWorktree(run: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "git-watcher-test-"));
	await mkdir(join(dir, ".git"), { recursive: true });
	await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
	await writeFile(join(dir, ".git", "index"), "");
	try {
		await run(dir);
	} finally {
		await gitWatcherRegistry.dispose(dir);
		await rm(dir, { recursive: true, force: true });
	}
}

describe("gitWatcherRegistry", () => {
	it("gives concurrent subscribers one watcher instead of one each", async () => {
		await withTempWorktree(async (dir) => {
			// Both calls miss the cache before either creation resolves.
			const [first, second] = await Promise.all([
				gitWatcherRegistry.getOrCreate(dir),
				gitWatcherRegistry.getOrCreate(dir),
			]);

			assert.equal(first, second);
			assert.equal(gitWatcherRegistry.has(dir), true);
		});
	});

	it("reports an index change to every subscriber", async () => {
		await withTempWorktree(async (dir) => {
			const seenA: GitWatchEvent[] = [];
			const seenB: GitWatchEvent[] = [];

			await Promise.all([
				gitWatcherRegistry.subscribe(dir, (e) => seenA.push(e)),
				gitWatcherRegistry.subscribe(dir, (e) => seenB.push(e)),
			]);

			// What a real git operation does: rewrite the index.
			await writeFile(join(dir, ".git", "index"), "staged\n");

			await new Promise((resolve) => setTimeout(resolve, 1500));

			assert.ok(
				seenA.length > 0,
				"first subscriber saw no index change",
			);
			assert.deepEqual(
				seenB.map((e) => e.type),
				seenA.map((e) => e.type),
			);
		});
	});
});
