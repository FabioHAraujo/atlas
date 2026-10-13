// Burned-caption styles per platform and where a caption block may sit. Sizes are derived from the lint's own
// legibility floor so a caption that passes here passes `text/too-small` in the lint.

import type { Rect } from "../lib/types.ts";
import type { Profile } from "../lint/types.ts";
import { GLYPH_BAND } from "../camera/types.ts";

export type CaptionStyleId = "reels" | "tiktok" | "shorts" | "feed";

export interface CaptionStyle {
	id: CaptionStyleId;
	weight: number;
	uppercase: boolean;
	/** `text-shadow` stack: a dark halo at 3 radii so white text reads on the bright cobalt field and on a white app window */
	shadow: string;
	/** `-webkit-text-stroke` width in em (0 = none): TikTok-style outlined type */
	strokeEm: number;
	/** per-cue pill behind the text; absent = text on the picture */
	pill?: { background: string; padX: number; padY: number; radius: number };
	/** fraction of the safe width a line may use */
	maxWidthFraction: number;
	/** line-height as a multiple of the font size */
	lineHeight: number;
}

const HALO = "0 0 4px rgba(5,10,60,.95),0 2px 10px rgba(5,10,60,.9),0 4px 28px rgba(5,10,60,.75)";

export const CAPTION_STYLES: Record<CaptionStyleId, CaptionStyle> = {
	// Reels: sentence case, semi-bold, soft halo; the platform's own captions are white on a dark pill
	reels: { id: "reels", weight: 700, uppercase: false, shadow: HALO, strokeEm: 0, maxWidthFraction: 1, lineHeight: 1.2 },
	// TikTok: heavy weight, black outline, no pill
	tiktok: { id: "tiktok", weight: 800, uppercase: false, shadow: "0 3px 0 rgba(0,0,0,.55),0 0 18px rgba(0,0,0,.8)", strokeEm: 0.06, maxWidthFraction: 1, lineHeight: 1.2 },
	// Shorts: a pill, the one style that stays legible on any picture without a shadow
	shorts: { id: "shorts", weight: 700, uppercase: false, shadow: "none", strokeEm: 0, pill: { background: "rgba(5,10,60,.78)", padX: 22, padY: 10, radius: 20 }, maxWidthFraction: 1, lineHeight: 1.2 },
	// Feed (1:1, 4:5): the viewer scrolls past with the sound off; a pill keeps it readable on any frame of the app
	feed: { id: "feed", weight: 700, uppercase: false, shadow: "none", strokeEm: 0, pill: { background: "rgba(5,10,60,.78)", padX: 20, padY: 8, radius: 18 }, maxWidthFraction: 1, lineHeight: 1.2 },
};

/**
 * Smallest font size (output px) whose glyph band passes the lint's `text/too-small`: the OCR band is GLYPH_BAND (0.8)
 * of the font size and is shown at `displayHeight` px tall, so the band in the display is
 * `fontPx * GLYPH_BAND * displayHeight / frameH` and must be >= `minTextPx`:
 *   fontPx >= (minTextPx / 0.8) * frameH / displayHeight
 * 9:16: 28/0.8 * 1920/844 = 79.6 -> 80 px;   1:1: 24/0.8 * 1080/540 = 60;   4:5: 24/0.8 * 1350/675 = 60.
 */
export function minFontPx(profile: Profile, frameH: number): number {
	return Math.ceil((profile.minTextPx / GLYPH_BAND) * (frameH / profile.displayHeight));
}

/** Gap kept between the block and the platform's bottom zone: a pill's shadow and the OCR band must not touch it. */
export const BOTTOM_MARGIN = 24;

/**
 * The rectangle a caption block may occupy, output px. Horizontally centred inside the profile's safe rect (the
 * union of every platform's UI zones, so one cut serves Reels, TikTok and Shorts), vertically the lowest band still
 * inside `profile.safe`: the bottom edge is `frame.h * (1 - safe.bottom) - BOTTOM_MARGIN`, the top edge is the block's
 * height above it. `height` is the block's actual height (lines x line-height x font + pill padding).
 */
export function captionBox(styleId: CaptionStyleId, frame: { w: number; h: number }, profile: Profile, height: number): Rect {
	const style = CAPTION_STYLES[styleId];
	const safe = profile.safe ?? { top: 0, bottom: 0, left: 0, right: 0 };
	const left = Math.round(frame.w * safe.left);
	const right = frame.w - Math.round(frame.w * safe.right);
	const width = Math.floor((right - left) * style.maxWidthFraction);
	const bottom = Math.round(frame.h * (1 - safe.bottom)) - BOTTOM_MARGIN;
	return { x: left + Math.floor((right - left - width) / 2), y: bottom - height, w: width, h: height };
}
