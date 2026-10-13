import { describe, expect, test } from "bun:test";
import { lineSeconds } from "../audio/voice.ts";
import { ASPECTS } from "../lib/types.ts";
import type { Cut } from "../lib/types.ts";
import { safeRect } from "../lint/checks-image.ts";
import { PROFILES } from "../lint/profiles.ts";
import film from "../../films/atlas-1-0/film.ts";
import { captionsHtml, captionSidecar } from "./html.ts";
import { charEm, layoutCaptions, textEm } from "./layout.ts";
import { captionBox, minFontPx } from "./styles.ts";
import type { CaptionLayout } from "./layout.ts";

const vertical = film.cuts.find((c) => c.aspect === "9:16")!;
const profile = PROFILES["social-vertical"]!;
const rules = profile.captions!;
const frame = ASPECTS["9:16"];
const safe = safeRect({ w: frame.w, h: frame.h } as Parameters<typeof safeRect>[0], profile.safe!);

/** The real producer output: the voice cache's measured speech seconds. Absent cache -> the real-narration block is skipped, with the reason. */
const voice = vertical.voice!;
const seconds: Record<string, number> = {};
let cacheReason = "";
for (const l of voice.lines) {
	try {
		seconds[l.id] = await lineSeconds(voice, l, { offline: true });
	} catch (e) {
		cacheReason = `no cached voice for line "${l.id}": ${(e as Error).message}`;
		break;
	}
}
const real = cacheReason === "" ? describe : describe.skip;

function expectRules(l: CaptionLayout): void {
	for (const [i, c] of l.cues.entries()) {
		expect(c.lines.length, c.text).toBeLessThanOrEqual(rules.maxLines);
		for (const ln of c.lines) {
			expect(ln.length, `"${ln}" chars`).toBeLessThanOrEqual(rules.maxCharsPerLine);
			expect(textEm(ln) * c.fontPx, `"${ln}" px under the model`).toBeLessThanOrEqual(safe.w);
		}
		const dur = c.end - c.start;
		expect(dur, c.text).toBeGreaterThanOrEqual(rules.minDuration - 1e-9);
		expect(c.text.length / dur, `CPS of "${c.text}"`).toBeLessThanOrEqual(rules.maxCps + 1e-9);
		const next = l.cues[i + 1];
		if (next) {
			expect(next.start - c.end, `gap after "${c.text}"`).toBeGreaterThanOrEqual(rules.minGap - 1e-9);
		}
		expect(c.rect.x, c.text).toBeGreaterThanOrEqual(safe.x);
		expect(c.rect.y, c.text).toBeGreaterThanOrEqual(safe.y);
		expect(c.rect.x + c.rect.w, c.text).toBeLessThanOrEqual(safe.x + safe.w);
		expect(c.rect.y + c.rect.h, c.text).toBeLessThanOrEqual(safe.y + safe.h);
		if (c.lines.length > 1) for (const ln of c.lines) expect(ln.includes(" "), `orphan "${ln}"`).toBe(true);
	}
}

describe("font size and placement derive from the lint's floors", () => {
	test("9:16 font passes the lint's glyph-band rule at the display height", () => {
		const px = minFontPx(profile, frame.h);
		expect(px).toBe(80);
		expect(px * 0.8 * (profile.displayHeight / frame.h)).toBeGreaterThanOrEqual(profile.minTextPx);
		expect((px - 1) * 0.8 * (profile.displayHeight / frame.h)).toBeLessThan(profile.minTextPx);
	});

	test("the box sits in the lowest band inside profile.safe, bottom edge = safe bottom - 24 px", () => {
		const box = captionBox("reels", frame, profile, 192);
		expect(box.y + box.h).toBe(Math.round(frame.h * (1 - profile.safe!.bottom)) - 24);
		expect(box.x).toBe(safe.x);
		expect(box.x + box.w).toBe(safe.x + safe.w);
		expect(box.y).toBeGreaterThanOrEqual(safe.y);
	});

	test("feed profiles use the feed zones", () => {
		const sq = PROFILES["social-square"]!;
		const box = captionBox("feed", ASPECTS["1:1"], sq, 130);
		expect(box.y + box.h).toBe(Math.round(1080 * (1 - sq.safe!.bottom)) - 24);
	});
});

real("atlas-1-0 9:16 narration, real cached speech seconds", () => {
	const cut = { ...vertical, captions: { ...vertical.captions, burned: true } } as Cut;
	const layout = layoutCaptions(cut, film, profile, "9:16", seconds);

	test("no problems on the shipped narration", () => {
		expect(layout.problems).toEqual([]);
	});

	test("every cue's font is the legibility floor: its glyph band at the display height passes the lint", () => {
		for (const c of layout.cues) expect(c.fontPx * 0.8 * (profile.displayHeight / frame.h), c.text).toBeGreaterThanOrEqual(profile.minTextPx);
	});

	test("every rule holds: CPS, chars, width, duration, gaps, inside the safe rect, no orphan", () => {
		expect(layout.cues.length).toBeGreaterThanOrEqual(vertical.voice!.lines.length);
		expectRules(layout);
	});

	test("cues never overlap in time and stay inside their line's window", () => {
		for (const [i, c] of layout.cues.entries()) {
			const l = [...voice.lines].reverse().find((x) => x.at <= c.start + 1e-9)!;
			const next = voice.lines.find((x) => x.at > l.at);
			if (next) expect(c.end, c.text).toBeLessThanOrEqual(next.at - rules.minGap + 1e-9);
			expect(c.end, c.text).toBeLessThanOrEqual(l.at + seconds[l.id]! + 0.35 + rules.minDuration);
			if (i > 0) expect(c.start).toBeGreaterThanOrEqual(layout.cues[i - 1]!.end);
		}
	});

	test("the blocks' rect is the real block: lines x line-height x font (+ nothing for reels)", () => {
		for (const c of layout.cues) expect(c.rect.h).toBe(Math.ceil(c.lines.length * c.fontPx * 1.2));
	});

	test("html: one .clip per cue, ids cap0.., track 4, escaped text, durations from the cues", () => {
		const html = captionsHtml(layout.cues, layout.style);
		const ids = [...html.matchAll(/id="cap(\d+)"/g)].map((m) => Number(m[1]));
		expect(ids).toEqual(layout.cues.map((_, i) => i));
		expect(html.match(/data-track-index="4"/g)).toHaveLength(layout.cues.length);
		expect(html.match(/class="clip"/g)).toHaveLength(layout.cues.length);
	});

	test("sidecar is a deep copy of the cues", () => {
		const s = captionSidecar(layout.cues);
		expect(s).toEqual(layout.cues);
		s[0]!.rect.x += 1;
		expect(layout.cues[0]!.rect.x).not.toBe(s[0]!.rect.x);
	});
});

describe("html escaping", () => {
	test("text is escaped, quotes included", () => {
		const html = captionsHtml([{ start: 1, end: 2, text: `a <b> & "c"`, lines: [`a <b> & "c"`], rect: { x: 0, y: 0, w: 10, h: 10 }, fontPx: 80 }], "reels");
		expect(html).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
		expect(html).not.toContain("<b>");
	});
});

describe("boundaries through the whole layout", () => {
	const synthetic = (text: string, at = 1): Cut => ({ ...vertical, voice: { ...voice, lines: [{ id: "x", text, at }] }, captions: { vtt: false, burned: true } }) as Cut;

	test("a 1-word line", () => {
		const l = layoutCaptions(synthetic("Atlas."), film, profile, "9:16", { x: 0.5 });
		expect(l.problems).toEqual([]);
		expect(l.cues).toHaveLength(1);
		expectRules(l);
	});

	test("speech too short for the text is reported", () => {
		const l = layoutCaptions(synthetic("A GPU terminal, with emoji and inline images."), film, profile, "9:16", { x: 0.7 });
		expect(l.problems.length).toBeGreaterThan(0);
		expect(l.problems[0]).toContain('line "x"');
	});

	test("a missing speech measure is reported, not guessed", () => {
		const l = layoutCaptions(synthetic("Atlas."), film, profile, "9:16", {});
		expect(l.cues).toEqual([]);
		expect(l.problems[0]).toMatch(/no measured speech length/);
	});

	test("a long sentence splits into cues that all fit the safe width under the model", () => {
		const text = "Logs you can search, with regex and levels and time ranges, so you find the error in seconds.";
		const l = layoutCaptions(synthetic(text), film, profile, "9:16", { x: 9 });
		expect(l.problems).toEqual([]);
		expect(l.cues.length).toBeGreaterThan(1);
		expectRules(l);
		expect(l.cues.map((c) => c.text).join(" ")).toBe(text);
	});

	test("square and portrait cuts use their own safe rect", () => {
		for (const [aspect, id] of [["1:1", "social-square"], ["4:5", "social-portrait"]] as const) {
			const p = PROFILES[id]!;
			const f = ASPECTS[aspect];
			const sr = safeRect({ w: f.w, h: f.h } as Parameters<typeof safeRect>[0], p.safe!);
			const cut = { ...synthetic("Atlas is open source. Install it today."), aspect } as Cut;
			const l = layoutCaptions(cut, film, p, aspect, { x: 4 });
			expect(l.style).toBe("feed");
			for (const c of l.cues) {
				expect(c.rect.x).toBeGreaterThanOrEqual(sr.x);
				expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(sr.x + sr.w);
				expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(sr.y + sr.h);
			}
		}
	});
});
