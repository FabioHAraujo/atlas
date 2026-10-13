import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./lib/exec.ts";
import { StudioError } from "./lib/paths.ts";
import { publishStills } from "./publish.ts";

let root: string;
let out: string;
let media: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "studio-publish-"));
	out = join(root, "out");
	media = join(root, "media");
	mkdirSync(out);
	mkdirSync(media);
});
afterEach(() => {
	// only the mkdtemp dir created in beforeEach
	if (root.startsWith(tmpdir())) rmSync(root, { recursive: true, force: true });
});

const manifest = () => JSON.parse(readFileSync(join(media, "manifest.json"), "utf8")) as { files: Record<string, { sha256: string; bytes: number; film: string; buildHash: string }> };

describe("publishing only the stills of a film (a poster fix must not drag the film along)", () => {
	test("copies the posters, rewrites only their manifest entries and leaves the videos' entries and files alone", async () => {
		const clean = readFileSync(join(import.meta.dir, "lint/__fixtures__/window-only-shot.jpg"));
		writeFileSync(join(out, "film-poster.jpg"), clean);
		writeFileSync(join(media, "film-poster.jpg"), "old poster bytes");
		writeFileSync(join(media, "film.mp4"), "the film");
		writeFileSync(join(media, "manifest.json"), JSON.stringify({ version: 1, files: { "film.mp4": { sha256: "keep", bytes: 8, film: "atlas-1-0", buildHash: "abc" }, "film-poster.jpg": { sha256: "old", bytes: 16, film: "atlas-1-0", buildHash: "abc" } } }));
		const done = await publishStills({ filmId: "atlas-1-0", cuts: ["film"], out, media });
		expect(done).toEqual(["film-poster.jpg"]);
		expect(readFileSync(join(media, "film-poster.jpg")).equals(clean)).toBe(true);
		expect(readFileSync(join(media, "film.mp4"), "utf8")).toBe("the film");
		const m = manifest();
		expect(m.files["film-poster.jpg"]).toMatchObject({ sha256: sha256(clean), bytes: clean.length, film: "atlas-1-0", buildHash: "abc" });
		expect(m.files["film.mp4"]!.sha256).toBe("keep");
	});

	test("a cut whose poster was never rendered is a hinted error, nothing is half-published", async () => {
		writeFileSync(join(out, "film-poster.jpg"), readFileSync(join(import.meta.dir, "lint/__fixtures__/window-only-shot.jpg")));
		let err: unknown;
		try {
			await publishStills({ filmId: "f", cuts: ["film", "film-vertical"], out, media });
		} catch (e) {
			err = e;
		}
		expect(err).toBeInstanceOf(StudioError);
		expect((err as StudioError).hint).toContain("bun studio still");
		expect(() => readFileSync(join(media, "film-poster.jpg"))).toThrow();
	});

	test("a poster that fails lint is refused and the published one is untouched", async () => {
		writeFileSync(join(out, "film-poster.jpg"), readFileSync(join(import.meta.dir, "lint/__fixtures__/poster-cropped-top.jpg")));
		writeFileSync(join(media, "film-poster.jpg"), "published");
		let err: unknown;
		try {
			await publishStills({ filmId: "f", cuts: ["film"], out, media });
		} catch (e) {
			err = e;
		}
		expect((err as StudioError).hint).toContain("frame/window-cropped");
		expect(readFileSync(join(media, "film-poster.jpg"), "utf8")).toBe("published");
	});
});
