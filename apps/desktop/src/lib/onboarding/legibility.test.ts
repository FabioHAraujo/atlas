// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import {
	AA_BODY,
	STAGE_LAYOUT,
	contrast,
	copyScrim,
	layoutAt,
	luminance,
	over,
	scrimAlphaFor,
	worstCase,
} from "./legibility.ts";

describe("WCAG contrast maths", () => {
	test("relative luminance: black 0, white 1, and the sRGB curve is applied (mid grey is not 0.5)", () => {
		expect(luminance([0, 0, 0])).toBeCloseTo(0, 6);
		expect(luminance([255, 255, 255])).toBeCloseTo(1, 6);
		expect(luminance([128, 128, 128])).toBeCloseTo(0.2159, 3);
	});
	test("contrast ratio: white on black is 21:1, same colour is 1:1, and the order does not matter", () => {
		expect(contrast([255, 255, 255], [0, 0, 0])).toBeCloseTo(21, 4);
		expect(contrast([10, 20, 30], [10, 20, 30])).toBeCloseTo(1, 6);
		expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 4);
	});
	test("compositing a colour over another with alpha is linear per channel", () => {
		expect(over([255, 255, 255], [0, 0, 0], 0.5)).toEqual([128, 128, 128]);
		expect(over([200, 100, 50], [0, 0, 0], 0)).toEqual([0, 0, 0]);
		expect(over([200, 100, 50], [9, 9, 9], 1)).toEqual([200, 100, 50]);
	});
});

describe("scrimAlphaFor: how much dark the copy needs under it", () => {
	// Incident (user, live): the subtitle sat on the bright globe and was unreadable. The scrim is derived from the
	// brightest pixel the text can land on, not guessed.
	const subtitle = [150, 160, 180]; // --ca-text-secondary on dark, approx
	const scrim = [4, 5, 10];

	test("a dark backdrop needs no scrim", () => {
		expect(scrimAlphaFor({ text: subtitle, backdrop: [10, 12, 20], scrim, ratio: AA_BODY })).toBe(0);
	});
	test("the brightest globe highlight needs a strong one, and with it the text passes AA", () => {
		const hot = [235, 242, 255];
		const a = scrimAlphaFor({ text: subtitle, backdrop: hot, scrim, ratio: AA_BODY });
		expect(a).toBeGreaterThan(0.5);
		expect(contrast(subtitle, over(scrim, hot, a))).toBeGreaterThanOrEqual(AA_BODY);
	});
	test("is the SMALLEST alpha that passes (it does not blot out the globe more than needed)", () => {
		const hot = [235, 242, 255];
		const a = scrimAlphaFor({ text: subtitle, backdrop: hot, scrim, ratio: AA_BODY });
		expect(contrast(subtitle, over(scrim, hot, a - 0.02))).toBeLessThan(AA_BODY);
	});
	test("returns 1 when even a solid scrim cannot reach the ratio (a scrim as light as the text is the problem)", () => {
		expect(
			scrimAlphaFor({
				text: [150, 160, 180],
				backdrop: [235, 242, 255],
				scrim: [140, 150, 170],
				ratio: AA_BODY,
			}),
		).toBe(1);
	});
	test("dark text that already contrasts with a bright backdrop needs no scrim", () => {
		expect(
			scrimAlphaFor({ text: [20, 20, 30], backdrop: [235, 242, 255], scrim: [4, 5, 10], ratio: AA_BODY }),
		).toBe(0);
	});
	test("monotone: a brighter backdrop never needs a weaker scrim", () => {
		let prev = -1;
		for (const v of [20, 60, 100, 140, 180, 220, 255]) {
			const a = scrimAlphaFor({ text: subtitle, backdrop: [v, v, v], scrim, ratio: AA_BODY });
			expect(a).toBeGreaterThanOrEqual(prev);
			prev = a;
		}
	});
});

describe("worstCase: the brightest pixel in the text's box", () => {
	test("picks the highest-luminance sample, not the average", () => {
		const px = [
			[10, 10, 10],
			[250, 250, 250],
			[30, 30, 30],
			[90, 90, 90],
		];
		expect(worstCase(px)).toEqual([250, 250, 250]);
	});
	test("an empty sample list is treated as dark (nothing behind the text)", () => {
		expect(worstCase([])).toEqual([0, 0, 0]);
	});
});

describe("STAGE_LAYOUT: where the globe sits relative to the copy once the intro is over", () => {
	test("the globe is lifted above the copy's block and dimmed, so no tile or node crosses a letter", () => {
		expect(STAGE_LAYOUT.settled.globeCy).toBeLessThan(0.36);
		expect(STAGE_LAYOUT.settled.globeFraction).toBeLessThan(STAGE_LAYOUT.intro.globeFraction);
		expect(STAGE_LAYOUT.settled.dim).toBeGreaterThan(0.3);
	});
	test("the intro keeps the globe centred and large: the hero moment is untouched", () => {
		expect(STAGE_LAYOUT.intro.globeCy).toBeCloseTo(0.44, 2);
		expect(STAGE_LAYOUT.intro.dim).toBe(0);
	});
});

describe("copy anchoring", () => {
	test("the copy is anchored near the bottom in the settled state", () => {
		expect(STAGE_LAYOUT.copyBottomInset).toBeGreaterThanOrEqual(24);
		expect(STAGE_LAYOUT.copyBottomInset).toBeLessThanOrEqual(120);
	});
});

describe("layoutAt: the globe eases from hero to backdrop (no jump, no overlap with the copy)", () => {
	test("during the intro it is exactly the hero layout; once settled it is exactly the backdrop layout", () => {
		expect(layoutAt(0)).toEqual(STAGE_LAYOUT.intro);
		expect(layoutAt(1)).toEqual(STAGE_LAYOUT.settled);
	});
	test("in between every field moves monotonically from intro to settled (nothing overshoots or jumps)", () => {
		let prev = layoutAt(0);
		for (let k = 0.05; k <= 1.0001; k += 0.05) {
			const cur = layoutAt(k);
			expect(cur.globeCy).toBeLessThanOrEqual(prev.globeCy + 1e-9);
			expect(cur.globeFraction).toBeLessThanOrEqual(prev.globeFraction + 1e-9);
			expect(cur.dim).toBeGreaterThanOrEqual(prev.dim - 1e-9);
			prev = cur;
		}
	});
	test("out-of-range progress clamps, and NaN is the settled layout (never a half-moved globe at rest)", () => {
		expect(layoutAt(-3)).toEqual(STAGE_LAYOUT.intro);
		expect(layoutAt(9)).toEqual(STAGE_LAYOUT.settled);
		expect(layoutAt(Number.NaN)).toEqual(STAGE_LAYOUT.settled);
	});
});

describe("copyScrim: the measured scrim under the headline and subtitle", () => {
	test("covers the worst pixel of the globe for the subtitle (the hardest text) at AA", () => {
		const s = copyScrim({ worstBackdrop: [125, 143, 220], subtitle: [166, 168, 171] });
		expect(contrast([166, 168, 171], over([4, 5, 10], [125, 143, 220], s.alpha))).toBeGreaterThanOrEqual(
			AA_BODY,
		);
		expect(s.alpha).toBeGreaterThan(0);
		expect(s.alpha).toBeLessThanOrEqual(0.97);
	});
	test("adds headroom: AA is met with a margin so antialiasing and a theme change do not tip it under", () => {
		const s = copyScrim({ worstBackdrop: [125, 143, 220], subtitle: [166, 168, 171] });
		expect(contrast([166, 168, 171], over([4, 5, 10], [125, 143, 220], s.alpha))).toBeGreaterThanOrEqual(
			AA_BODY + 0.5,
		);
	});
	test("a dark backdrop still gets a soft floor scrim (the copy never sits bare on a glow)", () => {
		expect(
			copyScrim({ worstBackdrop: [10, 12, 20], subtitle: [166, 168, 171] }).alpha,
		).toBeGreaterThanOrEqual(0.4);
	});
});

describe("the settled globe leaves the copy's block clear on real window sizes", () => {
	// Structural: a centred copy block cannot clear a globe above it on a short window however the globe is scaled. So in
	// the settled state the copy block is anchored to the BOTTOM of the hero (copyBottomInset), and the globe lives in the
	// space above it. The block is 233 px tall in the live app (headline, subtitle, button, two links).
	const BLOCK = 233;
	const sizes = [
		[1012, 734],
		[1280, 790],
		[900, 600],
		[1600, 900],
		[760, 560],
		[1280, 640],
	];
	test("at every size the globe's bottom edge clears the top of the bottom-anchored copy block by at least 12 px", () => {
		const { globeCy, globeFraction } = STAGE_LAYOUT.settled;
		for (const [w, h] of sizes) {
			const globeBottom = globeCy * h + (globeFraction * Math.min(w, h)) / 2;
			const copyTop = h - STAGE_LAYOUT.copyBottomInset - BLOCK;
			expect(copyTop - globeBottom, `${w}x${h}`).toBeGreaterThanOrEqual(12);
		}
	});
	test("the globe stays fully inside the hero (its top edge is not cut off)", () => {
		const { globeCy, globeFraction } = STAGE_LAYOUT.settled;
		for (const [w, h] of sizes)
			expect(globeCy * h - (globeFraction * Math.min(w, h)) / 2, `${w}x${h}`).toBeGreaterThanOrEqual(8);
	});
});

// Regression (user, 2026-10-13, light theme): the welcome stage is always dark (night sky + a fixed dark scrim), but
// its copy used the THEME's text tokens, so in light themes the headline and subtitle were dark grey on near-black.
// The copy must read on the stage in every bundled theme, light and dark, using the colours the hero really applies.
import atlasFam from "../themes/atlas.json";
import draculaFam from "../themes/dracula.json";
import oneFam from "../themes/one.json";
import { parseFamily } from "../theme/schema.ts";
import { complete } from "../theme/derive.ts";
import { HERO_TEXT } from "./legibility.ts";

const hex = (h: string): [number, number, number] => {
	const s = h.replace("#", "").slice(0, 6);
	return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
};

describe("welcome copy reads on the always-dark stage in every theme", () => {
	const fams = [atlasFam, draculaFam, oneFam].map((f) => parseFamily(f).themes);
	const all = fams.flat();
	/** The dark theme of the same family: what the hero paints its copy with in light mode too. */
	const darkOf = (t) => fams.find((f) => f.includes(t))!.find((x) => x.appearance === "dark")!;
	test("there are light themes to check (the bug only shows there)", () => {
		expect(all.some((t) => t.appearance === "light")).toBe(true);
	});
	for (const t of all) {
		test(`${t.name} (${t.appearance}): headline, subtitle and secondary actions >= 4.5:1 on the stage`, () => {
			const d = darkOf(t);
			const colours = HERO_TEXT(complete(d.style, d.appearance));
			for (const [role, c] of Object.entries(colours)) {
				expect([t.name, role, contrast(hex(c), [4, 5, 10]) >= AA_BODY]).toEqual([t.name, role, true]);
			}
		});
	}
});
