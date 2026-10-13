// `bun studio fix <film> --apply [--aspect 9:16] [--max 4]`: lint -> fix -> lint on the rendered social cuts, with a
// ceiling. A fix is a machine-applicable camera change taken from a lint diagnostic (`set-camera-zoom`); applying it
// means writing `films/<id>/camera.json`, the only file this command writes, then re-rendering and linting again.
// The loop stops when there are 0 errors, when a round applies nothing (an error no camera knob can cure), or at
// `--max` rounds, and always prints what it did: an agent reads the report instead of guessing.

import { loadOverrides, mergeOverrides, overridesPath, saveOverrides } from "./camera/derive.ts";
import type { CameraOverrides } from "./camera/reframe.ts";
import { loadFilm, parseArgs, pickCuts } from "./lib/films.ts";
import { OUT, StudioError } from "./lib/paths.ts";
import { join } from "node:path";
import { lintTargets } from "./lint/index.ts";
import type { Diagnostic, LintReport } from "./lint/types.ts";
import { renderCut } from "./render.ts";

const SET_ZOOM_CODES = new Set(["text/too-small-for-target", "camera/subject-out-of-frame"]);

/**
 * Overrides the diagnostics ask for, keyed `<cut>/<shot>/<focus>`. Only error-level `set-camera-zoom` fixes count.
 * Per focus the zooms are combined: "too small" asks for AT LEAST a zoom, "out of frame" for AT MOST one. The largest
 * minimum wins; when it exceeds the smallest maximum no zoom satisfies both, so nothing is applied for that focus.
 */
export function overridesFrom(cutOut: string, diagnostics: Diagnostic[]): CameraOverrides {
	const wants = new Map<string, { min: number; max: number }>();
	for (const d of diagnostics) {
		if (d.severity !== "error" || d.fix?.action !== "set-camera-zoom") continue;
		const { shot, focus, zoom } = d.fix.params ?? {};
		if (typeof shot !== "string" || typeof focus !== "string" || typeof zoom !== "number") continue;
		const key = `${cutOut}/${shot}/${focus}`;
		const w = wants.get(key) ?? { min: 1, max: Infinity };
		// "too small" fixes name the zoom that is needed (a minimum); "out of frame" names the largest that fits (a maximum)
		if (d.code === "camera/subject-out-of-frame") w.max = Math.min(w.max, zoom);
		else if (SET_ZOOM_CODES.has(d.code)) w.min = Math.max(w.min, zoom);
		wants.set(key, w);
	}
	const out: CameraOverrides = {};
	for (const [key, w] of wants) if (w.min <= w.max && (w.min > 1 || w.max < Infinity)) out[key] = { zoom: w.max < Infinity && w.min === 1 ? w.max : w.min };
	return out;
}

export interface FixIo {
	cutOut: string;
	/** lint the rendered cut(s) as they are now */
	lint: () => Promise<LintReport[]>;
	/** persist overrides (camera.json) */
	apply: (overrides: CameraOverrides) => Promise<void>;
	/** re-render the cut with the overrides applied */
	render: () => Promise<void>;
}

export interface FixRound {
	/** 0 = the lint of what was rendered before the loop started */
	round: number;
	errors: number;
	applied: CameraOverrides;
}

export interface FixResult {
	converged: boolean;
	iterations: FixRound[];
	/** error diagnostics still present at the end */
	remaining: Diagnostic[];
	reason: string;
}

const errorsOf = (reports: LintReport[]) => reports.flatMap((r) => r.diagnostics.filter((d) => d.severity === "error"));

export async function fixLoop(io: FixIo, opts: { maxIterations: number }): Promise<FixResult> {
	const iterations: FixRound[] = [];
	let errors = errorsOf(await io.lint());
	iterations.push({ round: 0, errors: errors.length, applied: {} });
	for (let round = 1; errors.length > 0; round++) {
		const unfixable = errors.filter((d) => d.fix?.action === "enlarge-source-text");
		const overrides = overridesFrom(io.cutOut, errors);
		if (Object.keys(overrides).length === 0) {
			const why = unfixable.length ? `${unfixable.length} error(s) need a human decision (enlarge-source-text: the recording's text is too small for any camera zoom)` : "no applicable fix in the remaining errors (the camera cannot cure them)";
			return { converged: false, iterations, remaining: errors, reason: why };
		}
		if (round > opts.maxIterations) return { converged: false, iterations, remaining: errors, reason: `still ${errors.length} error(s) after ${opts.maxIterations} fix rounds` };
		await io.apply(overrides);
		await io.render();
		errors = errorsOf(await io.lint());
		iterations.push({ round, errors: errors.length, applied: overrides });
	}
	return { converged: true, iterations, remaining: [], reason: "0 errors" };
}

export async function main(argv: string[]): Promise<void> {
	const { pos, flags } = parseArgs(argv);
	if (!pos[0]) throw new StudioError("fix needs a film id", "bun studio fix atlas-1-0 --apply [--aspect 9:16] [--max 4]");
	const film = await loadFilm(pos[0]);
	const cuts = (flags.cut !== undefined || flags.aspect !== undefined ? pickCuts(film, flags.aspect, flags.cut) : (film.renditions ?? [])).filter((c) => c.reframe);
	if (cuts.length === 0) throw new StudioError(`${film.id} has no derived (reframe) cut to fix`, "a cut with `reframe: { from, profile }`; fixes are camera overrides");
	const max = typeof flags.max === "string" ? Number(flags.max) : 4;
	if (!Number.isInteger(max) || max < 1) throw new StudioError(`bad --max "${flags.max}"`, "a whole number of rounds >= 1");
	const file = overridesPath(film.id);
	let failed = false;
	for (const cut of cuts) {
		const target = join(OUT, film.id, `${cut.out}.mp4`);
		const lint = () => lintTargets([{ file: target, profile: cut.reframe!.profile }], {});
		if (!flags.apply) {
			const errors = errorsOf(await lint());
			const asks = overridesFrom(cut.out, errors);
			console.log(`${cut.out}: ${errors.length} error(s); would apply ${JSON.stringify(asks)}  (add --apply)`);
			failed ||= errors.length > 0;
			continue;
		}
		const result = await fixLoop(
			{
				cutOut: cut.out,
				lint,
				apply: async (o) => saveOverrides(file, mergeOverrides(loadOverrides(file), o)),
				render: async () => {
					// the film's derived cuts are planned from camera.json, which was just rewritten
					await renderCut(film, cut, { offline: true });
				},
			},
			{ maxIterations: max }
		);
		console.log(`\n${cut.out}: ${result.converged ? "✓ converged" : "✗ not converged"} (${result.reason})`);
		for (const r of result.iterations) console.log(`  round ${r.round}: ${r.errors} error(s)${Object.keys(r.applied).length ? `  applied ${JSON.stringify(r.applied)}` : ""}`);
		for (const d of result.remaining) console.log(`  ✗ ${d.code}${d.range ? ` @ ${d.range.start.toFixed(2)}-${d.range.end.toFixed(2)}s` : ""}: ${d.message}${d.fix ? `\n      fix: ${d.fix.description}` : ""}`);
		failed ||= !result.converged;
	}
	if (failed) process.exit(1);
}
