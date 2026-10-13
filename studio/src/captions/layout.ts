// Caption layout: narration lines -> cues with wrapped lines, font size and the pixel rect of each block. The same
// width model decides line wrapping and the rect, so what the lint measures is what the render draws.

import type { CaptionCue } from "../camera/types.ts";
import type { Cut, Film, Rect } from "../lib/types.ts";
import { ASPECTS } from "../lib/types.ts";
import type { Profile } from "../lint/types.ts";
import { StudioError } from "../lib/paths.ts";
import { ARCHIVO_700_AVG_EM, ARCHIVO_700_EM } from "./archivo.ts";
import { chunkLine } from "./chunk.ts";
import { CAPTION_STYLES, type CaptionStyleId, captionBox, minFontPx } from "./styles.ts";

/**
 * Advance width of one character in ems: the shipped Archivo at the caption weight (700), from the table generated out of
 * the font file (archivo.ts). No font is loaded at run time, so the layout is identical on every machine and agrees with
 * the glyphs the render draws; a character the table lacks gets the font's mean letter advance, never zero.
 */
export const charEm = (ch: string): number => ARCHIVO_700_EM[ch] ?? ARCHIVO_700_AVG_EM;

/** Width of a string in ems. */
export const textEm = (text: string): number => [...text].reduce((sum, ch) => sum + charEm(ch), 0);

/** Safety margin on the model's width (real glyph advances differ from the classes above by a few percent). */
const WIDTH_MARGIN = 0.97;

export interface CaptionLayout {
	/** the preset the cues were laid out for: the cut's `captions.style`, else reels for a vertical profile, else feed */
	style: CaptionStyleId;
	cues: CaptionCue[];
	problems: string[];
}

/**
 * Lay out a cut's burned captions.
 *
 * `film`/`cut` give the narration lines; `seconds[line.id]` is the measured speech length of each line (the VO
 * alignment, `lineSeconds`). Cues come from `chunkLine` with the cut's profile rules; each cue's font is
 * `minFontPx` (the lint's legibility floor) and its block is placed by `captionBox`: lowest band inside `profile.safe`.
 * A line may be at most `blockWidth / fontPx` ems wide, so wrapping and the rect agree.
 */
export function layoutCaptions(cut: Cut, film: Film, profile: Profile, aspect: keyof typeof ASPECTS, seconds: Record<string, number>): CaptionLayout {
	const rules = profile.captions;
	if (!rules) throw new StudioError(`profile ${profile.id} has no caption rules`, "captions.burned needs a social profile (lint/profiles.ts)");
	const lines = cut.voice?.lines ?? [];
	const frame = ASPECTS[aspect];
	const styleId: CaptionStyleId = cut.captions.style ?? (profile.platforms && "reels" in profile.platforms ? "reels" : "feed");
	const style = CAPTION_STYLES[styleId];
	const fontPx = minFontPx(profile, frame.h);
	const pillX = style.pill ? style.pill.padX * 2 : 0;
	const pillY = style.pill ? style.pill.padY * 2 : 0;
	const probe = captionBox(styleId, frame, profile, 0);
	const maxEm = ((probe.w - pillX) * WIDTH_MARGIN) / fontPx;
	const measure = (t: string): number => textEm(style.uppercase ? t.toUpperCase() : t);

	const cues: CaptionCue[] = [];
	const problems: string[] = [];
	for (const [i, l] of lines.entries()) {
		const speech = seconds[l.id];
		if (speech === undefined) {
			problems.push(`line "${l.id}": no measured speech length (run bun studio voice ${film.id})`);
			continue;
		}
		const chunked = chunkLine(l.text, l.at, speech, rules, measure, lines[i + 1]?.at, maxEm);
		problems.push(...chunked.problems.map((p) => `line "${l.id}": ${p}`));
		for (const c of chunked.cues) {
			const widest = Math.max(...c.lines.map(measure));
			const h = Math.ceil(c.lines.length * fontPx * style.lineHeight) + pillY;
			const box = captionBox(styleId, frame, profile, h);
			// the block is as wide as its widest line (+ pill), centred in the box: the rect is what is actually drawn
			const w = Math.min(box.w, Math.ceil(widest * fontPx) + pillX);
			const rect: Rect = { x: box.x + Math.floor((box.w - w) / 2), y: box.y, w, h };
			cues.push({ start: c.start, end: c.end, text: c.text, lines: c.lines, rect, fontPx });
		}
	}
	return { style: styleId, cues, problems };
}
