import { describe, expect, test } from "bun:test";
import { charEm, textEm } from "./layout.ts";

// Incident: the 9:16 social cut's caption "emoji and inline images." was drawn 915 px wide at 80 px (OCR of the real
// render); the class model said 836 px, so the block entered the Reels/TikTok right rail by 28 px and the lint
// (rightly) failed `safe-area`. The widths below are the advances of the shipped Archivo at wght 700 / wdth 100
// (fontTools on assets/fonts/archivo-var.woff2), in ems: the model must agree with the font, not with a guess.
describe("charEm is the font's advance, not a class average", () => {
	test("the caption that overflowed: 11.378 em measured, within 1% in the model", () => {
		expect(textEm("emoji and inline images.")).toBeGreaterThan(11.378 * 0.99);
		expect(textEm("emoji and inline images.")).toBeLessThan(11.378 * 1.01);
	});

	test("every line of the 9:16 narration within 2% of the font's width (so wrapping decisions match the render)", () => {
		const measured: Record<string, number> = { "A GPU terminal, with": 9.772, "Atlas. Your whole dev": 10.26, "Open source. Free.": 9.07 };
		for (const [t, em] of Object.entries(measured)) expect(Math.abs(textEm(t) / em - 1)).toBeLessThan(0.02);
	});

	test("per glyph: i is narrow, m is wide, a space is 0.196 em, a capital W is the widest", () => {
		expect(charEm("i")).toBeCloseTo(0.267, 2);
		expect(charEm("m")).toBeCloseTo(0.891, 2);
		expect(charEm(" ")).toBeCloseTo(0.196, 2);
		expect(charEm("W")).toBeGreaterThan(charEm("M"));
	});

	test("a character outside the table falls back to the font's average advance (0.6 em), never to 0", () => {
		expect(charEm("é")).toBeGreaterThan(0.5);
		expect(charEm("→")).toBeGreaterThan(0.5);
	});
});
