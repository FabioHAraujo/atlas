// `bun studio loops [--only loop-panel,shot-agents] [--tui]`: the site's loops and screenshots, built from the
// recordings of recipes/site-media.ts (`bun studio run recipes/site-media.ts`) with nothing done by hand:
//   loop-<name>.mp4 / .webm / -poster.jpg   cut from the capture (src/site-media.ts), 1280x800, silent, under 600 KB
//   shot-<name>.jpg                          the recipe's window PNG, 2000 px wide
//   loop-tui.mp4 / .webm / -poster.jpg       cut from the vhs take (`bun studio capture tui`), same encode
// Everything is linted (profiles site-loop / site-sibling / site-shot) BEFORE it replaces a published file, and
// manifest.json gets the new hashes. Nothing is published when any file has a lint error.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetPath } from "./lib/assets.ts";
import { ffmpeg, sha256File } from "./lib/exec.ts";
import { parseArgs } from "./lib/films.ts";
import { SITE_MEDIA, StudioError } from "./lib/paths.ts";
import { enforce } from "./lint/gate.ts";
import { lintTargets } from "./lint/index.ts";
import recipe from "../recipes/site-media.ts";
import { parseRecipeV1 } from "./run/recipe.ts";
import { capturedEntry } from "./run/run.ts";
import { LOOP_MAX_BYTES, LOOPS, SHOTS, type LoopSpec } from "./site-media.ts";

/** The vhs take of `atlas dev`, cut to its densest 10.2 s (boot, error jumps, links, find, filters): the 1.0 loop's window. */
export const TUI_LOOP: LoopSpec = { name: "tui", capture: "take:tui", from: 10.6, seconds: 10.2 };

const FILTER = "scale=1280:800:flags=lanczos,fps=30,format=yuv420p";
const cut = (input: string, spec: LoopSpec) => ["-ss", String(spec.from), "-t", String(spec.seconds), "-i", input];

/** H.264: seekable from the first byte, a keyframe every 2 s (60 frames at 30 fps), silent. */
export const loopMp4Args = (input: string, spec: LoopSpec, crf: number, out: string): string[] => [
	...cut(input, spec), "-vf", FILTER, "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-g", "60", "-keyint_min", "60", "-sc_threshold", "0", "-movflags", "+faststart", out,
];

/** VP9 sibling of the same cut, silent. */
export const loopWebmArgs = (input: string, spec: LoopSpec, crf: number, out: string): string[] => [
	...cut(input, spec), "-vf", FILTER, "-an", "-c:v", "libvpx-vp9", "-crf", String(crf), "-b:v", "0", "-g", "60", "-row-mt", "1", out,
];

/** The loop's first frame: what the page shows until the video is in view. */
export const posterArgs = (input: string, spec: LoopSpec, out: string): string[] => ["-ss", String(spec.from), "-i", input, "-vf", FILTER, "-frames:v", "1", "-q:v", "3", out];

/** A 2x window PNG as the 2000 px wide JPEG the site's stills use. */
export const shotArgs = (input: string, out: string): string[] => ["-i", input, "-vf", "scale=2000:-2:flags=lanczos", "-frames:v", "1", "-q:v", "3", out];

/** Raise CRF until the file fits the budget; the loop is a picture of an app, so a few CRF points are invisible. */
async function encodeUnder(make: (crf: number, out: string) => string[], start: number, out: string): Promise<number> {
	for (let crf = start; crf <= start + 12; crf += 2) {
		await ffmpeg(make(crf, out));
		if (statSync(out).size <= LOOP_MAX_BYTES) return crf;
	}
	throw new StudioError(`${out} is still over ${LOOP_MAX_BYTES} bytes at the highest CRF tried`, "shorten the loop in src/site-media.ts or simplify the scene");
}

interface Built {
	name: string;
	file: string;
	profile: string;
}

export async function main(argv: string[]): Promise<void> {
	const { flags } = parseArgs(argv);
	const only = typeof flags.only === "string" ? new Set(flags.only.split(",")) : undefined;
	const wants = (name: string) => !only || only.has(name);
	const parsed = parseRecipeV1(recipe);
	const work = mkdtempSync(join(tmpdir(), "atlas-studio-loops-"));
	const built: Built[] = [];
	try {
		const make = async (spec: LoopSpec, input: string) => {
			const stem = `loop-${spec.name}`;
			const mp4 = join(work, `${stem}.mp4`);
			const webm = join(work, `${stem}.webm`);
			const poster = join(work, `${stem}-poster.jpg`);
			const crf = await encodeUnder((c, o) => loopMp4Args(input, spec, c, o), 24, mp4);
			await encodeUnder((c, o) => loopWebmArgs(input, spec, c, o), crf + 10, webm);
			await ffmpeg(posterArgs(input, spec, poster));
			built.push({ name: `${stem}.mp4`, file: mp4, profile: "site-loop" }, { name: `${stem}.webm`, file: webm, profile: "site-sibling" }, { name: `${stem}-poster.jpg`, file: poster, profile: "site-shot" });
			console.log(`✓ ${stem}  crf ${crf}  ${(statSync(mp4).size / 1000).toFixed(0)} KB mp4`);
		};
		for (const spec of LOOPS) {
			if (!wants(`loop-${spec.name}`)) continue;
			await make(spec, (await capturedEntry(parsed, spec.capture)).video);
		}
		for (const s of SHOTS) {
			if (!wants(`shot-${s.name}`)) continue;
			const png = (await capturedEntry(parsed, s.capture)).shots.find((p) => p.endsWith(`/${s.shot}.png`));
			if (!png) throw new StudioError(`capture ${s.capture} has no shot "${s.shot}"`, "bun studio run recipes/site-media.ts --force");
			const out = join(work, `shot-${s.name}.jpg`);
			await ffmpeg(shotArgs(png, out));
			built.push({ name: `shot-${s.name}.jpg`, file: out, profile: "site-shot" });
			console.log(`✓ shot-${s.name}`);
		}
		if (wants("loop-tui")) await make(TUI_LOOP, assetPath(TUI_LOOP.capture));

		// nothing replaces a published file until every new one lints clean
		enforce(await lintTargets(built.map((b) => ({ file: b.file, profile: b.profile })), { fast: true }), "site loops and shots");
		const manifestPath = join(SITE_MEDIA, "manifest.json");
		const manifest: { version: 1; files: Record<string, { sha256: string; bytes: number; film: string; buildHash?: string }> } = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { version: 1, files: {} };
		mkdirSync(SITE_MEDIA, { recursive: true });
		for (const b of built) {
			copyFileSync(b.file, join(SITE_MEDIA, b.name));
			manifest.files[b.name] = { sha256: await sha256File(join(SITE_MEDIA, b.name)), bytes: statSync(join(SITE_MEDIA, b.name)).size, film: "loops" };
		}
		const sorted = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
		writeFileSync(manifestPath, `${JSON.stringify({ version: 1, files: sorted }, null, "\t")}\n`);
		console.log(`✓ ${built.length} files published to site/public/media (manifest.json updated)`);
	} finally {
		// never remove anything but our own mkdtemp dir
		if (!work.startsWith(`${tmpdir()}/atlas-studio-loops-`) || work.includes("..")) throw new StudioError(`refusing to remove ${work}`, "not a scratch dir of this command");
		rmSync(work, { recursive: true, force: true });
	}
}
