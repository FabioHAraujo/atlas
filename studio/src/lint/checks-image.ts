// Picture checks, pure functions of an `Image` + a `Profile`: subject edge clipping, safe areas, contrast.
//
// Edge clipping is the defect of site/public/media/film-poster.jpg and the README hero: the app window's top (its
// titlebar row) was cropped away by the scene's crop box, so the picture shows a window that starts mid-chrome. Two
// signals, either is an error:
//   1. headroom: the detected subject box sits closer to a frame edge than the profile's headroom (the subject runs
//      into or off the frame);
//   2. sliced edge: an intact window's outermost rows are a flat bezel (luminance std ~ 0 along the edge line). If the
//      outermost rows of the subject carry structure (a control, a label, a bar) the window was cut through it by a
//      crop, even when the cut leaves plenty of room to the frame edge. This is exactly the poster: 65 px of room,
//      and the controls pill of the recording sliced at the top edge (std 70-180 there, ~2 at the bottom edge).

import { bleedingSides, luminance, meanRgb, subjectBox, subjectMask, type Image } from "./pixels.ts";
import type { Diagnostic, Profile, Rect } from "./types.ts";

/** Luminance std (x1000) along an edge line above which structure crosses it. A flat bezel measures < 8. */
const SLICE_STD = 25;
/** Rows examined at each edge, and how far in from the corners (rounded corners are not structure). */
const EDGE_ROWS = 4;

export interface SubjectReport {
	box?: Rect;
	/** luminance std (x1000) of the outermost EDGE_ROWS rows/columns of the box, per side */
	edgeStd?: { top: number; bottom: number; left: number; right: number };
}

/** Std of luminance along a line of the box, skipping the first/last 8% (rounded corners, shadow). */
function lineStd(img: Image, from: number, to: number, at: (t: number) => [number, number]): number {
	const vals: number[] = [];
	for (let t = from; t < to; t++) {
		const [x, y] = at(t);
		const i = (y * img.w + x) * 3;
		vals.push(luminance(img.data[i]!, img.data[i + 1]!, img.data[i + 2]!));
	}
	const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
	return Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) * 1000;
}

export function analyzeSubject(img: Image): SubjectReport {
	const mask = subjectMask(img);
	const box = subjectBox(mask, img.w, img.h);
	if (!box) return {};
	return analyzeEdges(img, box);
}

function analyzeEdges(img: Image, box: Rect): SubjectReport {
	const worst = (n: number, line: (k: number) => number) => Math.max(...Array.from({ length: n }, (_, k) => line(k)));
	const x0 = box.x + Math.round(box.w * 0.08);
	const x1 = box.x + box.w - Math.round(box.w * 0.08);
	const y0 = box.y + Math.round(box.h * 0.08);
	const y1 = box.y + box.h - Math.round(box.h * 0.08);
	return {
		box,
		edgeStd: {
			top: worst(EDGE_ROWS, (k) => lineStd(img, x0, x1, (t) => [t, box.y + k + 1])),
			bottom: worst(EDGE_ROWS, (k) => lineStd(img, x0, x1, (t) => [t, box.y + box.h - 2 - k])),
			left: worst(EDGE_ROWS, (k) => lineStd(img, y0, y1, (t) => [box.x + k + 1, t])),
			right: worst(EDGE_ROWS, (k) => lineStd(img, y0, y1, (t) => [box.x + box.w - 2 - k, t])),
		},
	};
}

/**
 * True when the frame has no field around anything: the four corners and the four mid-edges are one flat colour (a
 * full-bleed terminal recording, whose border is the terminal's own background). A framed subject always sits on a
 * field that differs from the subject somewhere along the border (gradient, shadow, the window itself); with a uniform
 * border, any "subject" found is just a block of content (log lines) and has no headroom to judge.
 */
function isFieldless(img: Image): boolean {
	const p = 6;
	const patches: Rect[] = [
		{ x: 0, y: 0, w: p, h: p },
		{ x: img.w - p, y: 0, w: p, h: p },
		{ x: 0, y: img.h - p, w: p, h: p },
		{ x: img.w - p, y: img.h - p, w: p, h: p },
		{ x: Math.round(img.w / 2) - p, y: 2, w: p, h: p },
		{ x: Math.round(img.w / 2) - p, y: img.h - p - 2, w: p, h: p },
		{ x: 2, y: Math.round(img.h / 2) - p, w: p, h: p },
		{ x: img.w - p - 2, y: Math.round(img.h / 2) - p, w: p, h: p },
	];
	const lum = patches.map((r) => luminance(...meanRgb(img, r)));
	return Math.max(...lum) - Math.min(...lum) < 0.004;
}

export function checkEdgeClipping(img: Image, profile: Profile): Diagnostic[] {
	const { box, edgeStd } = analyzeSubject(img);
	if (!box || !edgeStd) {
		// the subject fills a whole axis, so the border-strip background model had nothing to compare against. When it
		// runs off 3+ sides the picture IS the content (a window-only screenshot): there is no frame to judge.
		const bleeding = bleedingSides(img);
		if (bleeding.length >= 3) return [];
		return bleeding.map((side) => ({
			severity: "error" as const,
			code: "frame/edge-clipped",
			message: `content runs off the ${side} edge of the frame (it has no headroom there)`,
			fix: { action: "add-headroom" as const, description: `reframe so the subject has >= ${Math.ceil(profile.headroom * Math.min(img.w, img.h))}px on the ${side}`, params: { side } },
		}));
	}
	// A subject that covers (nearly) the frame along BOTH axes is not a framed object: the picture is the content itself
	// (a window-only screenshot, a full-bleed recording). One that is wide but short (a 1040 px terminal in a 1080 px
	// frame) is framed, and its thin margin is exactly what this check is for. A subject that touches both the top and
	// the bottom (or both sides) is also the picture: there is no field above or below to give headroom into.
	const coversBoth = box.w >= img.w * 0.9 && box.h >= img.h * 0.9;
	const spansY = box.y <= 1 && box.y + box.h >= img.h - 1;
	const spansX = box.x <= 1 && box.x + box.w >= img.w - 1;
	// a thin row of text (451x8) is not a window: the subject must be a real fraction of the frame on both axes
	const tiny = box.w < img.w * 0.15 || box.h < img.h * 0.15;
	if (coversBoth || spansY || spansX || tiny || isFieldless(img)) return [];
	const out: Diagnostic[] = [];
	const short = Math.min(img.w, img.h);
	const need = Math.ceil(profile.headroom * short);
	const sides: Array<["top" | "bottom" | "left" | "right", number]> = [
		["top", box.y],
		["bottom", img.h - (box.y + box.h)],
		["left", box.x],
		["right", img.w - (box.x + box.w)],
	];
	for (const [side, room] of sides) {
		if (room >= need) continue;
		out.push({
			severity: "error",
			code: "frame/edge-clipped",
			message: `the subject is ${room}px from the ${side} edge (needs >= ${need}px, ${(profile.headroom * 100).toFixed(0)}% of the short side): it touches or runs off the frame`,
			rect: box,
			measured: room,
			limit: need,
			fix: { action: "add-headroom", description: `reframe so the whole subject has >= ${need}px on the ${side} (scale the subject down or move it away from the ${side} edge)`, params: { side, add: need - room } },
		});
	}

	// sliced edge: structure crosses the outermost rows of the subject
	// Only the top and bottom edges: a window's chrome there is a flat bezel, while content (terminal text, panels)
	// legitimately runs up to its left and right edges.
	for (const side of ["top", "bottom"] as const) {
		if (edgeStd[side] < SLICE_STD) continue;
		if (out.some((d) => d.code === "frame/edge-clipped" && d.fix?.params?.side === side)) continue;
		const strip = Math.max(8, Math.round((side === "top" || side === "bottom" ? box.h : box.w) * 0.05));
		const rect: Rect = side === "top" ? { x: box.x, y: box.y, w: box.w, h: strip } : side === "bottom" ? { x: box.x, y: box.y + box.h - strip, w: box.w, h: strip } : side === "left" ? { x: box.x, y: box.y, w: strip, h: box.h } : { x: box.x + box.w - strip, y: box.y, w: strip, h: box.h };
		out.push({
			severity: "error",
			code: "frame/window-cropped",
			message: `the ${side} of the subject is sliced: structure (a control, label or bar; edge contrast ${edgeStd[side].toFixed(0)}, a clean window edge is < ${SLICE_STD}) crosses its ${side} edge, so the window's ${side === "top" ? "titlebar" : side === "bottom" ? "footer" : "side"} was cut off by a crop`,
			rect,
			measured: +edgeStd[side].toFixed(1),
			limit: SLICE_STD,
			fix: { action: "reframe", description: `stop cropping the ${side} of the source recording; include the full window (titlebar, rounded corners, shadow) with headroom`, params: { side } },
		});
	}
	return out;
}

/** Fraction of the frame that a platform UI covers: `safe` is per-side, in fractions of that axis. */
export function safeRect(img: Image, safe: NonNullable<Profile["safe"]>): Rect {
	const x = Math.round(img.w * safe.left);
	const y = Math.round(img.h * safe.top);
	return { x, y, w: img.w - x - Math.round(img.w * safe.right), h: img.h - y - Math.round(img.h * safe.bottom) };
}

/** Anything of `rect` outside `safe`, per side, in pixels. */
export function overflow(rect: Rect, safe: Rect): { top: number; bottom: number; left: number; right: number } {
	return {
		top: Math.max(0, safe.y - rect.y),
		bottom: Math.max(0, rect.y + rect.h - (safe.y + safe.h)),
		left: Math.max(0, safe.x - rect.x),
		right: Math.max(0, rect.x + rect.w - (safe.x + safe.w)),
	};
}

/** Text boxes (from OCR) that enter the platform's UI zones. The subject itself may fill the frame; text may not. */
export function checkSafeArea(img: Image, profile: Profile, textBoxes: Array<{ text: string; rect: Rect }>): Diagnostic[] {
	if (!profile.safe) return [];
	const safe = safeRect(img, profile.safe);
	const out: Diagnostic[] = [];
	for (const t of textBoxes) {
		const o = overflow(t.rect, safe);
		const sides = (Object.entries(o) as Array<[string, number]>).filter(([, v]) => v > 0);
		if (sides.length === 0) continue;
		out.push({
			severity: "error",
			code: "safe-area/text-overlaps-ui",
			message: `text "${t.text}" enters the ${profile.id} UI zone (${sides.map(([k, v]) => `${k} by ${v}px`).join(", ")}); platform overlays will cover it`,
			rect: t.rect,
			fix: { action: "move-out-of-safe-zone", description: `keep text inside x ${safe.x}-${safe.x + safe.w}, y ${safe.y}-${safe.y + safe.h}`, params: { x: safe.x, y: safe.y, w: safe.w, h: safe.h } },
		});
	}
	return out;
}
