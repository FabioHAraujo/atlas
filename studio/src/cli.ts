#!/usr/bin/env bun
// bun studio <command> — see studio/AGENTS.md. Errors print a message and a fix hint, never a stack trace.

import { lineAudio, listModels } from "./audio/voice.ts";
import { main as bg } from "./backgrounds.ts";
import { main as capture } from "./capture/index.ts";
import { main as fix } from "./fix.ts";
import { main as check } from "./check.ts";
import { main as lint } from "./lint/index.ts";
import { main as loops } from "./loops.ts";
import { importLegacy } from "./legacy.ts";
import { listAssets, verifyAssets } from "./lib/assets.ts";
import { listFilms, loadFilm, parseArgs, pickCuts } from "./lib/films.ts";
import { loadEnv, StudioError } from "./lib/paths.ts";
import { main as preview } from "./preview.ts";
import { main as publish } from "./publish.ts";
import { main as release } from "./release.ts";
import { renderCut } from "./render.ts";
import { main as sounds } from "./sounds/index.ts";
import { main as run } from "./run/index.ts";
import { main as still } from "./still.ts";

const HELP = `bun studio <command>

  render <film> [--aspect 16:9|9:16|4:5|1:1] [--cut <out>] [--draft]   compile, render, mix, derive webm/vtt/poster/sprite -> studio/out/<film>/
  preview <film> [--aspect 16:9]                     live preview (HyperFrames Studio) of the compiled project, rebuilt on save
  still <film> [--aspect …] [--at s] [--out f]       re-render ONE still (the poster by default) without rendering the film; linted before it is written
  voice <film> [--models] [--offline]                synthesize narration (cached by text hash); --models lists ElevenLabs models
  capture app <scene>|tui <take>|list                record the real app (isolated instance) or the vhs TUI take
  run <recipe.ts|json> [--force] [--only a,b] [--dry-run]   execute a recipe end to end, no agent: capture (cached by script + app build) -> render -> lint -> publish
  bg <a|b|c|v|--all>                                 cobalt background stills (Magnific; the 1.0 prompts and seeds)
  assets [list|verify|import <work-dir>]             the cache manifest (hashes), or seed it from the 1.0 working dir
  publish <film> [--release vX.Y.Z] [--stills]       copy outputs into site/public/media with content hashes (+ gh release upload); --stills: only the posters; refuses lint errors
  release <version> [--voice] [--aspect …]           'What's new in vX' video from CHANGELOG.md
  check                                              typecheck, brand sync, film validation, HyperFrames lint, 1 s/scene smoke render, media lint of published files
  lint <film|file|dir> [--profile p] [--json] [--ref f] [--fast] [--strict]   the "video LSP": frame/safe-area/text/flash/black/loudness/spec diagnostics with fixes
  loops [--only loop-panel,shot-agents]              the site's loops + screenshots from recipes/site-media.ts captures (+ the vhs take for loop-tui); linted before it replaces anything
  sounds [list|generate|pick] [id…] [--variants N]   the app's earcons: ElevenLabs sound effects -> trim/normalise -> apps/desktop/static/sounds
  fix <film> [--apply] [--aspect …|--cut <out>] [--max N] lint -> apply the camera fixes the diagnostics suggest (films/<id>/camera.json) -> re-render -> lint, up to N rounds; prints a report
  films                                              list films
`;

async function main(argv: string[]): Promise<void> {
	loadEnv();
	process.env.HYPERFRAMES_NO_TELEMETRY = "1";
	const [cmd, ...rest] = argv;
	const { pos, flags } = parseArgs(rest);
	switch (cmd) {
		case undefined:
		case "help":
		case "--help":
			console.log(HELP);
			return;
		case "films":
			console.log(listFilms().join("\n"));
			return;
		case "render": {
			const film = await loadFilm(pos[0] ?? "");
			for (const cut of pickCuts(film, flags.aspect, flags.cut)) {
				const t0 = Date.now();
				const r = await renderCut(film, cut, { draft: flags.draft === true, offline: flags.offline === true });
				console.log(`✓ ${cut.out}  ${r.duration.toFixed(2)} s  ${r.width}x${r.height}  ${r.lufs.toFixed(1)} LUFS  build ${r.buildHash}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
			}
			return;
		}
		case "voice": {
			if (flags.models) {
				for (const m of await listModels()) console.log(`${m.model_id}\t${m.name}`);
				return;
			}
			const film = await loadFilm(pos[0] ?? "");
			for (const cut of film.cuts) {
				for (const l of cut.voice?.lines ?? []) {
					await lineAudio(cut.voice!, l, { offline: flags.offline === true });
					console.log(`✓ ${cut.out}:${l.id}`);
				}
			}
			return;
		}
		case "assets": {
			const sub = pos[0] ?? "list";
			if (sub === "import") {
				const done = await importLegacy(pos[1] ?? process.env.FILM_WORK ?? "/tmp/atlas-film/work");
				console.log(`imported ${done.length} assets`);
			} else if (sub === "verify") {
				const bad = await verifyAssets();
				for (const b of bad) console.error(`✗ ${b.key}: ${b.problem}`);
				if (bad.length > 0) process.exit(1);
				console.log(`✓ ${listAssets().length} assets verified`);
			} else for (const a of listAssets()) console.log(`${a.key.padEnd(34)} ${a.sha256.slice(0, 12)}  ${(a.bytes / 1e6).toFixed(1).padStart(6)} MB  ${a.source}`);
			return;
		}
		case "capture":
			return capture(rest);
		case "run":
			return run(rest);
		case "bg":
			return bg(rest);
		case "sounds":
			return sounds(rest);
		case "publish":
			return publish(rest);
		case "release":
			return release(rest);
		case "preview":
			return preview(rest);
		case "check":
			return check(rest);
		case "lint":
			return lint(rest);
		case "still":
			return still(rest);
		case "fix":
			return fix(rest);
		case "loops":
			return loops(rest);
		default:
			throw new StudioError(`unknown command "${cmd}"`, "bun studio help");
	}
}

main(process.argv.slice(2)).catch((e: unknown) => {
	if (e instanceof StudioError) {
		console.error(`✗ ${e.message}${e.hint ? `\n  ${e.hint.replace(/\n/g, "\n  ")}` : ""}`);
		process.exit(1);
	}
	throw e;
});
