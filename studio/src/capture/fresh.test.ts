import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newestMtimeMs, staleReason } from "./fresh.ts";

let root: string;
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), "studio-fresh-"))));
afterEach(() => rmSync(root, { recursive: true, force: true }));

function file(rel: string, mtime: Date) {
	const p = join(root, rel);
	mkdirSync(join(p, ".."), { recursive: true });
	writeFileSync(p, "x");
	utimesSync(p, mtime, mtime);
	return p;
}
const at = (s: string) => new Date(s);

describe("newestMtimeMs", () => {
	test("is the newest file under the given dirs, recursively, ignoring node_modules/target/.svelte-kit", () => {
		file("src/a.ts", at("2026-01-01T00:00:00Z"));
		file("src/deep/b.svelte", at("2026-03-01T00:00:00Z"));
		file("src/node_modules/x.js", at("2027-01-01T00:00:00Z"));
		expect(newestMtimeMs([join(root, "src")])).toBe(at("2026-03-01T00:00:00Z").getTime());
	});

	test("a missing directory contributes nothing; no files at all is 0", () => {
		expect(newestMtimeMs([join(root, "nope")])).toBe(0);
	});
});

describe("staleReason", () => {
	test("a bundle older than the newest source is stale and the reason names the file and how much older", () => {
		const bundle = file("bundle/atlas-desktop", at("2026-01-01T00:00:00Z"));
		file("src/a.ts", at("2026-02-01T00:00:00Z"));
		const r = staleReason(bundle, [join(root, "src")]);
		expect(r).toMatch(/older than the app sources/);
	});

	test("a bundle newer than every source is fresh", () => {
		const bundle = file("bundle/atlas-desktop", at("2026-05-01T00:00:00Z"));
		file("src/a.ts", at("2026-02-01T00:00:00Z"));
		expect(staleReason(bundle, [join(root, "src")])).toBeUndefined();
	});

	test("a missing bundle is not 'stale': the caller reports it as missing", () => {
		expect(staleReason(join(root, "none"), [join(root, "src")])).toBeUndefined();
	});
});
