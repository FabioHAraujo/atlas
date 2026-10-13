// Static checks on a film's sources and renditions: what an author can get wrong, said before a render (`bun studio check`).

import { profileFor, PROFILES } from "../lint/profiles.ts";
import type { Film } from "../lib/types.ts";

export function validateRenditions(film: Film): string[] {
	const problems: string[] = [];
	const sources = film.sources ?? [];
	const outs = new Set<string>();
	for (const cut of film.renditions ?? []) {
		const at = `${film.id}/${cut.out}`;
		if (outs.has(cut.out)) problems.push(`${at}: two renditions write the same out "${cut.out}"`);
		outs.add(cut.out);
		if (!cut.reframe) {
			problems.push(`${at}: a rendition needs \`reframe: { from, profile }\``);
			continue;
		}
		const src = sources.find((s) => s.out === cut.reframe!.from);
		if (!src) problems.push(`${at}: source cut "${cut.reframe.from}" does not exist (sources: ${sources.map((s) => s.out).join(", ") || "none"})`);
		if (!(cut.reframe.profile in PROFILES)) problems.push(`${at}: unknown profile "${cut.reframe.profile}" (profiles: ${Object.keys(PROFILES).join(", ")})`);
		else {
			const p = profileFor(cut.reframe.profile);
			const ratio = { "9:16": 9 / 16, "4:5": 4 / 5, "1:1": 1, "16:9": 16 / 9 }[cut.aspect];
			if (p.aspect && Math.abs(p.aspect.ratio - ratio) > p.aspect.tolerance) problems.push(`${at}: profile ${p.id} is for another aspect than ${cut.aspect}`);
		}
		if (cut.captions.burned && !cut.voice) problems.push(`${at}: burned captions need a voice (the narration lines are the captions)`);
	}
	for (const src of sources) {
		for (const scene of src.scenes) {
			if (scene.type !== "app" && scene.type !== "terminal") continue;
			const ids = new Set<string>();
			for (const f of scene.focus ?? []) {
				const at = `${film.id}/${src.out}/${scene.id}/${f.id}`;
				if (ids.has(f.id)) problems.push(`${at}: duplicate focus id "${f.id}" in scene ${scene.id}`);
				ids.add(f.id);
				if (f.selector === undefined && f.text === undefined && f.rect === undefined) problems.push(`${at}: a focus needs a selector, text or rect to be located`);
				if (f.at >= scene.duration) problems.push(`${at}: starts at ${f.at}s, after the scene ends (${scene.duration}s)`);
			}
		}
	}
	return problems;
}
