// `bun studio publish <film> [--release vX.Y.Z]`: copy rendered outputs into site/public/media under their stable
// names, record content hashes in site/public/media/manifest.json, write film-chapters.json for the site player,
// and optionally attach the videos to a GitHub release.

import { copyFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, sha256File } from "./lib/exec.ts";
import { loadFilm, parseArgs } from "./lib/films.ts";
import { enforce } from "./lint/gate.ts";
import { lintTargets } from "./lint/index.ts";
import { profileForAspect } from "./lint/profiles.ts";
import { OUT, SITE_MEDIA, StudioError } from "./lib/paths.ts";
import type { RenderReport } from "./render.ts";

interface MediaManifest {
	version: 1;
	files: Record<string, { sha256: string; bytes: number; film: string; buildHash: string }>;
}

/** Thumbnail tiles of the scrub sprite (see render.ts); the site player needs them to address the sprite. */
const THUMB = { step: 2, w: 160, h: 90, cols: 10 };

/**
 * `publish <film> --stills`: copy only the posters of the cuts from `out` into `media`, lint them first, and rewrite
 * just their manifest entries. A poster fix never drags the videos (or their hashes) along. All posters are checked
 * before the first copy, so a failure publishes nothing.
 */
export async function publishStills(o: { filmId: string; cuts: string[]; out: string; media: string }): Promise<string[]> {
	const names = o.cuts.map((c) => `${c}-poster.jpg`);
	for (const n of names) if (!existsSync(join(o.out, n))) throw new StudioError(`${n} is not rendered`, `bun studio still ${o.filmId}`);
	enforce(await lintTargets(names.map((n) => ({ file: join(o.out, n), profile: "still" })), { fast: true }), `stills of ${o.filmId}`);
	const manifestPath = join(o.media, "manifest.json");
	const manifest: MediaManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { version: 1, files: {} };
	for (const n of names) {
		copyFileSync(join(o.out, n), join(o.media, n));
		const prev = manifest.files[n];
		manifest.files[n] = { sha256: await sha256File(join(o.media, n)), bytes: statSync(join(o.media, n)).size, film: o.filmId, buildHash: prev?.buildHash ?? "still" };
	}
	const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(manifestPath, `${JSON.stringify({ version: 1, files: sorted }, null, "\t")}\n`);
	return names;
}

export async function main(argv: string[]): Promise<void> {
	const { pos, flags } = parseArgs(argv);
	const film = await loadFilm(pos[0] ?? "");
	if (flags.stills) {
		const done = await publishStills({ filmId: film.id, cuts: film.cuts.map((c) => c.out), out: join(OUT, film.id), media: SITE_MEDIA });
		console.log(`✓ published ${done.join(", ")} to site/public/media (manifest.json updated; videos untouched)`);
		return;
	}
	const out = join(OUT, film.id);
	const manifestPath = join(SITE_MEDIA, "manifest.json");
	const manifest: MediaManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { version: 1, files: {} };
	const uploads: string[] = [];

	for (const cut of film.cuts) {
		const reportPath = join(out, `${cut.out}.report.json`);
		if (!existsSync(reportPath)) throw new StudioError(`${cut.out} is not rendered`, `bun studio render ${film.id} --aspect ${cut.aspect}`);
		const report: RenderReport = JSON.parse(readFileSync(reportPath, "utf8"));
		if (report.draft) throw new StudioError(`${cut.out} is a draft render`, `bun studio render ${film.id} --aspect ${cut.aspect}   (without --draft)`);
		// refuse to publish a render with lint errors (cropped window, flashing, wrong loudness, off-spec file)
		const targets = Object.keys(report.files)
			.filter((n) => /\.(mp4|jpg)$/.test(n) && !n.includes("-thumbs"))
			.map((n) => ({ file: join(out, n), profile: n.endsWith(".jpg") ? "still" : profileForAspect(cut.aspect) }));
		enforce(await lintTargets(targets, { fast: true }), `${cut.out} (render ${report.buildHash})`);
		for (const [name, info] of Object.entries(report.files)) {
			copyFileSync(join(out, name), join(SITE_MEDIA, name));
			manifest.files[name] = { ...info, film: film.id, buildHash: report.buildHash };
			if (name.endsWith(".mp4") || name.endsWith(".webm")) uploads.push(join(out, name));
		}
		if (cut.chapters) {
			const chapters = { film: film.id, duration: +report.duration.toFixed(2), thumb: THUMB, chapters: cut.chapters };
			writeFileSync(join(SITE_MEDIA, `${cut.out}-chapters.json`), `${JSON.stringify(chapters, null, "\t")}\n`);
			console.log(`  chapters -> site/public/media/${cut.out}-chapters.json (${cut.chapters.length} chapters, ${chapters.duration} s)`);
		}
	}
	const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
	writeFileSync(manifestPath, `${JSON.stringify({ version: 1, files: sorted }, null, "\t")}\n`);
	console.log(`✓ published ${film.id} to site/public/media (hashes in manifest.json)`);

	const tag = flags.release;
	if (typeof tag === "string") {
		await run(["gh", "release", "upload", tag, ...uploads, "--clobber"], { live: true });
		console.log(`✓ attached ${uploads.length} files to ${tag}`);
	}
}
