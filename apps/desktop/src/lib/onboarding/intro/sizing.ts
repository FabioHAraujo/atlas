/**
 * Canvas sizing as one pure decision per frame. A canvas has two sizes: its CSS box (layout) and its pixel buffer
 * (`width`/`height`). The buffer defaults to 300x150; painting a window-sized scene into it shows a thumbnail in the
 * corner, which is the bug this module exists to rule out. `planFrame` takes ONE measurement of the box and returns
 * everything the frame needs (resize, scale, paint size), so the buffer, the transform and the paint size always agree.
 */

/** The HTML default buffer of a canvas nobody sized. */
export const DEFAULT_CANVAS = { width: 300, height: 150 } as const;

/** Largest buffer side we will allocate, device pixels (a runaway layout must not allocate a 100000 px canvas). */
const MAX_SIDE = 8192;
/** Highest pixel ratio drawn at: 3x buffers cost 2.25x the fill for detail nobody sees on a glow. */
const MAX_DPR = 2;
/** A box under this is not a canvas (a hidden or collapsed layout), in CSS px. */
const MIN_BOX = 1;

export interface Measure {
	cssW: number;
	cssH: number;
	dpr: number;
}

export interface FramePlan {
	/** Paint this frame. False when there is no real box yet. */
	paint: boolean;
	/** New buffer size to apply BEFORE getting the context (setting width/height resets it), or false when it already fits. */
	resize: { width: number; height: number } | false;
	/** Context scale (device pixels per CSS px) and the CSS size the scene is laid out in. */
	scale: number;
	w: number;
	h: number;
	/** No real box yet: measure again next frame (the window may be shown or sized later). */
	retry: boolean;
}

export function planFrame(m: Measure, canvas: { width: number; height: number }): FramePlan {
	const scale = m.dpr > 0 && Number.isFinite(m.dpr) ? Math.min(m.dpr, MAX_DPR) : 1;
	const real = m.cssW >= MIN_BOX && m.cssH >= MIN_BOX && Number.isFinite(m.cssW) && Number.isFinite(m.cssH);
	if (!real) return { paint: false, resize: false, scale, w: 0, h: 0, retry: true };
	const width = Math.min(MAX_SIDE, Math.max(1, Math.round(m.cssW * scale)));
	const height = Math.min(MAX_SIDE, Math.max(1, Math.round(m.cssH * scale)));
	const fits = canvas.width === width && canvas.height === height;
	return { paint: true, resize: fits ? false : { width, height }, scale, w: m.cssW, h: m.cssH, retry: false };
}

/** Tracks whether the canvas has ever had a real size, and whether the box or ratio changed since the last look. */
export class SizeWatch {
	sized = false;
	#first = false;
	#last: { w: number; h: number; dpr: number } | null = null;

	/** True while a measurement is still needed every frame: until the first real size, and always after. */
	shouldMeasure(box: { w: number; h: number }): boolean {
		if (box.w >= MIN_BOX && box.h >= MIN_BOX) this.sized = true;
		return true;
	}

	/** True exactly once: the first time the box has a real size. */
	firstSize(box: { w: number; h: number }): boolean {
		if (this.#first || !(box.w >= MIN_BOX && box.h >= MIN_BOX)) return false;
		this.#first = true;
		this.sized = true;
		return true;
	}

	/** Did the box or the pixel ratio change since the previous call? The first call records the baseline and says yes. */
	changed(box: { w: number; h: number }, dpr: number): boolean {
		const last = this.#last;
		this.#last = { w: box.w, h: box.h, dpr };
		return !last || last.w !== box.w || last.h !== box.h || last.dpr !== dpr;
	}
}

/** The media query that matches only while the device pixel ratio is `dpr`; it flips when the window changes screens. */
export function dprQuery(dpr: number): string {
	const r = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
	return `(resolution: ${r}dppx)`;
}
