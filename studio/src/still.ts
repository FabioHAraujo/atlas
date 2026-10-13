// `bun studio still <film> [--aspect 16:9|9:16|1:1] [--at <seconds>] [--out <file>]`
//
// Re-render ONE still of a cut (its poster by default) without rendering the film: find the scene the instant falls in,
// render only that scene (silent, real compile + HyperFrames render, same crop/box/proxy as the film), take the frame
// at the scene-local offset and encode the poster JPEG exactly as `render` does. The still is linted before it
// replaces anything, so a bad frame never overwrites a good one. `bun studio publish <film> --stills` copies only the
// posters into site/public/media and updates manifest.json.
// (`hyperframes snapshot` is not used: it does not decode the <video> of app scenes.)

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ffmpeg, sha256File } from "./lib/exec.ts";
import { loadFilm, parseArgs, pickCuts } from "./lib/films.ts";
import { BUILD, OUT, StudioError } from "./lib/paths.ts";
import type { Cut, Scene } from "./lib/types.ts";
import { enforce } from "./lint/gate.ts";
import { lintTargets } from "./lint/index.ts";
import { renderCut } from "./render.ts";

/** Time of the still: `--at` wins, then the cut's `poster`, else the middle; never past the last frame. */
export function stillTime(cut: Cut, duration: number, at?: number): number {
	const t = at ?? cut.poster ?? duration / 2;
	if (t < 0 || t > duration) throw new StudioError(`--at ${t} is outside the cut (0-${duration.toFixed(2)} s)`, "pick a time inside the film");
	return Math.min(t, duration - 0.1);
}

/** The scene on screen at film time `t` and the time into that scene. A crossfade scene starts `duration` early. */
export function sceneAt(scenes: Scene[], t: number): { scene: Scene; offset: number } {
	let start = 0;
	for (const [i, scene] of scenes.entries()) {
		const begin = scene.transitionIn?.type === "crossfade" && i > 0 ? start - scene.transitionIn.duration : start;
		const end = begin + scene.duration;
		const next = scenes[i + 1];
		const nextBegin = next ? (next.transitionIn?.type === "crossfade" ? end - next.transitionIn.duration : end) : end;
		if (t >= begin && t < nextBegin) return { scene, offset: t - begin };
		start = end;
	}
	throw new StudioError(`no scene is on screen at ${t.toFixed(2)} s`, "pass --at inside the film");
}

export async function main(argv: string[]): Promise<void> {
	const { pos, flags } = parseArgs(argv);
	const film = await loadFilm(pos[0] ?? "");
	const at = typeof flags.at === "string" ? Number(flags.at) : undefined;
	if (at !== undefined && !Number.isFinite(at)) throw new StudioError(`bad --at "${flags.at}"`, "seconds, e.g. --at 41");
	for (const cut of pickCuts(film, flags.aspect)) {
		const total = cut.scenes.reduce((n, s, i) => n + s.duration - (s.transitionIn?.type === "crossfade" && i > 0 ? s.transitionIn.duration : 0), 0);
		const t = stillTime(cut, total, at);
		const { scene, offset } = sceneAt(cut.scenes, t);
		// the scene alone, with no fades, so the frame at `offset` is the film's frame
		const solo: Scene = { ...scene, transitionIn: { type: "cut", duration: 0 }, fadeOut: 0 };
		const work = join(BUILD, "still", film.id, cut.aspect.replace(":", "x"));
		rmSync(work, { recursive: true, force: true });
		mkdirSync(work, { recursive: true });
		const report = await renderCut({ ...film, music: undefined }, { ...cut, scenes: [solo], voice: undefined, chapters: undefined, overlays: undefined, captions: { vtt: false, burned: false } }, { minimal: true, out: work, compile: { dir: join(work, "project") } });
		const out = typeof flags.out === "string" ? flags.out : join(OUT, film.id, `${cut.out}-poster.jpg`);
		mkdirSync(join(out, ".."), { recursive: true });
		const tmp = join(work, "still.jpg");
		await ffmpeg(["-ss", String(offset), "-i", join(work, `${cut.out}.mp4`), "-frames:v", "1", "-vf", `scale=${report.width}:-2`, "-q:v", "3", tmp]);
		enforce(await lintTargets([{ file: tmp, profile: "still" }], { fast: true }), `${cut.out} still at ${t}s (${scene.id})`);
		copyFileSync(tmp, out);
		console.log(`✓ ${cut.out} still @ ${t}s (scene ${scene.id} +${offset.toFixed(2)}s) -> ${out} (sha256 ${(await sha256File(out)).slice(0, 12)})`);
	}
}
