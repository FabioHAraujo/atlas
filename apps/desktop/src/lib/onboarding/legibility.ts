/**
 * Legibility of the welcome copy over the globe. Pure maths: WCAG 2.x contrast, the weakest scrim that makes a text
 * colour pass over the brightest pixel behind it, and where the settled globe sits relative to the copy.
 * Incident (user, live): the subtitle sat on the bright globe and the nodes and edges cut through the letters.
 */

import { ATLAS } from "./intro/render.ts";

export type Rgb = readonly [number, number, number];

/** WCAG 2.x AA for body text (under 18.66 px bold / 24 px regular). */
export const AA_BODY = 4.5;

const lin = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance of an sRGB colour (0..255 channels). */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

/** WCAG contrast ratio, 1..21; symmetric. */
export function contrast(a: Rgb, b: Rgb): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** `top` composited over `bottom` at `alpha`, rounded to whole channels. */
export const over = (top: Rgb, bottom: Rgb, alpha: number): [number, number, number] =>
	[0, 1, 2].map((i) => Math.round(top[i]! * alpha + bottom[i]! * (1 - alpha))) as [number, number, number];

/**
 * The smallest scrim opacity (0..1, in 1% steps) that makes `text` reach `ratio` over `backdrop`; 0 when it already
 * does, 1 when even a solid scrim cannot (the text colour is then the problem, not the backdrop).
 */
export function scrimAlphaFor(s: { text: Rgb; backdrop: Rgb; scrim: Rgb; ratio: number }): number {
	if (contrast(s.text, s.backdrop) >= s.ratio) return 0;
	for (let step = 1; step <= 100; step++) {
		const a = step / 100;
		if (contrast(s.text, over(s.scrim, s.backdrop, a)) >= s.ratio) return a;
	}
	return 1;
}

/** The brightest sample (by luminance): the pixel the text is hardest to read on. Black for an empty list. */
export function worstCase(samples: Rgb[]): Rgb {
	let best: Rgb = [0, 0, 0];
	let max = -1;
	for (const p of samples) {
		const l = luminance(p);
		if (l > max) {
			max = l;
			best = p;
		}
	}
	return best;
}

/**
 * Where the globe sits, as fractions of the box, in the two moments of the welcome. During the intro it is the hero:
 * large and centred. Once the intro is over it is a backdrop: smaller, lifted above the copy, softened, so no tile or
 * node crosses a letter. The copy is anchored to the bottom in that state (`copyBottomInset`): a centred block cannot
 * clear a globe above it on a short window however the globe is scaled.
 */
export const STAGE_LAYOUT = {
	intro: { globeCy: 0.44, globeFraction: 0.46, dim: 0 },
	settled: { globeCy: 0.24, globeFraction: 0.26, dim: 0.35 },
	/** Settled: the copy block is anchored this many px above the bottom of the hero, so it can never meet the globe. */
	copyBottomInset: 56,
} as const;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, k: number) => a + (b - a) * k;
const ease = (k: number) => 1 - (1 - k) ** 3;

/** Globe layout at progress `k` (0 = intro hero, 1 = settled backdrop); NaN is settled so a bad clock never strands it. */
export function layoutAt(k: number): { globeCy: number; globeFraction: number; dim: number } {
	if (Number.isNaN(k)) return { ...STAGE_LAYOUT.settled };
	const t = ease(clamp01(k));
	const a = STAGE_LAYOUT.intro;
	const b = STAGE_LAYOUT.settled;
	if (t === 0) return { ...a };
	if (t === 1) return { ...b };
	return {
		globeCy: mix(a.globeCy, b.globeCy, t),
		globeFraction: mix(a.globeFraction, b.globeFraction, t),
		dim: mix(a.dim, b.dim, t),
	};
}

/** The stage colour (what the copy sits on). */
export const STAGE_HEX = ATLAS.stage.toLowerCase();
export const STAGE_RGB: Rgb = [1, 3, 5].map((i) => parseInt(STAGE_HEX.slice(i, i + 2), 16)) as unknown as Rgb;
/** The colour the scrim is made of: the stage black of the intro. */
const SCRIM: Rgb = STAGE_RGB;
/** Extra contrast over AA, so antialiasing, subpixel positioning and a theme change cannot tip it under 4.5. */
const HEADROOM = 0.5;
/** The weakest scrim the copy ever sits on, even over a dark backdrop: it must never be bare on a glow. */
const FLOOR = 0.4;
/** Never fully opaque: a hint of the globe's light stays visible through it. */
const CEILING = 0.97;

/** The scrim opacity for the copy given the brightest backdrop pixel behind it and the subtitle colour. */
export function copyScrim(s: { worstBackdrop: Rgb; subtitle: Rgb }): { alpha: number; color: Rgb } {
	const need = scrimAlphaFor({
		text: s.subtitle,
		backdrop: s.worstBackdrop,
		scrim: SCRIM,
		ratio: AA_BODY + HEADROOM,
	});
	return { alpha: Math.min(CEILING, Math.max(FLOOR, need)), color: SCRIM };
}

/**
 * The colours the welcome copy is painted with. The stage is always a night sky, whatever the app theme, so the copy
 * uses the DARK theme of the same family (Alucard -> Dracula): brand-consistent and always readable on the stage.
 * Hero.svelte sets these as local custom properties; `legibility.test.ts` checks them against the stage.
 */
export const HERO_TEXT = (dark: Record<string, string>) => ({
	headline: dark["text"]!,
	subtitle: dark["text.muted"]!,
});
