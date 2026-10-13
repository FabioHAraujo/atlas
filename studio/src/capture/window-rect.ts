// Where the app window starts inside a capture frame. The recorder's frame is a few px taller than the window: the
// first rows are the wallpaper of the private virtual display (a bright sliver), then the window. Used whole, the
// sliver lands above the window's bezel and reads as structure crossing its top edge (`frame/window-cropped`).
//
// The window's own top rows are a smooth vertical ramp (bezel highlight into the toolbar, a few levels per row); the
// sliver is a flat colour with a hard STEP to the window. So the window starts at the first row that is at least
// `STEP` (summed RGB distance) away from the row ABOVE it, counting only a leading run of near-identical rows.

import type { Image } from "../lint/pixels.ts";
import { StudioError } from "../lib/paths.ts";

/** Smallest colour jump between two consecutive rows that is an edge and not a gradient (the window's own ramp is < 20). */
const STEP = 60;
/** The sliver is thin; a longer leading run is not a sliver but a different kind of picture. */
const MAX_SLIVER = 24;

const rowRgb = (img: Image, y: number): [number, number, number] => {
	// median-free mean of the middle half of the row: robust to the rounded corners and the shadow at the ends
	const x0 = Math.floor(img.w / 4);
	const x1 = Math.floor((img.w * 3) / 4);
	let r = 0;
	let g = 0;
	let b = 0;
	for (let x = x0; x < x1; x++) {
		const i = (y * img.w + x) * 3;
		r += img.data[i]!;
		g += img.data[i + 1]!;
		b += img.data[i + 2]!;
	}
	const n = x1 - x0;
	return [r / n, g / n, b / n];
};

const dist = (a: [number, number, number], b: [number, number, number]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

/** First row of the window in a frame (0 when the frame is the window exactly). Throws when the whole strip is one flat colour. */
export function windowTopRow(img: Image): number {
	const limit = Math.min(MAX_SLIVER, img.h - 1);
	let prev = rowRgb(img, 0);
	for (let y = 1; y <= limit; y++) {
		const row = rowRgb(img, y);
		if (dist(prev, row) >= STEP) return y;
		prev = row;
	}
	// no step in the leading rows: either the frame IS the window (no sliver), or it is all wallpaper (flat top to bottom)
	let flat = true;
	const first = rowRgb(img, 0);
	for (let y = 1; y < img.h && flat; y++) flat = dist(first, rowRgb(img, y)) < 8;
	if (flat) throw new StudioError("no window in this frame: every row is the same colour", "the recording shows only the display's wallpaper");
	return 0;
}
