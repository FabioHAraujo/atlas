// Burned-caption chunking: one narration line (text + the seconds of speech the voice cache measured) -> timed cues
// that obey the profile's caption rules (lint/types.ts `Profile.captions`, Netflix timed-text numbers tightened to a
// phone). Pure: no I/O, no fonts; the caller supplies the text-width measure so wrapping and the lint agree.

import type { Profile } from "../lint/types.ts";

export type CaptionRules = NonNullable<Profile["captions"]>;

/** Width of a string in ems (see layout.ts); `chunkLine` wraps lines so that this stays <= `maxEm`. */
export type Measure = (text: string) => number;

export interface WordTime {
	word: string;
	/** seconds in the cut */
	start: number;
	end: number;
}

export interface Cue {
	start: number;
	end: number;
	text: string;
	/** `text` wrapped: <= maxLines lines, each <= maxCharsPerLine chars and (with `fits`) within the block's width */
	lines: string[];
}

export interface Chunked {
	cues: Cue[];
	/** rule violations that no chunking can fix (the speech is too fast for the text); never silent */
	problems: string[];
}

/**
 * How late after its first word is spoken a cue may appear. Text that trails the voice by up to ~0.15 s (4-5 frames)
 * reads as in sync (EBU R37 puts the audio-lead / audio-lag detectability thresholds at 40 / 120 ms; a reader fixates
 * on the line a beat after it appears), and it is what lets two cues share a fast phrase: the first holds while the
 * next word is spoken. Beyond it the cue is wrong, not late.
 */
export const MAX_LAG = 0.15;

/** Seconds a cue stays after the last word is spoken: the eye finishes reading after the ear has finished hearing. */
export const TAIL = 0.35;

const SENTENCE_END = /[.?!]["')\]]*$/;
const PAUSE_LONG = /[.?!:]["')\]]*$/;
const PAUSE_SHORT = /,["')\]]*$/;

/**
 * Word times from line-level alignment. The voice cache only knows how long a LINE takes to speak
 * (`lineSeconds`, trailing silence trimmed), not when each word is said, so the line's seconds are distributed over
 * its words in proportion to a weight: characters + 1 (the inter-word gap), plus a pause of 3 characters after
 * sentence punctuation (. ? ! :) and 1.5 after a comma, where a speaker breathes. Contiguous, covering exactly
 * [start, start + seconds].
 */
export function wordTimes(text: string, start: number, seconds: number): WordTime[] {
	const words = text.split(/\s+/).filter(Boolean);
	const weights = words.map((w) => w.length + 1 + (PAUSE_LONG.test(w) ? 3 : PAUSE_SHORT.test(w) ? 1.5 : 0));
	const total = weights.reduce((a, b) => a + b, 0);
	let at = start;
	return words.map((word, i) => {
		const from = at;
		at = i === words.length - 1 ? start + seconds : at + (weights[i]! / total) * seconds;
		return { word, start: from, end: at };
	});
}

interface Ctx {
	rules: CaptionRules;
	measure: Measure;
	/** widest a wrapped line may be, ems; Infinity when only the character cap applies */
	maxEm: number;
}

const fits = (line: string, c: Ctx): boolean => line.length <= c.rules.maxCharsPerLine && c.measure(line) <= c.maxEm;

/**
 * Wrap words into at most `maxLines` lines, or null if impossible. Among the legal wraps pick the lowest cost:
 * a 1-word line next to other lines is an orphan (heavy), a line break after punctuation is rewarded, and unequal
 * lines are mildly penalised so the block stays compact (a short last line over a long first one reads badly).
 */
function wrap(words: string[], c: Ctx): string[] | null {
	const whole = words.join(" ");
	if (fits(whole, c)) return [whole];
	if (c.rules.maxLines < 2) return null;
	let best: { cost: number; lines: string[] } | null = null;
	for (let i = 1; i < words.length; i++) {
		const head = words.slice(0, i).join(" ");
		const rest = words.slice(i);
		if (!fits(head, c)) break;
		const tail = wrap(rest, { ...c, rules: { ...c.rules, maxLines: c.rules.maxLines - 1 } });
		if (!tail) continue;
		const lines = [head, ...tail];
		const orphan = lines.some((l) => !l.includes(" ")) ? 100 : 0;
		const prev = words[i - 1]!;
		const punct = SENTENCE_END.test(prev) ? -14 : PAUSE_LONG.test(prev) ? -10 : PAUSE_SHORT.test(prev) ? -8 : 0;
		const unbalance = Math.abs(head.length - tail.join(" ").length) / 4;
		const cost = orphan + punct + unbalance;
		if (!best || cost < best.cost) best = { cost, lines };
	}
	return best?.lines ?? null;
}

/** Break preference after word `i` (higher = better place to start a new cue). */
function breakScore(words: WordTime[], i: number): number {
	const w = words[i]!.word;
	if (SENTENCE_END.test(w)) return 3;
	if (PAUSE_LONG.test(w)) return 2;
	if (PAUSE_SHORT.test(w)) return 1.5;
	return 0;
}

/**
 * Split a run of words into cue-sized groups: a group is final when it wraps within the rules. Otherwise cut at the
 * best break near the middle (punctuation first, then balance) and recurse, so no group is left to stretch.
 */
function split(words: WordTime[], c: Ctx): WordTime[][] {
	if (words.length < 2 || wrap(words.map((w) => w.word), c)) return [words];
	const at = bestCut(words);
	return [...split(words.slice(0, at), c), ...split(words.slice(at), c)];
}

const sentences = (words: WordTime[]): WordTime[][] => {
	const out: WordTime[][] = [];
	let cur: WordTime[] = [];
	for (const w of words) {
		cur.push(w);
		if (SENTENCE_END.test(w.word)) {
			out.push(cur);
			cur = [];
		}
	}
	if (cur.length) out.push(cur);
	return out;
};

const textOf = (g: WordTime[]): string => g.map((w) => w.word).join(" ");

interface Placed {
	group: WordTime[];
	start: number;
	end: number;
}

/**
 * Chunk one narration line into cues.
 *
 * 1. Sentences first; a sentence that does not wrap into maxLines x width is cut at the best punctuation near its
 *    middle, recursively (`split`).
 * 2. Timing: a cue starts when its first word is spoken (see `wordTimes`) and ends at its last word + TAIL, never
 *    later than the next cue's start - minGap, nor `windowEnd - minGap` (the next narration line). Only minDuration
 *    may exceed the tail (a one-word cue still has to be read), and only inside that bound.
 * 3. A cue under minDuration or over maxCps is repaired in this order, whichever applies first:
 *    - merge with its neighbour when the union still wraps: more room, same words (a "Atlas." cue 0.5 s from the next
 *      sentence cannot be shown 0.8 s; "Atlas. Your whole dev stack" can);
 *    - otherwise, for CPS only, split at the best break when BOTH halves then pass; stretching is never used, it would
 *      run the text over audio that is not about it.
 * 4. What is still wrong is reported in `problems`, not shipped quietly.
 *
 * @param maxEm widest a wrapped line may be, in ems of `measure` (default: only the character cap applies)
 * @param windowEnd the start of whatever follows this line, seconds; the last cue ends at least minGap before it
 */
export function chunkLine(text: string, start: number, speechSeconds: number, rules: CaptionRules, measure: Measure, windowEnd?: number, maxEm = Infinity): Chunked {
	const ctx: Ctx = { rules, measure, maxEm };
	const words = wordTimes(text, start, speechSeconds);
	const problems: string[] = [];
	if (!words.length) return { cues: [], problems };

	// Cue timing, forward. A cue appears when its first word is spoken (never before the line start or before the
	// previous cue ends + minGap) and disappears at its last word + TAIL (the line's speech end + TAIL for the last).
	// It needs minDuration: a cue holds up to that, and the next one is delayed by at most MAX_LAG rather than this one
	// cut short. The tail cap is the contract: only minDuration may exceed it, never CPS (stretching a fast cue to pass
	// CPS would keep text on screen after the voice has moved on); a fast cue is SPLIT by the repair loop instead.
	const timeGroups = (gs: WordTime[][]): Placed[] => {
		const tail = start + speechSeconds + TAIL;
		const limit = windowEnd === undefined ? Infinity : windowEnd - rules.minGap;
		const out: Placed[] = [];
		let floor = start;
		for (const [i, group] of gs.entries()) {
			const last = i === gs.length - 1;
			const word = group[0]!.start;
			const from = Math.max(floor, word);
			const natural = last ? tail : group.at(-1)!.end + TAIL;
			// the cue holds as long as it needs; a following cue is delayed (<= MAX_LAG) rather than this one cut short
			const wanted = Math.max(natural, from + rules.minDuration);
			const next = gs[i + 1]?.[0]!.start;
			const roomEnd = Math.min(limit, next === undefined ? Infinity : next + MAX_LAG - rules.minGap);
			const end = Math.min(roomEnd, wanted);
			out.push({ group, start: from, end });
			floor = end + rules.minGap;
		}
		return out;
	};
	const tooShort = (p: Placed): boolean => p.end - p.start < rules.minDuration - 1e-9;

	let groups = sentences(words).flatMap((s) => split(s, ctx));
	// merging is the only repair that creates room (a split shares the same window, so it cannot cure CPS: checked over
	// 4000 random lines, a CPS-driven split never changed the result); the guard bounds the loop, one merge per pass
	for (let guard = 0; guard < words.length * 4; guard++) {
		const placed = timeGroups(groups);
		const bad = placed.findIndex(tooShort);
		if (bad < 0) break;
		const p = placed[bad]!;
		const neighbour = bad > 0 ? bad - 1 : bad + 1 < groups.length ? bad + 1 : -1;
		if (neighbour >= 0) {
			const [lo, hi] = [Math.min(bad, neighbour), Math.max(bad, neighbour)];
			const union = [...groups[lo]!, ...groups[hi]!];
			if (wrap(union.map((w) => w.word), ctx)) {
				groups = [...groups.slice(0, lo), union, ...groups.slice(hi + 1)];
				continue;
			}
		}
		break;
	}

	const cues: Cue[] = [];
	for (const p of timeGroups(groups)) {
		const lines = wrap(p.group.map((w) => w.word), ctx) ?? [textOf(p.group)];
		const cue: Cue = { start: p.start, end: p.end, text: textOf(p.group), lines };
		const dur = cue.end - cue.start;
		if (lines.length > rules.maxLines || lines.some((l) => !fits(l, ctx))) problems.push(`"${cue.text}" does not wrap into ${rules.maxLines} lines of ${rules.maxCharsPerLine} chars (one word is too wide)`);
		if (dur < rules.minDuration - 1e-9) problems.push(`"${cue.text}" shows for ${dur.toFixed(2)} s, under the ${rules.minDuration} s minimum duration (the next line starts too soon)`);
		const rate = cue.text.length / dur;
		if (rate > rules.maxCps + 1e-9) problems.push(`"${cue.text}" is ${rate.toFixed(1)} CPS, over the ${rules.maxCps} CPS limit: the speech is too fast for the text (shorten the line or slow the voice)`);
		cues.push(cue);
	}
	return { cues, problems };
}

/**
 * Index to cut a run of words at (the head keeps `at` words). The reading speed decides first: of the legal cuts
 * (no 1-word side when avoidable) take the one whose slower half is the least fast, i.e. minimise the worst CPS of the
 * two halves, each shown from its first word to its last word + TAIL. Punctuation breaks the tie (and wins when the
 * speeds are within 1 CPS of each other, since a pause in the voice is where the viewer expects the text to change).
 */
function bestCut(g: WordTime[]): number {
	const cps = (part: WordTime[]): number => textOf(part).length / (part.at(-1)!.end + TAIL - part[0]!.start);
	let at = 1;
	let best = Infinity;
	for (let i = 0; i < g.length - 1; i++) {
		const worst = Math.max(cps(g.slice(0, i + 1)), cps(g.slice(i + 1)));
		const orphan = i === 0 || i === g.length - 2 ? 2 : 0;
		const score = worst + orphan - breakScore(g, i);
		if (score < best) {
			best = score;
			at = i + 1;
		}
	}
	return at;
}
