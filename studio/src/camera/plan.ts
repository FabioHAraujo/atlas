// The camera planner: focuses (what must be readable, when) -> camera keys, as a pure function.
//
// The rules, each one a number in `types.ts` or the profile, none of them a taste call:
//   legibility  the shown glyph band of the focus' smallest text must reach `minTextPx` at the target's display height:
//               minOut = minTextPx * frameH / displayHeight  (output px);  band = textPx * scale * GLYPH_BAND (source px);
//               zoom = minOut / (band * fit),  fit = viewport.w / source.w
//   resolution  the picture must not be upscaled past 2 output px per source px: OCR of the app's anti-aliased UI text
//               kept confidence 1.0 up to 3x bicubic (measured on the panel recording; camera/rules.test.ts pins the cap),
//               and 2x leaves margin. A focus that needs more is planned at the cap and reported `legible: false`: the
//               cure is bigger text in the source or a different focus, never a blurrier zoom.
//   motion      the viewport center moves at most `maxPanPxPerSec` (output px), zoom changes at most `maxZoomPerSec`
//               e-folds/s, farther than `cutDistancePx` the camera CUTS, and it is still `settle` seconds before the
//               focus' text must be read. A focus asked too soon is delayed (reported), never rushed past a limit.
//   frame       the viewport never shows outside the source (the pose is clamped), and the focus rect is inside the
//               viewport whenever it fits at that zoom.

import type { Rect } from "../lib/types.ts";
import { type CameraEase, type CameraKey, type CameraLimits, DEFAULT_TEXT_CSS_PX, type Frame, GLYPH_BAND, type Legibility, type ResolvedFocus } from "./types.ts";

/** Output px per source px above which the recording is too soft to read. */
export const MAX_UPSCALE = 2;
/** Seconds a focus is held when it does not say. */
export const DEFAULT_HOLD = 1.2;

const fitOf = (f: Frame) => f.viewport.w / f.source.w;

/** The glyph band, in px at the display height, of text of `textPx` CSS px when the camera is at `zoom`. */
export function shownTextPx(f: Frame, l: Legibility, textPx: number, zoom: number): number {
	const outPx = textPx * f.scale * GLYPH_BAND * fitOf(f) * zoom;
	return (outPx * l.displayHeight) / f.frame.h;
}

/** The zoom at which text of `textPx` CSS px reaches the target's glyph band. */
export function neededZoom(f: Frame, l: Legibility, textPx = DEFAULT_TEXT_CSS_PX): number {
	const minOut = (l.minTextPx * f.frame.h) / l.displayHeight;
	return minOut / (textPx * f.scale * GLYPH_BAND * fitOf(f));
}

/** The highest zoom the source's resolution allows. */
export const maxZoom = (f: Frame): number => MAX_UPSCALE / fitOf(f);

// ── easing: closed forms, so a pose is a function of time ───────────────────────────────────────────────────────────

/** Spring step response, damping ratio from `bounce` (0 = critical), normalised to land at 1 at t = 1. */
export function spring(t: number, bounce: number): number {
	if (t <= 0) return 0;
	if (t >= 1) return 1;
	const zeta = 1 - Math.min(0.95, Math.max(0, bounce));
	// settle in 1 s to within 0.1%: omega from the envelope exp(-zeta*omega*1) = 0.001
	const omega = -Math.log(0.001) / zeta;
	if (zeta >= 1) return 1 - (1 + omega * t) * Math.exp(-omega * t);
	const wd = omega * Math.sqrt(1 - zeta * zeta);
	return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
}

/** Progress 0..1 of a move of the given kind at normalised time `u`. `ease` is Material's emphasized cubic-bezier-ish smootherstep. */
export function ease(kind: CameraEase, u: number): number {
	const t = Math.min(1, Math.max(0, u));
	if (kind === "cut") return t >= 1 ? 1 : 0;
	if (kind === "hold") return 0;
	if (kind === "spring") return spring(t, 0.15);
	return t * t * t * (t * (t * 6 - 15) + 10); // smootherstep: zero velocity AND acceleration at both ends
}

export interface Pose {
	x: number;
	y: number;
	zoom: number;
}

/** The camera pose at scene time `t`: between key i-1 and key i it eases over `move` seconds, then holds. */
export function poseAt(keys: CameraKey[], t: number): Pose {
	const first = keys[0]!;
	if (t <= first.t) return { x: first.x, y: first.y, zoom: first.zoom };
	for (let i = 1; i < keys.length; i++) {
		const a = keys[i - 1]!;
		const b = keys[i]!;
		if (t >= b.t + b.move) continue;
		if (t < b.t) return { x: a.x, y: a.y, zoom: a.zoom };
		const u = b.move > 0 ? ease(b.ease, (t - b.t) / b.move) : 1;
		return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, zoom: a.zoom * Math.pow(b.zoom / a.zoom, u) };
	}
	const last = keys[keys.length - 1]!;
	return { x: last.x, y: last.y, zoom: last.zoom };
}

// ── planning ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface FocusReport {
	id: string;
	/** scene seconds: the text is readable from `from` to `to` (the camera is still) */
	from: number;
	to: number;
	zoom: number;
	neededZoom: number;
	maxZoom: number;
	legible: boolean;
	/** the glyph band of the smallest text at `zoom`, px at the display height */
	shownTextPx: number;
	/** the focus rect on the OUTPUT frame while the camera holds */
	outRect: { x: number; y: number; w: number; h: number };
	/** the focus started later than asked because the camera could not get there and settle in time */
	delayed: boolean;
	/** the text cannot be held before the shot ends: the viewer never gets to read it */
	late: boolean;
	/** the focus does not fit the viewport at this zoom (it is wider/taller than what the camera shows) */
	overflows: boolean;
	textPx: number;
}

export interface PlannedCamera {
	keys: CameraKey[];
	report: FocusReport[];
}

/** Clamp a center so the viewport (at `zoom`) stays inside the source. */
export function clampCenter(f: Frame, zoom: number, x: number, y: number, slack = { x: 0, y: 0 }): { x: number; y: number } {
	const halfW = f.source.w / zoom / 2;
	const halfH = f.viewport.h / (fitOf(f) * zoom) / 2;
	// `slack` (SOURCE px) lets the viewport show that much beyond the source's edge: the field beside the picture, inside
	// the margin the platform's UI already takes (see PlanOpts.safe). Without it the viewport never shows outside the source.
	const cl = (v: number, half: number, size: number, extra: number) => (half * 2 >= size ? size / 2 : Math.min(size - half + extra, Math.max(half - extra, v)));
	return { x: cl(x, halfW, f.source.w, slack.x), y: cl(y, halfH, f.source.h, slack.y) };
}

/** Output px of the viewport center distance between two poses. */
function outDistance(f: Frame, a: Pose, b: Pose): number {
	const s = fitOf(f) * Math.max(a.zoom, b.zoom);
	return Math.hypot(b.x - a.x, b.y - a.y) * s;
}

/** Seconds a move from `a` to `b` needs under the limits. */
export function moveSeconds(f: Frame, lim: CameraLimits, a: Pose, b: Pose): number {
	const pan = outDistance(f, a, b) / lim.maxPanPxPerSec;
	const zoom = Math.abs(Math.log(b.zoom / a.zoom)) / lim.maxZoomPerSec;
	// smootherstep peaks at 1.875x the average speed: stretch the move so the PEAK respects the limit
	return Math.max(lim.minMove, 1.875 * Math.max(pan, zoom));
}

/** The pose that frames `focus`: the zoom the rule asks for (capped), centered on the rect, clamped inside the source. */
function frameFocus(f: Frame, l: Legibility, focus: ResolvedFocus, zoomOverride?: number, safe?: Rect): { pose: Pose; needed: number; cap: number } {
	const textPx = focus.textPx ?? DEFAULT_TEXT_CSS_PX;
	const needed = neededZoom(f, l, textPx);
	const cap = maxZoom(f);
	// the zoom the rule asks for, capped by the resolution, then reduced until the whole rect fits the viewport (4% margin
	// per side): showing half of a line is worse than all of it smaller. The shortfall is reported, never hidden.
	const box = safe ? intersect(f.viewport, safe) : f.viewport;
	const fit = Math.min((box.w * 0.96) / (focus.rect.w * fitOf(f)), (box.h * 0.96) / (focus.rect.h * fitOf(f)));
	const wanted = Math.max(1, Math.min(zoomOverride ?? needed, cap));
	const zoom = zoomOverride !== undefined ? wanted : Math.max(1, Math.min(wanted, fit));
	// the pose centers the rect in the safe part of the viewport: the viewport center is the pose, so aim the pose at the
	// point that puts the rect's center at the middle of `box` (the safe rect is not centered on the viewport)
	const s = fitOf(f) * zoom;
	const aimX = focus.rect.x + focus.rect.w / 2 - (box.x + box.w / 2 - (f.viewport.x + f.viewport.w / 2)) / s;
	const aimY = focus.rect.y + focus.rect.h / 2 - (box.y + box.h / 2 - (f.viewport.y + f.viewport.h / 2)) / s;
	// slack: how far past the source's edge the safe rect lets the viewport look (the part of the viewport outside `box`)
	const slack = { x: Math.max(0, f.viewport.w - box.w) / 2 / s, y: Math.max(0, f.viewport.h - box.h) / 2 / s };
	const c = clampCenter(f, zoom, aimX, aimY, safe ? slack : undefined);
	return { pose: { ...c, zoom }, needed, cap };
}

/** The focus rect on the output frame for a pose. */
export function toOutput(f: Frame, pose: Pose, r: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
	const s = fitOf(f) * pose.zoom;
	const cx = f.viewport.x + f.viewport.w / 2;
	const cy = f.viewport.y + f.viewport.h / 2;
	return { x: cx + (r.x - pose.x) * s, y: cy + (r.y - pose.y) * s, w: r.w * s, h: r.h * s };
}

/** The overlap of two rects (a zero-size rect when they do not overlap). */
function intersect(a: Rect, b: Rect): Rect {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	return { x, y, w: Math.max(0, Math.min(a.x + a.w, b.x + b.w) - x), h: Math.max(0, Math.min(a.y + a.h, b.y + b.h) - y) };
}

export interface PlanOpts {
	/** the platform's safe rect on the output frame: focuses are framed inside it (and may use its slack past the source's edge) */
	safe?: Rect;
	/** per focus id: use this zoom instead of the rule's (camera.json overrides, written by `studio fix`) */
	zoomOverrides?: Record<string, number>;
	/** ease used for pans (default `ease`) */
	ease?: Extract<CameraEase, "ease" | "spring">;
}

/**
 * Plan the camera of one shot. The first key is the establishing pose (the whole window, zoom 1) at t = 0; each focus
 * adds a move to its pose and a hold. `duration` is the shot's length: a focus that cannot be held before it ends is
 * still planned (and reported) so the lint can say so.
 */
export function planCamera(f: Frame, l: Legibility, lim: CameraLimits, focuses: ResolvedFocus[], duration: number, opts: PlanOpts = {}): PlannedCamera {
	const wide = clampCenter(f, 1, f.source.w / 2, f.source.h / 2);
	const keys: CameraKey[] = [{ t: 0, x: wide.x, y: wide.y, zoom: 1, ease: "hold", move: 0 }];
	const report: FocusReport[] = [];
	const kind = opts.ease ?? "ease";
	let at: Pose = { ...wide, zoom: 1 };
	let free = 0; // the earliest time the camera may start its next move (the previous hold's end)
	for (const focus of [...focuses].sort((a, b) => a.at - b.at)) {
		const { pose, needed, cap } = frameFocus(f, l, focus, opts.zoomOverrides?.[focus.id], opts.safe);
		const hold = focus.hold ?? DEFAULT_HOLD;
		const wanted = moveSeconds(f, lim, at, pose);
		// the first move is the push-in from the whole window (the opening thumbnail must be the full window, so it is
		// never a cut): it takes as long as the limits need. Every later move that would take longer than
		// `maxMoveSeconds`, or crosses `cutDistancePx`, is a cut.
		const opening = keys.length === 1;
		// the opening push travels from the whole window and may take as long as the limits need, UNLESS that would make the
		// focus unreadable before the shot ends: then it is a cut (the thumbnail frame is still the whole window at t = 0)
		const endsInShot = Math.max(focus.at, wanted + lim.settle) + (focus.hold ?? DEFAULT_HOLD) <= duration + 1e-9;
		const far = opening ? !endsInShot && outDistance(f, at, pose) > 0 : outDistance(f, at, pose) > lim.cutDistancePx || wanted > lim.maxMoveSeconds;
		const move = far ? 0 : wanted;
		// the move starts when the camera is free and ends `settle` before the text must be read
		const start = Math.max(free, focus.at - lim.settle - move);
		const arrive = start + move;
		const from = Math.max(focus.at, arrive + lim.settle);
		const to = from + hold;
		const still = pose.x === at.x && pose.y === at.y && pose.zoom === at.zoom;
		if (!still) keys.push({ t: start, x: pose.x, y: pose.y, zoom: pose.zoom, ease: far ? "cut" : kind, move, focus: focus.id });
		else keys.push({ t: start, x: pose.x, y: pose.y, zoom: pose.zoom, ease: "hold", move: 0, focus: focus.id });
		const shown = shownTextPx(f, l, focus.textPx ?? DEFAULT_TEXT_CSS_PX, pose.zoom);
		const out = toOutput(f, pose, focus.rect);
		report.push({
			id: focus.id,
			from,
			to,
			zoom: pose.zoom,
			neededZoom: needed,
			maxZoom: cap,
			legible: shown >= l.minTextPx - 1e-6,
			shownTextPx: shown,
			outRect: out,
			delayed: from > focus.at + 1e-6,
			late: to > duration + 1e-6,
			overflows: out.x < f.viewport.x - 1e-6 || out.y < f.viewport.y - 1e-6 || out.x + out.w > f.viewport.x + f.viewport.w + 1e-6 || out.y + out.h > f.viewport.y + f.viewport.h + 1e-6,
			textPx: focus.textPx ?? DEFAULT_TEXT_CSS_PX,
		});
		at = pose;
		free = to;
	}
	return { keys, report };
}
