// The lint gate shared by `bun studio check` (published media must be clean) and `bun studio publish` (refuses to
// copy a render that has errors). Warnings are printed, never fatal.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { StudioError } from "../lib/paths.ts";
import { SITE_MEDIA } from "../lib/paths.ts";
import { loadFilm } from "../lib/films.ts";
import { lintTargets, type LintOpts } from "./index.ts";
import { profileForAspect } from "./profiles.ts";
import type { LintReport } from "./types.ts";

/** Throw a StudioError listing every error diagnostic (with its fix) of `reports`; print warnings. */
export function enforce(reports: LintReport[], what: string): void {
	const lines: string[] = [];
	for (const r of reports) {
		for (const d of r.diagnostics) {
			const where = d.rect ? ` @ ${d.rect.x},${d.rect.y} ${d.rect.w}x${d.rect.h}` : d.range ? ` @ ${d.range.start.toFixed(1)}s` : "";
			if (d.severity === "warning") console.warn(`  ! ${r.target.file}: ${d.code}${where}: ${d.message}`);
			if (d.severity === "error") lines.push(`${r.target.file}: ${d.code}${where}: ${d.message}${d.fix ? `\n      fix: ${d.fix.description}` : ""}`);
		}
	}
	if (lines.length > 0) throw new StudioError(`${what}: ${lines.length} lint error(s)`, `${lines.join("\n")}\n\nsee them with: bun studio lint <file> --json`);
}

/**
 * Files a film publishes into site/public/media, as lint targets: the cut videos and their posters, each with the
 * profile of its aspect. Only files that exist are returned.
 */
export async function publishedTargets(filmId: string): Promise<Array<{ file: string; profile: string }>> {
	const film = await loadFilm(filmId);
	return film.cuts.flatMap((cut) =>
		[`${cut.out}.mp4`, `${cut.out}-poster.jpg`]
			.map((f) => join(SITE_MEDIA, f))
			.filter((f) => existsSync(f))
			.map((file) => ({ file, profile: file.endsWith(".jpg") ? "still" : profileForAspect(cut.aspect) })),
	);
}

export async function lintPublished(filmId: string, opts: LintOpts = {}): Promise<LintReport[]> {
	return lintTargets(await publishedTargets(filmId), opts);
}
