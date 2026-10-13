import { describe, expect, test } from "bun:test";
import { chunkLine, MAX_LAG, wordTimes } from "./chunk.ts";
import type { CaptionRules, Cue } from "./chunk.ts";

// Real rules of the 9:16 profile; the measure is "one em per character" scaled so 27 chars is exactly the line width,
// i.e. the character cap alone decides. layout.test.ts covers the real width model.
const RULES: CaptionRules = { maxCps: 17, maxCharsPerLine: 27, maxLines: 2, minGap: 0.067, minDuration: 0.8 };
const chars = (t: string): number => t.length;
const cps = (c: { start: number; end: number; text: string }): number => c.text.replace(/\s+/g, " ").length / (c.end - c.start);

function invariants(cues: Cue[], rules: CaptionRules = RULES): void {
	for (const [i, c] of cues.entries()) {
		expect(c.lines.length, `lines of "${c.text}"`).toBeLessThanOrEqual(rules.maxLines);
		for (const l of c.lines) expect(l.length, `"${l}"`).toBeLessThanOrEqual(rules.maxCharsPerLine);
		expect(c.lines.join(" ")).toBe(c.text);
		expect(c.end - c.start, `duration of "${c.text}"`).toBeGreaterThanOrEqual(rules.minDuration - 1e-9);
		const next = cues[i + 1];
		if (next) expect(next.start - c.end, `gap after "${c.text}"`).toBeGreaterThanOrEqual(rules.minGap - 1e-9);
	}
}

describe("wordTimes: a line's seconds distributed over its words", () => {
	test("proportional to characters + 1, with pause weight after . ? ! : (3) and , (1.5)", () => {
		const t = wordTimes("Atlas. Your stack", 0, 10);
		// weights: "Atlas." = 6+1+3 = 10, "Your" = 5, "stack" = 6 -> total 21
		expect(t[0]).toEqual({ word: "Atlas.", start: 0, end: (10 / 21) * 10 });
		expect(t[1]!.start).toBeCloseTo((10 / 21) * 10, 9);
		expect(t[2]!.end).toBeCloseTo(10, 9);
	});

	test("a comma weighs 1.5, a colon 3", () => {
		const a = wordTimes("one, two", 0, 1)[0]!;
		const b = wordTimes("one: two", 0, 1)[0]!;
		// "one," = 4 chars + 1 + 1.5 pause; "two" = 3 chars + 1
		expect(a.end).toBeCloseTo(6.5 / (6.5 + 4), 9);
		expect(b.end).toBeCloseTo(8 / (8 + 4), 9);
	});

	test("words are contiguous and cover exactly [start, start + seconds]", () => {
		const t = wordTimes("A GPU terminal, with emoji and inline images.", 2, 3.61);
		expect(t[0]!.start).toBe(2);
		expect(t.at(-1)!.end).toBeCloseTo(5.61, 9);
		for (let i = 1; i < t.length; i++) expect(t[i]!.start).toBeCloseTo(t[i - 1]!.end, 9);
	});
});

describe("chunkLine", () => {
	test("a short line is one cue that ends at speech end + 0.35 tail", () => {
		const { cues, problems } = chunkLine("Install it today.", 10, 2, RULES, chars);
		expect(problems).toEqual([]);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.start).toBe(10);
		expect(cues[0]!.end).toBeCloseTo(12.35, 9);
		expect(cues[0]!.lines).toEqual(["Install it today."]);
	});

	test("the tail never runs into the next line: end is capped at the window's end", () => {
		const { cues } = chunkLine("Install it today.", 10, 2, RULES, chars, 10 + 2.1);
		expect(cues[0]!.end).toBeCloseTo(12.1 - RULES.minGap, 9);
	});

	test("sentences split first: a break at the full stop beats a more central one", () => {
		// "Atlas is open source." (21) | "Install it today with one command." (34): the stop is off-centre, a mid-sentence cut is nearer the middle
		const text = "Atlas is open source. Install it today with one command.";
		const { cues, problems } = chunkLine(text, 0, 6, RULES, chars);
		expect(problems).toEqual([]);
		expect(cues.map((c) => c.text)).toEqual(["Atlas is open source.", "Install it today with one command."]);
		invariants(cues);
	});

	test("a first sentence with no room for minDuration is merged with the next, not shown for 0.55 s", () => {
		// 'Atlas.' is spoken in ~0.55 s of this 3.07 s line: as its own cue it would flash by under the 0.8 s minimum
		const { cues, problems } = chunkLine("Atlas. Your whole dev stack, in one file.", 0.55, 3.07, RULES, chars);
		expect(problems).toEqual([]);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.text).toBe("Atlas. Your whole dev stack, in one file.");
		invariants(cues);
	});

	test("a 1-word line is one cue of at least minDuration", () => {
		const { cues, problems } = chunkLine("Atlas.", 0, 0.4, RULES, chars);
		expect(problems).toEqual([]);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.end - cues[0]!.start).toBeGreaterThanOrEqual(RULES.minDuration);
	});

	test("a long sentence splits to <= maxLines x maxCharsPerLine, preferring a break after the comma", () => {
		const text = "MCP is built in, so your agent sees the same stack you do every day.";
		const { cues, problems } = chunkLine(text, 0, 9, RULES, chars);
		expect(problems).toEqual([]);
		expect(cues.length).toBeGreaterThan(1);
		expect(cues[0]!.text.endsWith(",")).toBe(true);
		invariants(cues);
		expect(cues.map((c) => c.text).join(" ")).toBe(text);
	});

	test("punctuation preference: the comma break wins over the better-balanced one", () => {
		// balanced would be "Hide it, and peek the" | "sidebar back whenever you want"; the comma sits after word 2
		const { cues } = chunkLine("Hide it, and peek the sidebar back whenever you want", 0, 7, RULES, chars);
		expect(cues[0]!.text).toBe("Hide it,");
		expect(cues[1]!.text.startsWith("and peek")).toBe(true);
	});

	test("never leaves a 1-word orphan line when avoidable", () => {
		// the better-balanced wrap is ["Atlas Atlas Atlas Atlas", "Supercalifragilistic"] (23 + 20): an orphan line
		const { cues } = chunkLine("Atlas Atlas Atlas Atlas Supercalifragilistic", 0, 8, RULES, chars);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.lines).toEqual(["Atlas Atlas Atlas", "Atlas Supercalifragilistic"]);
	});

	test("punctuation preference inside a cue: the line breaks after the comma, not at the most balanced word", () => {
		const { cues } = chunkLine("open the panel, and watch logs live now in", 0, 10, RULES, chars);
		expect(cues).toHaveLength(1);
		expect(cues[0]!.lines).toEqual(["open the panel,", "and watch logs live now in"]);
	});

	test("a sentence boundary is always a cue boundary when there is room, even if both fit one cue", () => {
		const { cues } = chunkLine("Atlas. Open source.", 0, 8, RULES, chars);
		expect(cues.map((c) => c.text)).toEqual(["Atlas.", "Open source."]);
	});

	test("a lone orphan word is allowed only when the text is a single word", () => {
		const { cues } = chunkLine("Supercalifragilistic", 0, 2, RULES, chars);
		expect(cues[0]!.lines).toEqual(["Supercalifragilistic"]);
	});

	test("a line too fast for its window is reported, not stretched past the tail", () => {
		// 50 chars need 2.94 s at 17 CPS but the window (speech + 0.35 tail) is 2.75 s
		const { cues, problems } = chunkLine("Every project is a space you switch to in one move", 0, 2.4, RULES, chars);
		expect(problems.join("\n")).toMatch(/CPS/);
		expect(cues.at(-1)!.end).toBeCloseTo(2.75, 9);
	});

	test("the same line with enough speech passes every rule", () => {
		const { cues, problems } = chunkLine("Every project is a space you switch to in one move", 0, 2.7, RULES, chars);
		expect(problems).toEqual([]);
		for (const c of cues) expect(cps(c)).toBeLessThanOrEqual(RULES.maxCps + 1e-9);
	});

	test("exactly at the CPS limit passes: 17 chars shown for exactly 1 s", () => {
		const rules: CaptionRules = { ...RULES, minDuration: 0.5 };
		const { cues, problems } = chunkLine("seventeen chars!!", 0, 1 - 0.35, rules, chars);
		expect(problems).toEqual([]);
		expect(cues[0]!.end - cues[0]!.start).toBeCloseTo(1, 9);
		expect(cps(cues[0]!)).toBeCloseTo(17, 9);
	});

	test("one char over the limit at the same duration is reported, never silently broken", () => {
		const rules: CaptionRules = { ...RULES, minDuration: 0.5 };
		const { cues, problems } = chunkLine("eighteen chars!!!", 0, 1 - 0.35, rules, chars);
		expect(cues).toHaveLength(1);
		expect(problems).toEqual([]);
		// 17 chars in 0.9 s is 18.9 CPS and nothing can be split or stretched: it must be reported
		const tight = chunkLine("eighteen charss!!", 0, 0.9 - 0.35, rules, chars);
		expect(tight.problems.length).toBeGreaterThan(0);
		expect(tight.problems[0]).toMatch(/CPS/);
		expect(tight.cues[0]!.end - tight.cues[0]!.start).toBeCloseTo(0.9, 9);
	});

	test("speech too short for the text is reported in problems", () => {
		const { problems } = chunkLine("A GPU terminal, with emoji and inline images.", 0, 0.8, RULES, chars);
		expect(problems.length).toBeGreaterThan(0);
		expect(problems.join("\n")).toMatch(/CPS|duration/);
	});

	test("cues never overlap and keep the minimum gap, on a line with many sentences", () => {
		const { cues } = chunkLine("One. Two. Three. Four. Five. Six.", 0, 6, RULES, chars);
		invariants(cues);
		for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end + RULES.minGap - 1e-9);
	});

	test("each cue starts when its first word is spoken (VO alignment), not at the line's start", () => {
		const text = "Atlas is open source. Install it today with one command.";
		const { cues } = chunkLine(text, 4, 6, RULES, chars);
		const words = wordTimes(text, 4, 6);
		expect(cues[0]!.start).toBeCloseTo(4, 9);
		// appears with its first word, or at most MAX_LAG after it (the previous cue holds its minimum duration first)
		expect(cues[1]!.start).toBeGreaterThanOrEqual(words[4]!.start - 1e-9);
		expect(cues[1]!.start).toBeLessThanOrEqual(words[4]!.start + MAX_LAG + 1e-9);
	});
});
