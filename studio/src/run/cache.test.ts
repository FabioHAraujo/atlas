import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedKeys, entryDir, readEntry, writeEntry } from "./cache.ts";

let root: string;
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "studio-cache-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A finished capture directory as the app leaves it. */
function fakeOutput(dir: string) {
	mkdirSync(join(dir, "shots"), { recursive: true });
	writeFileSync(join(dir, "video.mov"), "v");
	writeFileSync(join(dir, "timeline.json"), JSON.stringify({ version: 1 }));
	writeFileSync(join(dir, "shots", "panel.png"), "p");
}

describe("capture cache", () => {
	test("a written entry is found by recipe + key and lists its files", () => {
		const dir = entryDir(root, "tour", "abc123");
		fakeOutput(dir);
		writeEntry(root, "tour", "abc123", { capture: "clip", build: { app: "a", atlas: "1" }, recordedAt: "2026-10-12T00:00:00Z" });
		expect(cachedKeys(root, "tour")).toEqual(new Set(["abc123"]));
		const e = readEntry(root, "tour", "abc123")!;
		expect(e.video).toBe(join(dir, "video.mov"));
		expect(e.shots).toEqual([join(dir, "shots", "panel.png")]);
		expect(e.meta.capture).toBe("clip");
	});

	test("an entry without its marker (a crashed run) is NOT a cache hit, even if files exist", () => {
		fakeOutput(entryDir(root, "tour", "dead"));
		expect(cachedKeys(root, "tour").size).toBe(0);
		expect(readEntry(root, "tour", "dead")).toBeUndefined();
	});

	test("a marker whose video went missing is stale: not a hit (someone cleaned the cache)", () => {
		const dir = entryDir(root, "tour", "k1");
		fakeOutput(dir);
		writeEntry(root, "tour", "k1", { capture: "clip", build: { app: "a", atlas: "1" }, recordedAt: "t" });
		rmSync(join(dir, "video.mov"));
		expect(cachedKeys(root, "tour").size).toBe(0);
	});

	test("a corrupt marker is not a hit and does not throw", () => {
		const dir = entryDir(root, "tour", "k2");
		fakeOutput(dir);
		writeFileSync(join(dir, "done.json"), "{nope");
		expect(cachedKeys(root, "tour").size).toBe(0);
	});

	test("recipes are isolated from each other", () => {
		const d = entryDir(root, "a", "k");
		fakeOutput(d);
		writeEntry(root, "a", "k", { capture: "c", build: { app: "x", atlas: "1" }, recordedAt: "t" });
		expect(cachedKeys(root, "b").size).toBe(0);
	});

	test("recipe id and key are validated as path segments: no traversal out of the cache", () => {
		expect(() => entryDir(root, "../x", "k")).toThrow();
		expect(() => entryDir(root, "a", "../../etc")).toThrow();
		expect(() => entryDir(root, "a/b", "k")).toThrow();
	});

	test("a missing cache directory is an empty cache, not an error", () => {
		expect(cachedKeys(join(root, "nope"), "tour").size).toBe(0);
	});
});
