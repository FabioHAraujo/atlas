// @ts-nocheck bun test runtime types are not part of the site tsconfig
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mediaVersion } from "./media";

const real = JSON.parse(readFileSync(join(import.meta.dir, "../../public/media/manifest.json"), "utf8"));
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A site root shaped like a fresh checkout: manifest.json tracked, heavy media absent. */
function checkout(withFiles: Record<string, string> = {}) {
	const root = mkdtempSync(join(tmpdir(), "atlas-site-"));
	dirs.push(root);
	mkdirSync(join(root, "public/media"), { recursive: true });
	writeFileSync(join(root, "public/media/manifest.json"), JSON.stringify(real));
	for (const [f, body] of Object.entries(withFiles)) writeFileSync(join(root, "public/media", f), body);
	return root;
}

// Regression (2026-10-12): a site built where the videos were not on disk shipped `/media/film.mp4`
// with no `?v=`; media is cached for 30 days, so visitors kept the OLD film after a recut.
test("videos get a content version even when the file is not on disk (fresh checkout / CI)", () => {
	const v = mediaVersion("film.mp4", checkout());
	expect(v).toBe(real.files["film.mp4"].sha256.slice(0, 10));
});

test("the version is the same with or without the file present, so every build agrees", () => {
	const absent = mediaVersion("film.webm", checkout());
	const present = mediaVersion("film.webm", checkout({ "film.webm": "whatever bytes" }));
	expect(absent).toBe(present);
});

test("every media file the manifest lists gets a version; a file it does not list gets none", () => {
	const root = checkout();
	for (const f of Object.keys(real.files)) expect(mediaVersion(f, root)).toMatch(/^[0-9a-f]{10}$/);
	expect(mediaVersion("not-in-manifest.mp4", root)).toBeNull();
});


// Same class of bug: loops (Clip.astro) were never versioned and not in the manifest, so a re-recorded
// loop stayed stale for 30 days. Every heavy file kept out of git (scripts/fetch-media.sh) must be listed.
test("every media file kept out of git is in the manifest", () => {
	const script = readFileSync(join(import.meta.dir, "../../../scripts/fetch-media.sh"), "utf8");
	const list = script.match(/files=\(([\s\S]*?)\)/)?.[1].split(/\s+/).filter(Boolean) ?? [];
	expect(list.length).toBeGreaterThan(5);
	for (const f of list) expect([f, f in real.files]).toEqual([f, true]);
});

// Regression (2026-10-13): index.astro used `src="/media/shot-workspace.jpg"` directly, so the re-captured screenshot
// never reached visitors (same URL, 30-day cache) and the site kept showing the old app. Every /media reference in the
// site's markup and data must go through mediaUrl (which appends ?v=<sha>), never a bare string path.
test("no page, component or layout references /media/<file> without the version", () => {
	const { readdirSync, statSync } = require("node:fs");
	const roots = ["pages", "components", "layouts", "lib"].map((d) => join(import.meta.dir, "..", d));
	const files: string[] = [];
	const walk = (d: string) => {
		for (const n of readdirSync(d)) {
			const p = join(d, n);
			if (statSync(p).isDirectory()) walk(p);
			else if (/\.(astro|svelte|ts|tsx|md|mdx)$/.test(n) && !n.endsWith(".test.ts")) files.push(p);
		}
	};
	for (const r of roots) {
		try {
			walk(r);
		} catch {}
	}
	const bare = files.flatMap((f) =>
		[...readFileSync(f, "utf8").matchAll(/["'`]\/media\/[^"'`?$]+["'`]/g)].map((m) => `${f.split("/src/")[1]}: ${m[0]}`),
	);
	expect(bare).toEqual([]);
});