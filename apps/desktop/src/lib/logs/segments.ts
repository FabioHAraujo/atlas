/**
 * Rendering split of one log line: ANSI runs cut at search hits and links (both may cross run
 * boundaries). Pure apart from the bounded parsed-runs cache.
 */

import { css, parseAnsi, type Run } from "#lib/ansi.ts";
import { findLinks, type LinkSpan } from "./links.ts";
import { matchesIn } from "./search.ts";
import type { LogLine } from "./model.ts";

export interface Seg {
	text: string;
	css: string;
	/** 0 = none, 1 = search hit, 2 = the current hit. */
	hit: 0 | 1 | 2;
	link?: LinkSpan | { kind: "osc"; target: string };
}

/** Parsed runs kept for re-renders while scrolling. */
const RUN_CACHE = 4000;
const runCache = new Map<number, Run[]>();

/** Parsed runs of a line; only lines that carry escapes are parsed (and cached). */
function runsOf(l: LogLine): Run[] {
	if (!l.raw) return [{ text: l.line, style: null }];
	let r = runCache.get(l.seq);
	if (!r) {
		r = parseAnsi(l.raw);
		if (runCache.size >= RUN_CACHE) runCache.delete(runCache.keys().next().value!);
		runCache.set(l.seq, r);
	}
	return r;
}

/** Runs of `l` split at `matcher` hits and links; `strong` marks hits of the current match. */
export function segments(l: LogLine, matcher: RegExp | null, strong: boolean): Seg[] {
	const text = l.line;
	const hits = matcher ? matchesIn(matcher, text) : [];
	const links = findLinks(text);
	const runs = runsOf(l);
	if (!hits.length && !links.length && runs.length === 1 && !runs[0].style?.link) {
		return [{ text, css: css(runs[0].style), hit: 0 }];
	}
	const out: Seg[] = [];
	let pos = 0;
	let h = 0;
	let k = 0;
	for (const run of runs) {
		const style = css(run.style);
		const osc = run.style?.link;
		let i = 0;
		while (i < run.text.length) {
			const abs = pos + i;
			while (h < hits.length && hits[h][1] <= abs) h++;
			while (k < links.length && links[k].end <= abs) k++;
			const inHit = h < hits.length && hits[h][0] <= abs;
			const inLink = k < links.length && links[k].start <= abs;
			let edge = Infinity;
			if (h < hits.length) edge = Math.min(edge, inHit ? hits[h][1] : hits[h][0]);
			if (k < links.length) edge = Math.min(edge, inLink ? links[k].end : links[k].start);
			const end = Math.min(run.text.length, edge - pos);
			out.push({
				text: run.text.slice(i, end),
				css: style,
				hit: inHit ? (strong ? 2 : 1) : 0,
				link: osc ? { kind: "osc", target: osc } : inLink ? links[k] : undefined,
			});
			i = end;
		}
		pos += run.text.length;
	}
	return out;
}
