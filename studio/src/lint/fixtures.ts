// Synthetic pictures for the lint tests: a cobalt gradient field with a rounded "app window" (titlebar, traffic
// lights, drop shadow) placed at an exact rect. They reproduce the real defect (a window whose top was cropped by the
// frame) without needing the 2560x1640 recordings, which are not in git.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Image } from "./pixels.ts";

export interface WindowSpec {
	x: number;
	y: number;
	w: number;
	h: number;
	/** corner radius px */
	radius: number;
	/** how many px of the window's top were cropped away (flat top edge, no rounded corners, no titlebar) */
	cropTop?: number;
	cropBottom?: number;
}

/** Left-to-right cobalt gradient field with a faint vertical falloff, like the site backgrounds. */
export function field(w: number, h: number): Image {
	const data = new Uint8Array(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			const t = x / (w - 1);
			const v = 1 - 0.08 * (y / (h - 1));
			data[i] = Math.round((12 + 20 * t) * v);
			data[i + 1] = Math.round((20 + 30 * t) * v);
			data[i + 2] = Math.round((150 + 40 * t) * v);
		}
	return { w, h, data };
}

function inRoundedRect(px: number, py: number, r: WindowSpec): boolean {
	const x0 = r.x;
	const y0 = r.y;
	const x1 = r.x + r.w - 1;
	const y1 = r.y + r.h - 1;
	if (px < x0 || px > x1 || py < y0 || py > y1) return false;
	const rad = r.radius;
	const cx = px < x0 + rad ? x0 + rad : px > x1 - rad ? x1 - rad : px;
	const cy = py < y0 + rad ? y0 + rad : py > y1 - rad ? y1 - rad : py;
	return (px - cx) ** 2 + (py - cy) ** 2 <= rad * rad;
}

/**
 * Paint a dark app window. The visible rect is `x,y,w,h`; with `cropTop`, the top `cropTop` px of the *source window*
 * are gone: the visible top edge is a straight horizontal cut (square corners) and the titlebar is missing, which is
 * what `crop=…:y=40` did to the film's recordings.
 */
export function paintWindow(img: Image, win: WindowSpec): void {
	// shadow: a soft darkening around the window
	for (let y = Math.max(0, win.y - 30); y < Math.min(img.h, win.y + win.h + 40); y++)
		for (let x = Math.max(0, win.x - 30); x < Math.min(img.w, win.x + win.w + 30); x++) {
			const dx = Math.max(win.x - x, 0, x - (win.x + win.w - 1));
			const dy = Math.max(win.y - y + 10, 0, y - (win.y + win.h - 1) - 10);
			const d = Math.hypot(dx, dy);
			if (d > 0 && d < 28) {
				const k = 1 - 0.22 * (1 - d / 28) ** 2;
				const i = (y * img.w + x) * 3;
				img.data[i] = Math.round(img.data[i]! * k);
				img.data[i + 1] = Math.round(img.data[i + 1]! * k);
				img.data[i + 2] = Math.round(img.data[i + 2]! * k);
			}
		}
	for (let y = win.y; y < win.y + win.h; y++)
		for (let x = win.x; x < win.x + win.w; x++) {
			// a flat cut is a rounded rect extended past the cut edge, then clipped to the visible rect
			const ext: WindowSpec = { ...win, y: win.y - (win.cropTop ?? 0), h: win.h + (win.cropTop ?? 0) + (win.cropBottom ?? 0) };
			if (!inRoundedRect(x, y, ext)) continue;
			const i = (y * img.w + x) * 3;
			const row = y - win.y;
			const titlebar = !win.cropTop && row < 36;
			const shade = titlebar ? 34 : 14 + Math.round(6 * Math.sin(x / 40));
			img.data[i] = shade;
			img.data[i + 1] = shade + 4;
			img.data[i + 2] = shade + 10;
		}
	// the controls pill of the chrome: whole in the titlebar of an intact window; with `cropTop` only its lower part
	// remains, sliced by the frame (the real defect: `crop=…:y=40` cut through the pill of the recording)
	const clip = { y0: win.y, y1: win.y + win.h };
	paintPill(img, win.x + 120, win.cropTop ? win.y - 14 : win.y + 6, 130, 28, clip);
	if (win.cropBottom) paintPill(img, win.x + 200, win.y + win.h - 14, 400, 28, clip);
	if (!win.cropTop) {
		// traffic lights on the titlebar
		for (const [k, c] of [[0, [255, 95, 87]], [1, [254, 188, 46]], [2, [40, 200, 64]]] as const) {
			const cx = win.x + 22 + k * 22;
			const cy = win.y + 18;
			for (let y = cy - 6; y <= cy + 6; y++)
				for (let x = cx - 6; x <= cx + 6; x++)
					if ((x - cx) ** 2 + (y - cy) ** 2 <= 36) {
						const i = (y * img.w + x) * 3;
						img.data[i] = c[0];
						img.data[i + 1] = c[1];
						img.data[i + 2] = c[2];
					}
		}
	}
}

/** A light rounded pill, painted only between rows `clip.y0` and `clip.y1` (the visible window). */
function paintPill(img: Image, x: number, y: number, w: number, h: number, clip: { y0: number; y1: number }): void {
	for (let yy = Math.max(clip.y0, y); yy < Math.min(clip.y1, y + h); yy++)
		for (let xx = x; xx < x + w; xx++)
			if (inRoundedRect(xx, yy, { x, y, w, h, radius: h / 2 })) {
				const i = (yy * img.w + xx) * 3;
				img.data[i] = 88;
				img.data[i + 1] = 92;
				img.data[i + 2] = 100;
			}
}

/** Draw a block of text-like rectangle: `fg` strokes on a `bg` plate. Used for contrast/size fixtures. */
export function plate(img: Image, x: number, y: number, w: number, h: number, bg: [number, number, number], fg: [number, number, number]): void {
	for (let yy = y; yy < y + h; yy++)
		for (let xx = x; xx < x + w; xx++) {
			const i = (yy * img.w + xx) * 3;
			const stroke = Math.floor((xx - x) / 3) % 2 === 0 && yy - y > h * 0.25 && yy - y < h * 0.75;
			const c = stroke ? fg : bg;
			img.data[i] = c[0];
			img.data[i + 1] = c[1];
			img.data[i + 2] = c[2];
		}
}

/** Write an Image as a binary PPM (P6) and let ffmpeg convert it; tests call this to get real files for the CLI paths. */
export function ppm(img: Image): Uint8Array {
	const head = new TextEncoder().encode(`P6\n${img.w} ${img.h}\n255\n`);
	const out = new Uint8Array(head.length + img.data.length);
	out.set(head);
	out.set(img.data, head.length);
	return out;
}

export function writePpm(path: string, img: Image): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, ppm(img));
}
